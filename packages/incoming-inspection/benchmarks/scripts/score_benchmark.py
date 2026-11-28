#!/usr/bin/env python3
"""Run the local incoming-inspection CLI and score the two submissions of all ten cases."""

import argparse
from collections import Counter, defaultdict
from decimal import Decimal
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from benchmark_cases import STAGES, STATUSES, decimal_mm, digest, load_cases, pair, read_json, reasons_valid


BENCHMARK = Path(__file__).resolve().parents[1]
PACKAGE = BENCHMARK.parent
REPLAYS = 5
SNAPSHOTS = {"measurements": "inputs/measurements.csv", "requirements": "inputs/requirements.json",
             "mapping": "inputs/mapping.json"}
COUNTERS = (
    "expected_results", "observed_results", "expected_non_normal", "observed_non_normal",
    "false_normal_count", "expected_normal", "observed_normal", "false_warning_count",
    "expected_warnings", "unexpected_warnings", "reachable_warnings", "replay_expected_runs",
    "replay_valid_runs", "replay_matching_runs", "replay_expected_submissions",
    "replay_deterministic_submissions", "diffs_expected", "diffs_observed", "diffs_correct",
)


def metrics(counts):
    output = {key: counts[key] for key in COUNTERS}

    def rate(numerator, denominator):
        return numerator / denominator if denominator else None

    observed_rate = rate(counts["false_warning_count"], counts["observed_normal"])
    output.update(
        observed_false_warning_rate=observed_rate,
        false_warning_rate=observed_rate if counts["observed_normal"] == counts["expected_normal"] else None,
        evidence_reachability=rate(counts["reachable_warnings"],
                                   counts["expected_warnings"] + counts["unexpected_warnings"]),
        replay_determinism=rate(counts["replay_deterministic_submissions"],
                                counts["replay_expected_submissions"]),
    )
    return output


def indexed(records, key_function, label, issues):
    """Do not credit either copy of a duplicated output item."""
    result, duplicates = {}, set()
    if not isinstance(records, list):
        issues.append(f"{label} is missing or is not an array")
        return result
    for record in records:
        try:
            key = key_function(record)
            if key in result or key in duplicates:
                result.pop(key, None)
                duplicates.add(key)
                issues.append(f"duplicate {label} key {key!r}")
            else:
                result[key] = record
        except (ValueError, KeyError, TypeError):
            issues.append(f"invalid record in {label}: {record!r}")
    return result


def row_number(record):
    number = record["row"]
    if type(number) is not int or number < 1:
        raise ValueError("invalid row number")
    return number


def review_evidence(submission, review, out, issues):
    """Bind saved hashes, snapshot bytes, source cells and buyer requirements to fixture inputs."""
    archived = {}
    for name, relative in SNAPSHOTS.items():
        reported = review.get("inputs")
        info = reported.get(name) if isinstance(reported, dict) else None
        path = out / relative
        archived[name] = (isinstance(info, dict) and info.get("path") == relative
                          and info.get("sha256") == submission.hashes[name]
                          and path.is_file() and digest(path) == submission.hashes[name])
        if not archived[name]:
            issues.append(f"{name} input digest, snapshot path or bytes differ")
    identity_ok = review.get("identity") == submission.identity
    definition_ok = review.get("requirements") == submission.definition
    if not identity_ok or not definition_ok:
        issues.append("intake identity or embedded purchaser requirements differ")
    expected_supplier_source = "csv" if "supplier" in submission.mapping else "operator"
    if review.get("supplier_source") != expected_supplier_source:
        issues.append("wrong supplier identity source")

    source = review.get("source")
    source = source if isinstance(source, dict) else {}
    rows = indexed(source.get("rows"), row_number, "source rows", issues)
    valid_rows = {n for n, row in rows.items()
                  if n in submission.cells and row.get("cells") == submission.cells[n]}
    if valid_rows != set(submission.cells) or set(rows) != set(submission.cells):
        issues.append("embedded CSV rows differ from the supplied records")
    if source.get("headers") != submission.headers:
        valid_rows.clear()
        issues.append("embedded CSV headers differ")
    if not all(archived.values()) or not identity_ok:
        valid_rows.clear()
    return valid_rows, identity_ok and definition_ok and archived["requirements"]


def warning(item):
    return item["status"] != "in_tolerance" or bool(item["reasons"])


def check_measurement(submission, item, actual, issues):
    key = pair(item)
    expected_mm = decimal_mm(item["measured_mm"])
    try:
        if decimal_mm(actual["measured_mm"]) != expected_mm:
            raise ValueError("normalized measurement differs")
    except (KeyError, ValueError):
        issues.append(f"{key}: expected {item['measured_mm']} mm, got {actual.get('measured_mm')!r}")

    deviation = None
    if item["status"] == "out_of_tolerance":
        spec = submission.requirements[key]
        bound = spec["lower"] if "below_lower_limit" in item["reasons"] else spec["upper"]
        factor = {"mm": Decimal("1"), "in": Decimal("25.4"), "inch": Decimal("25.4")}[spec["unit"]]
        deviation = abs(expected_mm - decimal_mm(bound) * factor)
    try:
        if decimal_mm(actual["deviation_mm"]) != deviation:
            raise ValueError("deviation differs")
    except (KeyError, ValueError):
        issues.append(f"{key}: expected deviation {deviation} mm, got {actual.get('deviation_mm')!r}")

    refs = item["source_rows"]
    expected_fields = {"supplier_result": None, "measured_value": None, "measured_unit": None}
    if len(refs) == 1:
        row = dict(zip(submission.headers, submission.cells[refs[0]]))
        for report_name, input_name in (("measured_value", "value"), ("supplier_result", "supplier_result"),
                                        ("measured_unit", "unit")):
            if input_name in submission.mapping:
                value = row[submission.mapping[input_name]].strip()
                expected_fields[report_name] = (value or None) if input_name == "supplier_result" else value
        if "unit" not in submission.mapping:
            # The compact exhibit prints its unit in the mapped measurement header.
            expected_fields["measured_unit"] = submission.mapping["value"].rsplit("(", 1)[-1].rstrip(")").lower()
    for field, expected_value in expected_fields.items():
        if field not in actual or actual[field] != expected_value:
            issues.append(f"{key}: expected {field}={expected_value!r}, got {actual.get(field)!r}")


def score_review(submission, review, out):
    expected = submission.expected
    counts = Counter(
        expected_results=len(expected),
        expected_non_normal=sum(item["status"] != "in_tolerance" for item in expected.values()),
        expected_normal=sum(not warning(item) for item in expected.values()),
        expected_warnings=sum(warning(item) for item in expected.values()) + len(submission.exceptions),
    )
    issues = []
    if review is None:
        return counts, ["review.json unavailable; all expected items are unassessed"]

    valid_rows, valid_requirements = review_evidence(submission, review, out, issues)
    results = indexed(review.get("results"), pair, "results", issues)
    exceptions = indexed(review.get("unmatched_rows"), row_number, "unmatched rows", issues)
    observed_clean, false_warnings = set(), set()
    for key, item in expected.items():
        actual = results.get(key, {})
        status = actual.get("computed_result")
        if status == "cannot_evaluate":  # v1 name for the oracle's undetermined category
            status = "undetermined"
        if status == "in_tolerance" and item["status"] != "in_tolerance":
            counts["false_normal_count"] += 1
        reasons = actual.get("reasons")
        if not isinstance(status, str) or status not in STATUSES or not reasons_valid(reasons):
            issues.append(f"{key}: missing or invalid result/status/reasons")
            continue
        counts["observed_results"] += 1
        if item["status"] != "in_tolerance":
            counts["observed_non_normal"] += 1
        actual_warning = status != "in_tolerance" or bool(reasons)
        if not warning(item):
            observed_clean.add(key)
            counts["observed_normal"] += 1
            if actual_warning:
                false_warnings.add(key)
                counts["unexpected_warnings"] += 1

        if status != item["status"] or set(reasons) != set(item["reasons"]):
            issues.append(f"{key}: expected {item['status']} {item['reasons']}, got {status} {reasons}")
        check_measurement(submission, item, actual, issues)

        refs = actual.get("source_rows")
        refs_match = (isinstance(refs, list) and all(type(n) is int for n in refs)
                      and sorted(refs) == sorted(item["source_rows"]) and set(refs) <= valid_rows)
        spec = submission.requirements[key]
        spec_match = valid_requirements and all(
            actual.get(field) == spec[field] for field in ("drawing_ref", "unit", "lower", "upper")
        )
        if not refs_match or not spec_match:
            issues.append(f"{key}: expected CSV rows {item['source_rows']} "
                          f"and requirement {spec['drawing_ref']!r}")
        if actual_warning and refs_match and spec_match:
            # Only a genuinely absent required pair can use a requirement alone as evidence.
            if item["source_rows"] or status == item["status"] == "missing":
                counts["reachable_warnings"] += 1

    for key in results.keys() - expected.keys():
        issues.append(f"unrequested result {key!r}")
        row = results[key]
        if row.get("computed_result") != "in_tolerance" or row.get("reasons"):
            counts["unexpected_warnings"] += 1
    for n in submission.exceptions.keys() | exceptions.keys():
        item, actual = submission.exceptions.get(n), exceptions.get(n)
        matched = (actual is not None and n in valid_rows
                   and reasons_valid(actual.get("reasons")) and bool(actual["reasons"]))
        if matched:
            cells = dict(zip(submission.headers, submission.cells[n]))
            raw_key = tuple(cells[submission.mapping[k]].strip() for k in ("characteristic", "sample"))
            matched = (actual.get("characteristic"), actual.get("sample")) == raw_key
        if matched:
            counts["reachable_warnings"] += 1
        if item is None:
            counts["unexpected_warnings"] += 1
            for key in observed_clean:
                if n in expected[key]["source_rows"]:
                    false_warnings.add(key)
        if not matched or item is None or set(actual["reasons"]) != set(item["reasons"]):
            issues.append(f"unmatched CSV row {n}: expected {item}, got {actual}")
    counts["false_warning_count"] = len(false_warnings)
    return counts, issues


def artifact_command(arguments, out, name):
    run = subprocess.run(
        [sys.executable, "-m", "incoming_inspection", *map(str, arguments), "--out", str(out)],
        cwd=PACKAGE, env={**os.environ, "PYTHONPATH": str(PACKAGE / "src")},
        capture_output=True, text=True, encoding="utf-8",
    )
    if run.returncode:
        return None, None, f"exit {run.returncode}: {run.stderr.strip()}"
    try:
        path = out / name
        doc = read_json(path)
        if (not isinstance(doc, dict) or type(doc.get("schema_version")) is not int
                or doc["schema_version"] != 1):
            raise ValueError("missing or unsupported artifact schema")
        if name == "review.json" and (
                not isinstance(doc.get("rule_version"), str) or not doc["rule_version"].strip()
                or not isinstance(doc.get("results"), list) or not doc["results"]
                or not isinstance(doc.get("unmatched_rows"), list)
                or not all(isinstance(doc.get(k), dict) for k in ("source", "inputs", "requirements", "identity"))):
            raise ValueError("incomplete review artifact")
        return doc, digest(path), None
    except (OSError, ValueError) as error:
        # Keep diagnostics portable across temporary output roots.
        return None, None, f"unreadable {name}: {str(error).replace(str(out), '<output>')}"


def run_stage(submission, folder):
    arguments = ["review", "--supplier", submission.identity["supplier"], "--lot", submission.identity["lot"]]
    for field, path in submission.paths.items():
        arguments.extend(["--" + field, path])
    hashes, failures = [], defaultdict(list)
    first_review = None
    for n in range(1, REPLAYS + 1):
        doc, fingerprint, error = artifact_command(arguments, folder / str(n), "review.json")
        hashes.append(fingerprint)
        if error:
            failures[error].append(n)
        if n == 1:
            first_review = doc
    counts, issues = score_review(submission, first_review, folder / "1")
    matching = sum(h is not None and h == hashes[0] for h in hashes)
    counts.update(replay_expected_runs=REPLAYS, replay_valid_runs=sum(h is not None for h in hashes),
                  replay_matching_runs=matching, replay_expected_submissions=1,
                  replay_deterministic_submissions=int(matching == REPLAYS))
    if matching != REPLAYS:
        issues.append(f"{matching}/{REPLAYS} review hashes match run 1")
    record = {"rule_version": first_review["rule_version"] if first_review is not None else None,
              "review_sha256": hashes, "failures": dict(failures)}
    return first_review, record, counts, issues


def event_multiset(events):
    # Match event identity and multiplicity, independent of how the report orders its list.
    return Counter(json.dumps(event, sort_keys=True, ensure_ascii=False) for event in events)


def score_diff(expected, document, before, after, hashes):
    if document is None:
        return None, ["diff.json unavailable"]
    issues = []
    observed = {}
    try:
        if document["inputs"] != hashes or document["before"] != before or document["after"] != after:
            issues.append("diff inputs or embedded reviews differ from the scored review artifacts")
        for field in ("mode", "reasons"):
            observed[field] = document[field]
        if not reasons_valid(document["reasons"]):
            raise ValueError("invalid diff reasons")
        if "full_review_required" in document:
            observed["full_review_required"] = document["full_review_required"]
            if document["full_review_required"] is not (expected["mode"] == "full_review_required"):
                issues.append("full-review flag contradicts the answer sheet")

        results = [indexed(doc["results"], pair, "diff side results", issues) for doc in (before, after)]
        exceptions = [indexed(doc["unmatched_rows"], row_number, "diff side exceptions", issues)
                      for doc in (before, after)]
        for field in ("changes", "unmatched_changes"):
            if not isinstance(document[field], list):
                raise ValueError(f"{field} is not an array")
            observed[field] = []
            for event in document[field]:
                if field == "changes":
                    key = pair(event)
                    summary = {k: event[k] for k in ("characteristic", "sample", "kind")}
                    for index, side in enumerate(("before", "after")):
                        if event[side] != results[index][key]:
                            issues.append(f"diff {key}: incorrect {side} evidence")
                else:
                    summary = {"kind": event["kind"]}
                    for index, side in enumerate(("before", "after")):
                        entry = event[side]
                        n = row_number(entry) if entry is not None else None
                        summary[side + "_row"] = n
                        if n is not None and entry != exceptions[index][n]:
                            issues.append(f"unmatched diff row {n}: incorrect {side} evidence")
                observed[field].append(summary)
            if event_multiset(observed[field]) != event_multiset(expected[field]):
                issues.append(f"{field} differ from the answer sheet")

        mode, reasons = document["mode"], set(document["reasons"])
        if (expected["mode"] == "full_review_required" and mode == "separate_case"
                and document.get("full_review_required") is True and "identity_changed" in reasons
                and before["identity"]["revision"] != after["identity"]["revision"]
                and all(before["identity"][k] == after["identity"][k] for k in ("part", "lot", "supplier"))):
            # A revision-only identity change can retain its case classification alongside a full-review flag.
            mode = "full_review_required"
            reasons.remove("identity_changed")
            for name in ("requirements", "mapping"):
                if before["inputs"][name]["sha256"] != after["inputs"][name]["sha256"]:
                    reasons.add(name + "_changed")
        if mode != expected["mode"] or reasons != set(expected["reasons"]):
            issues.append(f"expected {expected['mode']} {expected['reasons']}, "
                          f"got {observed['mode']} {observed['reasons']}")
    except (KeyError, TypeError, ValueError) as error:
        issues.append(f"incomplete or malformed diff: {error}")
    return observed, issues


def run_suite(cases, workspace):
    suite_counts, reports = Counter(), {}
    for case_id, (submissions, expected_diff) in cases.items():
        folder = workspace / case_id
        case_counts, stages, reviews, issues = Counter(), {}, {}, []
        for stage in STAGES:
            stage_folder = folder / stage
            stage_folder.mkdir(parents=True)
            review, record, counts, problems = run_stage(submissions[stage], stage_folder)
            reviews[stage] = review
            stages[stage] = record
            case_counts.update(counts)
            issues.extend(stage + ": " + problem for problem in problems)

        diff, diff_sha, error = None, None, "one or both first-run review artifacts unavailable"
        if all(review is not None for review in reviews.values()):
            arguments = ["diff", *(folder / stage / "1" / "review.json" for stage in STAGES)]
            diff, diff_sha, error = artifact_command(arguments, folder / "diff", "diff.json")
        hashes = {side: stages[stage]["review_sha256"][0]
                  for side, stage in zip(("before", "after"), STAGES)}
        observed, problems = score_diff(expected_diff, diff, reviews["first"], reviews["revised"], hashes)
        case_counts.update(diffs_expected=1, diffs_observed=int(diff is not None), diffs_correct=int(not problems))
        issues.extend("diff: " + problem for problem in problems)
        reports[case_id] = {
            "stages": stages, "metrics": metrics(case_counts), "issues": issues,
            "diff": {"expected": expected_diff, "observed": observed, "sha256": diff_sha, "error": error},
        }
        suite_counts.update(case_counts)
    totals = metrics(suite_counts)
    thresholds = {
        "false_normal": (totals["observed_non_normal"] == totals["expected_non_normal"]
                         and totals["false_normal_count"] == 0),
        "false_warning": totals["false_warning_rate"] is not None and totals["false_warning_rate"] <= 0.05,
        "evidence": totals["evidence_reachability"] == 1.0,
        "replay": totals["replay_determinism"] == 1.0,
    }
    exact = all(not report["issues"] for report in reports.values())
    return {"schema_version": 1, "replays_per_submission": REPLAYS, "metrics": totals, "thresholds": thresholds,
            "oracle_match": exact, "machine_gate_pass": exact and all(thresholds.values()), "cases": reports}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="write JSON to a new file (default: stdout)")
    parser.add_argument("--artifacts", type=Path, help="retain reviews, snapshots and diffs in a new directory")
    args = parser.parse_args(argv)
    try:
        cases = load_cases(BENCHMARK / "cases")
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            if args.artifacts:
                workspace = args.artifacts.resolve()
                workspace.mkdir()
            result = run_suite(cases, workspace)
        payload = json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        if args.out:
            with args.out.open("x", encoding="utf-8") as stream:
                stream.write(payload)
        else:
            sys.stdout.write(payload)
        return 0 if result["machine_gate_pass"] else 1
    except (OSError, ValueError) as error:
        parser.exit(2, f"score_benchmark: {error}\n")


if __name__ == "__main__":
    sys.exit(main())
