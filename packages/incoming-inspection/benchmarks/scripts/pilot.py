"""Prepare blinded pilot packets and score a completed crossover with the independent key."""

import argparse
import csv
import hashlib
import json
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import median
import subprocess
import sys
from tempfile import TemporaryDirectory

from benchmark_cases import STAGES, STATUSES, load_cases


ROOT = Path(__file__).resolve().parents[1]
CASES = tuple(f"B{i:02}" for i in range(1, 11))
REVIEWERS = ("R1", "R2")
FILES = {"requirements": "requirements.json", "mapping": "mapping.json", "measurements": "measurements.csv"}
SESSION_KEY = ("reviewer", "round", "case", "method")
PHASES = ("mapping_s", "first_s", "revised_s", "manual_first_s", "manual_revised_s")
SESSION_FIELDS = (*SESSION_KEY, "status", *PHASES, "evidence_file")
ANSWER_KEY = ("reviewer", "case", "method", "stage", "characteristic", "sample")
ANSWER_FIELDS = (*ANSWER_KEY, "status", "warning")
PROMPT = ROOT / "templates" / "claude_prompt.ko.txt"


def crossover(mode):
    methods = ["excel", "claude", "incoming-inspection"] if mode == "planned" else ["excel", "incoming-inspection"]
    for reviewer in REVIEWERS:
        for block in range(len(methods)):
            for case in CASES if reviewer == "R1" else reversed(CASES):
                shift = CASES.index(case) % len(methods)
                order = methods[shift:] + methods[:shift]
                if reviewer == "R2":
                    order.reverse()
                yield reviewer, str(block + 1), case, order[block]


def allocation_digest(mode, materials_digest):
    allocation = json.dumps([mode, materials_digest, list(crossover(mode))], separators=(",", ":")).encode()
    return hashlib.sha256(allocation).hexdigest()


def materials():
    """Return only neutral input packets. Freeze the independent key in the coordinator's digest."""
    packets = {}
    fingerprint = hashlib.sha256()

    def include(name, data):
        fingerprint.update(name.encode() + b"\0" + hashlib.sha256(data).digest())

    include("prompt", PROMPT.read_bytes())
    cases = load_cases(ROOT / "cases")
    for case, (submissions, _) in cases.items():
        folder = submissions["first"].paths["requirements"].parent
        include(f"{case}/ground_truth", (folder / "ground_truth.json").read_bytes())
        for stage, submission in submissions.items():
            identity = {field: submission.identity[field] for field in ("supplier", "lot")}
            files = {"intake.json": (json.dumps(identity, ensure_ascii=False) + "\n").encode()}
            for field, public_name in FILES.items():
                source = submission.paths[field].resolve()
                if (source.parent != folder.resolve() or source.name in ("ground_truth.json", "intake.json")
                        or source.suffix != Path(public_name).suffix):
                    raise ValueError(f"{case}/{stage}: unexpected {field} file")
                files[public_name] = source.read_bytes()
            for name, data in files.items():
                include(f"{case}/{stage}/{name}", data)
            packets[case, stage] = files
    return packets, cases, fingerprint.hexdigest()


def write_form(path, fields, rows):
    with path.open("x", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(fields)
        for values in rows:
            writer.writerow((*values, *([""] * (len(fields) - len(values)))))


def prepare(run, mode):
    if run.exists():
        raise ValueError(f"collection directory already exists: {run}")
    packets, cases, digest = materials()
    config = json.loads((ROOT / "templates" / "environment.json").read_bytes())
    config.update(claude_mode=mode, materials_sha256=digest, allocation_sha256=allocation_digest(mode, digest),
                  prompt_sha256=hashlib.sha256(PROMPT.read_bytes()).hexdigest())
    sessions = list(crossover(mode))
    with TemporaryDirectory(dir=run.parent) as scratch:
        staged = Path(scratch) / "collection"
        staged.mkdir()
        (staged / "evidence").mkdir()
        for (case, stage), files in packets.items():
            destination = staged / "packets" / case / stage
            destination.mkdir(parents=True)
            for name, data in files.items():
                (destination / name).write_bytes(data)
        (staged / "packets" / PROMPT.name).write_bytes(PROMPT.read_bytes())
        (staged / "environment.json").write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_form(staged / "sessions.csv", SESSION_FIELDS, sessions)
        answers = ((reviewer, case, method, stage, characteristic, sample)
                   for reviewer, _, case, method in sessions for stage in STAGES
                   for characteristic, sample in cases[case][0][stage].requirements)
        write_form(staged / "decisions.csv", ANSWER_FIELDS, answers)
        staged.rename(run)


def read_form(path, fields, key_fields):
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != list(fields):
            raise ValueError(f"{path.name}: unexpected columns")
        rows = {}
        for row in reader:
            if None in row or None in row.values():
                raise ValueError(f"{path.name} line {reader.line_num}: invalid column count")
            key = tuple(row[field] for field in key_fields)
            if key in rows:
                raise ValueError(f"{path.name}: duplicate row {key}")
            rows[key] = row
    return rows


def enabled(value):
    return isinstance(value, str) and value.strip().lower() not in {"", "-", "unknown", "미확인", "n/a"}


def evidence(run, name):
    if not isinstance(name, str) or not name.strip():
        raise ValueError("missing private evidence file")
    base = (run / "evidence").resolve()
    path = (run / name).resolve()
    if Path(name).is_absolute() or base not in path.parents or not path.is_file() or not path.stat().st_size:
        raise ValueError("a nonempty file below the collection's evidence/ is required")
    return path


def verify_distributed_packets(run, packets):
    root = run / "packets"
    expected = {root / case / stage / name: data for (case, stage), files in packets.items()
                for name, data in files.items()}
    expected[root / PROMPT.name] = PROMPT.read_bytes()
    actual = {path for path in root.rglob("*") if path.is_file() and path.name != ".DS_Store"}
    if set(expected) != actual or any(path.read_bytes() != data for path, data in expected.items()):
        raise ValueError("blinded packets or the distributed prompt differ from the allocation")


def environment(run, digest):
    config = json.loads((run / "environment.json").read_bytes())
    if (config["materials_sha256"] != digest
            or config["prompt_sha256"] != hashlib.sha256(PROMPT.read_bytes()).hexdigest()):
        raise ValueError("case inputs, scoring key or fixed prompt changed since allocation")
    if config["collection_origin"] != "observed_human_sessions":
        raise ValueError("human observation has not been confirmed")
    mode = config["claude_mode"]
    if mode not in {"planned", "unavailable", "offline_required"}:
        raise ValueError("unrecognized Claude availability")
    if config.get("allocation_sha256") != allocation_digest(mode, digest):
        raise ValueError("comparison mode or assigned schedule changed since allocation")
    required = ["excel_version", "incoming_inspection_version"]
    if mode == "planned":
        required.extend(["claude_model", "claude_plugin_version", "claude_skill_version"])
    primary = ["excel_version", "incoming_inspection_version"] + (["claude_model"] if mode == "planned" else [])
    missing_identifier = any(str(config.get(field)).strip().casefold() in {"none", "not_used"} for field in primary)
    if missing_identifier or any(not enabled(config.get(field)) for field in required):
        raise ValueError("fill the method version/model fields for the observed sessions")
    if mode == "unavailable":
        record = json.loads(evidence(run, config.get("claude_unavailable_record")).read_bytes())
        if (record.get("trial_available") is not False or not enabled(record.get("reason"))
                or not enabled(record.get("anonymous_source_reference"))):
            raise ValueError("unavailable Claude trial needs a verified reason and an anonymous source")
    offline = bool(config["offline_requirement_record"])
    if mode == "offline_required" or offline:
        record = json.loads(evidence(run, config["offline_requirement_record"]).read_bytes())
        if (record.get("field_requires_offline_execution") is not True
                or record.get("source_kind") not in {"field_policy", "field_interview"}
                or not enabled(record.get("anonymous_source_reference"))
                or not enabled(record.get("applicable_workflow"))):
            raise ValueError("offline exception needs a confirmed field requirement and an anonymous source")
    return mode, offline


def timings(run, sessions):
    rows = read_form(run / "sessions.csv", SESSION_FIELDS, SESSION_KEY)
    if set(rows) != set(sessions):
        raise ValueError("sessions.csv does not match the complete assigned reviewer/case/method/round matrix")
    durations = {}
    records = set()
    for key in sessions:
        row = rows[key]
        if row["status"] != "complete":
            raise ValueError(f"{key}: incomplete or incomparable session ({row['status'] or 'unperformed'})")
        record = evidence(run, row["evidence_file"])
        if record in records:
            raise ValueError(f"{key}: a separate locked submission is required for each session")
        records.add(record)
        try:
            seconds = [Decimal(row[field]) for field in PHASES]
        except InvalidOperation:
            raise ValueError(f"{key}: missing or invalid measured phase duration") from None
        if (any(not value.is_finite() or value < 0 for value in seconds)
                or any(value == 0 for value in seconds[:3])):
            raise ValueError(f"{key}: check measured seconds")
        mapping, first, revised, check_first, check_revised = seconds
        durations.setdefault(key[-1], []).append({
            "mapping": mapping, "first": first, "revised": revised,
            "manual": check_first + check_revised, "revised_with_manual": revised + check_revised,
            "total": sum(seconds),
        })
    return {method: {phase: median(row[phase] for row in group) for phase in group[0]}
            for method, group in durations.items()}


def score_answers(run, sessions, cases):
    rows = read_form(run / "decisions.csv", ANSWER_FIELDS, ANSWER_KEY)
    scores = {method: Counter() for _, _, _, method in sessions}
    for case, (submissions, _) in cases.items():
        for stage, submission in submissions.items():
            for reviewer, _, assigned_case, method in sessions:
                if assigned_case != case:
                    continue
                score = scores[method]
                for (characteristic, sample), target in submission.expected.items():
                    key = (reviewer, case, method, stage, characteristic, sample)
                    row = rows.pop(key, {})
                    state = row.get("status")
                    if state not in STATUSES or row["warning"] not in ("yes", "no"):
                        raise ValueError(f"{key}: missing or invalid final disposition")
                    if state != "in_tolerance" and row["warning"] == "no":
                        raise ValueError(f"{key}: non-normal disposition with no warning")
                    clean = target["status"] == "in_tolerance" and not target["reasons"]
                    score["scored"] += 1
                    score["correct_status"] += state == target["status"]
                    score["false_normal"] += target["status"] != "in_tolerance" and state == "in_tolerance"
                    score["clean_normal"] += clean
                    score["false_warning"] += clean and row["warning"] == "yes"
    if rows:
        raise ValueError("decisions.csv contains unassigned reviewer/case/method/requirement rows")
    return scores


def decide(medians, scores, machine, mode, offline):
    tool = "incoming-inspection"
    tool_time = medians[tool]["revised_with_manual"]
    reductions = {method: (1 - tool_time / medians[method]["revised_with_manual"]) * 100
                  for method in medians if method != tool}
    m = machine["metrics"]
    if not (m["expected_results"] == m["observed_results"] > 0
            and m["replay_valid_runs"] == m["replay_expected_runs"] == len(CASES) * len(STAGES) * 5
            and m["diffs_observed"] == m["diffs_expected"] == len(CASES)):
        return "PENDING", "incomplete_machine_evidence", reductions
    if not machine["machine_gate_pass"]:
        return "NO_GO", "machine_quality", reductions
    local = scores[tool]
    if local["scored"] != len(REVIEWERS) * m["expected_results"] or not local["clean_normal"]:
        return "PENDING", "incomplete_local_reviewer_evidence", reductions
    if local["false_normal"] or 100 * local["false_warning"] > 5 * local["clean_normal"]:
        return "NO_GO", "local_reviewer_quality", reductions
    if reductions["excel"] < 30:
        return "NO_GO", "excel_time", reductions
    if mode == "planned" and "claude" not in medians:
        return "PENDING", "planned_claude_evidence_missing", reductions
    if offline:
        return "GO", "confirmed_offline_requirement", reductions
    if mode == "unavailable":
        return "GO", "excel_and_quality_claude_unavailable", reductions
    claude = scores["claude"]
    if local["false_normal"] < claude["false_normal"]:
        return "GO", "fewer_false_normals_than_claude", reductions
    equal = all(local[key] == claude[key] for key in ("false_normal", "false_warning", "correct_status"))
    if equal and reductions["claude"] >= 20:
        return "GO", "equal_accuracy_and_claude_time", reductions
    return "NO_GO", "claude_comparison", reductions


def summarize(run):
    packets, cases, digest = materials()
    mode, offline = environment(run, digest)
    verify_distributed_packets(run, packets)
    sessions = list(crossover(mode))
    medians = timings(run, sessions)
    scores = score_answers(run, sessions, cases)
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "score_benchmark.py")],
                            capture_output=True, text=True)
    if not result.stdout.strip():
        raise ValueError(f"machine scorer produced no report (exit {result.returncode})")
    machine = json.loads(result.stdout)
    if result.returncode and machine["machine_gate_pass"]:
        raise ValueError("machine scorer failed despite a passing flag")
    decision, basis, reductions = decide(medians, scores, machine, mode, offline)
    accuracy = {}
    for method, counts in scores.items():
        normal = counts["clean_normal"]
        accuracy[method] = dict(counts, false_warning_rate=counts["false_warning"] / normal if normal else None)
    claude_evidence = "observed" if mode == "planned" else "unverified"
    return {"decision": decision, "basis": basis, "claude_mode": mode,
            "claude_relative_performance": claude_evidence, "sessions_per_method": len(REVIEWERS) * len(CASES),
            "median_seconds": medians, "reviewer_accuracy": accuracy, "revised_reduction_pct": reductions,
            "machine_gate_pass": machine["machine_gate_pass"], "machine_metrics": machine["metrics"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    build = commands.add_parser("prepare", help="create a new local blank collection")
    build.add_argument("--claude", choices=("planned", "unavailable", "offline_required"), required=True)
    for command in (build, commands.add_parser("summarize", help="score a completed local collection")):
        command.add_argument("collection", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "prepare":
            prepare(args.collection, args.claude)
        else:
            print(json.dumps(summarize(args.collection), ensure_ascii=False, indent=2, default=float))
    except (OSError, ValueError, KeyError, InvalidOperation) as error:
        label = "PENDING" if args.action == "summarize" else "prepare"
        parser.exit(2, f"pilot: {label}: {error}\n")


if __name__ == "__main__":
    main()
