"""Command line and local output for the incoming inspection tool."""

import argparse
import json
import sys
from hashlib import sha256
from pathlib import Path

from .diff import compare_reviews
from .evaluate import evaluate
from .ingest import load_measurements, load_requirements
from .report import render_diff, render_review


SCHEMA_VERSION = 1
RULE_VERSION = "1.0.0"
SNAPSHOT_PATHS = {
    "requirements": "inputs/requirements.json",
    "mapping": "inputs/mapping.json",
    "measurements": "inputs/measurements.csv",
}


def _json_bytes(document):
    return (json.dumps(document, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()


def _write_output(out, files):
    # Reserve the directory exclusively so two runs cannot overwrite each other.
    try:
        out.mkdir()
    except FileExistsError as error:
        raise ValueError(f"출력 경로가 이미 있습니다. 새 폴더를 지정하세요: {out}") from error

    created_files = []
    created_directories = []
    try:
        for name, data in files.items():
            path = out / name
            if path.parent != out and path.parent not in created_directories:
                path.parent.mkdir()
                created_directories.append(path.parent)
            with path.open("xb") as handle:
                created_files.append(path)
                handle.write(data)
    except (OSError, KeyboardInterrupt):
        for path in reversed(created_files):
            path.unlink(missing_ok=True)
        for directory in reversed(created_directories):
            directory.rmdir()
        out.rmdir()
        raise


def _review(args):
    supplier = args.supplier.strip()
    lot = args.lot.strip()
    if not supplier or not lot:
        raise ValueError("협력사와 로트 값을 입력하세요.")
    raw = {name: getattr(args, name).read_bytes() for name in SNAPSHOT_PATHS}
    requirements = load_requirements(raw["requirements"])
    headers, rows, supplier_source = load_measurements(raw["measurements"], raw["mapping"])
    outcome = evaluate(requirements, rows, supplier=supplier, lot=lot)
    identity = {
        "part": requirements["part"],
        "revision": requirements["revision"],
        "lot": lot,
        "supplier": supplier,
    }
    review = {
        "schema_version": SCHEMA_VERSION,
        "rule_version": RULE_VERSION,
        "identity": identity,
        "supplier_source": supplier_source,
        "inputs": {
            name: {"sha256": sha256(data).hexdigest(), "path": SNAPSHOT_PATHS[name]}
            for name, data in raw.items()
        },
        "requirements": requirements,
        "source": {
            "headers": headers,
            "rows": [{"row": row["row"], "cells": row["cells"]} for row in rows],
        },
        **outcome,
    }

    files = {SNAPSHOT_PATHS[name]: data for name, data in raw.items()}
    files["review.html"] = render_review(review).encode()
    # Publish the machine-readable report after its evidence and HTML are present.
    files["review.json"] = _json_bytes(review)
    _write_output(args.out, files)
    return args.out / "review.html"


def _diff(args):
    before = args.before.read_bytes()
    after = args.after.read_bytes()
    try:
        before_review, after_review = json.loads(before), json.loads(after)
    except RecursionError as error:
        raise ValueError("검토 JSON이 너무 깊게 중첩되어 있습니다.") from error
    comparison = compare_reviews(before_review, after_review)
    comparison["inputs"] = {
        "before": sha256(before).hexdigest(),
        "after": sha256(after).hexdigest(),
    }
    _write_output(args.out, {
        "diff.html": render_diff(comparison).encode(),
        "diff.json": _json_bytes(comparison),
    })
    return args.out / "diff.html"


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="incoming-inspection",
        description="구매자 검사 기준으로 협력사 검사성적서를 검토합니다.",
    )
    actions = parser.add_subparsers(dest="command", required=True)
    review = actions.add_parser("review", help="검사 기준과 CSV 측정값 대조")
    review.add_argument("--requirements", type=Path, required=True, help="구매자 검사 기준 JSON")
    review.add_argument("--mapping", type=Path, required=True, help="협력사 CSV 열 매핑 JSON")
    review.add_argument("--measurements", type=Path, required=True, help="협력사 측정값 CSV")
    review.add_argument("--supplier", required=True, help="협력사 식별값")
    review.add_argument("--lot", required=True, help="접수 로트")
    review.add_argument("--out", type=Path, required=True, help="새 검토 결과 폴더")
    review.set_defaults(run=_review)

    diff = actions.add_parser("diff", help="최초본과 수정본의 검토 결과 비교")
    diff.add_argument("before", type=Path, help="최초본 review.json")
    diff.add_argument("after", type=Path, help="수정본 review.json")
    diff.add_argument("--out", type=Path, required=True, help="새 비교 결과 폴더")
    diff.set_defaults(run=_diff)

    args = parser.parse_args(argv)
    try:
        report = args.run(args)
    except (OSError, ValueError) as error:
        print(f"incoming-inspection: {error}", file=sys.stderr)
        return 2
    print(report)
    return 0
