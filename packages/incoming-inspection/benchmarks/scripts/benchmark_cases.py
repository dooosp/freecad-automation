"""Read the independent answer sheets and resolve their references against the exhibits."""

import csv
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path


STAGES = ("first", "revised")
STATUSES = {"in_tolerance", "out_of_tolerance", "missing", "undetermined"}


def read_json(path):
    def unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError(f"duplicate key {key!r} in {path.name}")
            obj[key] = value
        return obj

    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique)


def pair(record):
    return record["characteristic"], record["sample"]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def decimal_mm(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("measured_mm must be a decimal string or null")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(f"invalid decimal {value!r}") from error
    if not number.is_finite():
        raise ValueError(f"non-finite decimal {value!r}")
    return number


def reasons_valid(reasons):
    return (isinstance(reasons, list)
            and all(isinstance(code, str) and code for code in reasons)
            and len(set(reasons)) == len(reasons))


@dataclass
class Submission:
    paths: dict
    hashes: dict
    identity: dict
    mapping: dict
    definition: dict
    requirements: dict
    headers: list
    cells: dict
    expected: dict
    exceptions: dict


def load_submission(folder, intake, stage, truth):
    sources = intake[stage]
    if set(sources) != {"requirements", "mapping", "measurements"}:
        raise ValueError(f"invalid {stage} source list")
    if any(not isinstance(name, str) or Path(name).name != name for name in sources.values()):
        raise ValueError(f"invalid {stage} source filename")
    paths = {name: folder / filename for name, filename in sources.items()}
    definition = read_json(paths["requirements"])
    requirements = {(spec["id"], sample): spec for spec in definition["characteristics"]
                    for sample in spec["samples"]}
    if not requirements or len(requirements) != sum(len(s["samples"]) for s in definition["characteristics"]):
        raise ValueError("empty or duplicated required pair")
    mapping = read_json(paths["mapping"])
    identity = {k: definition[k] for k in ("part", "revision")}
    identity.update({k: intake[k] for k in ("lot", "supplier")})
    with paths["measurements"].open(encoding="utf-8-sig", newline="") as stream:
        records = csv.reader(stream, strict=True)
        headers = next(records)
        cells = dict(enumerate((row for row in records if row), start=1))
    if len(set(headers)) != len(headers) or not set(mapping.values()) <= set(headers):
        raise ValueError("mapping/header mismatch in fixture")
    if any(len(row) != len(headers) for row in cells.values()):
        raise ValueError("ragged CSV fixture")
    by_name = {n: dict(zip(headers, row)) for n, row in cells.items()}
    seen_rows = set()

    def check_row(number, key, matched):
        if type(number) is not int or number not in by_name or number in seen_rows:
            raise ValueError(f"invalid or reused reference row {number!r} for {key}")
        row = by_name[number]
        if tuple(row[mapping[k]].strip() for k in ("characteristic", "sample")) != key:
            raise ValueError(f"row {number} does not belong to {key}")
        if matched and any(row[mapping[k]].strip() != v for k, v in identity.items() if k in mapping):
            raise ValueError(f"row {number} has a different intake identity")
        seen_rows.add(number)

    expected = {}
    for item in truth["results"]:
        key = pair(item)
        status, rows = item["status"], item["source_rows"]
        if (key in expected or key not in requirements or status not in STATUSES
                or not reasons_valid(item["reasons"]) or not isinstance(rows, list)
                or (status == "missing") != (len(rows) == 0)):
            raise ValueError(f"invalid or duplicate answer for {key}")
        mm = decimal_mm(item["measured_mm"])
        if status in {"in_tolerance", "out_of_tolerance"} and (mm is None or len(rows) != 1):
            raise ValueError(f"missing measurement evidence for {key}")
        for number in rows:
            check_row(number, key, True)
        expected[key] = item
    if set(expected) != set(requirements):
        raise ValueError("answer sheet omits required pairs")

    exceptions = {}
    for item in truth["unmatched_rows"]:
        number = item["row"]
        check_row(number, pair(item), False)
        if not item["reasons"] or not reasons_valid(item["reasons"]):
            raise ValueError(f"invalid exception reasons at row {number}")
        exceptions[number] = item
    if seen_rows != set(cells):
        raise ValueError("answer sheet omits source rows")
    return Submission(paths, {k: digest(p) for k, p in paths.items()}, identity, mapping,
                      definition, requirements, headers, cells, expected, exceptions)


def load_cases(root):
    case_ids = [f"B{i:02}" for i in range(1, 11)]
    folders = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
    if [p.name.split("_", 1)[0] for p in folders] != case_ids:
        raise ValueError("the suite must contain exactly one case for each ID B01 through B10")
    cases = {}
    for case_id, folder in zip(case_ids, folders):
        try:
            intake = read_json(folder / "intake.json")
            truth = read_json(folder / "ground_truth.json")
            submissions = {stage: load_submission(folder, intake, stage, truth[stage]) for stage in STAGES}
            diff = truth["diff"]
            if (diff["mode"] not in {"comparison", "full_review_required"}
                    or not reasons_valid(diff["reasons"])
                    or not all(isinstance(diff[k], list) for k in ("changes", "unmatched_changes"))):
                raise ValueError("invalid diff answer")
            cases[case_id] = submissions, diff
        except (KeyError, OSError, TypeError, ValueError, StopIteration, csv.Error) as error:
            raise ValueError(f"{case_id} fixture: {error}") from error
    return cases
