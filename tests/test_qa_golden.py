#!/usr/bin/env python3
"""Golden metrics regression test — compare QA results against expected ranges.

Reads tests/golden_metrics.json for max/min/target bounds.
Checks each *_qa.json in output/ against golden gates.

Pipeline output files and their producers:
  *_drawing.svg          ← generate_drawing.py (raw) → postprocess_svg.py (final)
  *_plan.toml            ← intent_compiler.py (drawing plan for debugging/QA)
  *_repair_report.json   ← postprocess_svg.py (repair log) + fcad.js (plan meta)
  *_qa.json              ← qa_scorer.py (14 metrics + score + deductions)

Usage:
    python3 tests/test_qa_golden.py [--verbose]
"""

import json
import os
import subprocess
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOLDEN_PATH = os.path.join(PROJECT_ROOT, "tests", "golden_metrics.json")
QA_SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "qa_scorer.py")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
INTENT_COMPILER = os.path.join(PROJECT_ROOT, "scripts", "intent_compiler.py")

# Map config name → part_type for golden lookup
CONFIG_DIR = os.path.join(PROJECT_ROOT, "configs", "examples")


def load_golden():
    with open(GOLDEN_PATH) as f:
        return json.load(f)


def find_qa_files():
    """Find *_qa.json files in output/."""
    results = []
    for f in sorted(os.listdir(OUTPUT_DIR)):
        if f.endswith("_qa.json") and not f.endswith("_qa_before.json") and not f.endswith("_noplan_qa.json"):
            results.append(os.path.join(OUTPUT_DIR, f))
    return results


def detect_part_type(qa_path):
    """Try to detect part type from corresponding plan JSON."""
    base = os.path.basename(qa_path).replace("_qa.json", "")
    # Plan files use config name (without _drawing suffix)
    config_name = base.replace("_drawing", "")
    # Try TOML first (Phase 19.1+), fall back to JSON (legacy)
    plan_path = os.path.join(OUTPUT_DIR, f"{config_name}_plan.toml")
    if not os.path.exists(plan_path):
        plan_path = os.path.join(OUTPUT_DIR, f"{config_name}_plan.json")
    if os.path.exists(plan_path):
        try:
            if plan_path.endswith(".toml"):
                import tomllib
                with open(plan_path, "rb") as f:
                    plan = tomllib.load(f)
            else:
                with open(plan_path) as f:
                    plan = json.load(f)
            return plan.get("drawing_plan", {}).get("part_type", "unknown")
        except Exception:
            pass
    return "unknown"


def check_metric(name, value, bounds, part_type, verbose=False):
    """Check a single metric against golden bounds.

    Returns: (status, message) where status is "PASS", "WARN", or "FAIL"
    """
    if not isinstance(value, (int, float)):
        return "PASS", None

    # Check max gate
    if "max" in bounds:
        if value > bounds["max"]:
            return "FAIL", f"{name}={value} > max={bounds['max']}"

    # Check min gate
    if "min" in bounds:
        if value < bounds["min"]:
            return "FAIL", f"{name}={value} < min={bounds['min']}"

    # Check target (warn only)
    if "target" in bounds and verbose:
        if "max" in bounds and value > bounds["target"]:
            return "WARN", f"{name}={value} > target={bounds['target']}"
        if "min" in bounds and value < bounds["target"]:
            return "WARN", f"{name}={value} < target={bounds['target']}"

    return "PASS", None


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv

    golden = load_golden()
    profile_version = golden.get("profile_version", "unknown")
    defaults = golden.get("defaults", {})
    by_type = golden.get("by_part_type", {})

    qa_files = find_qa_files()
    if not qa_files:
        print("SKIP: No QA JSON files in output/ — run `fcad draw` first")
        sys.exit(0)

    print(f"Golden profile v{profile_version}: checking {len(qa_files)} drawings\n")

    total_pass = 0
    total_warn = 0
    total_fail = 0

    for qa_path in qa_files:
        name = os.path.basename(qa_path).replace("_qa.json", "")
        part_type = detect_part_type(qa_path)

        with open(qa_path) as f:
            qa = json.load(f)
        metrics = qa.get("metrics", {})
        score = qa.get("score", 0)

        # Merge defaults with part-type overrides
        effective = dict(defaults)
        if part_type in by_type:
            for k, v in by_type[part_type].items():
                effective[k] = {**effective.get(k, {}), **v}

        fails = []
        warns = []

        for metric_name, bounds in effective.items():
            val = metrics.get(metric_name)
            if val is None:
                continue  # N/A metrics (no plan) — skip gate check
            status, msg = check_metric(metric_name, val, bounds, part_type, verbose)
            if status == "FAIL":
                fails.append(msg)
            elif status == "WARN":
                warns.append(msg)

        # Print result
        status_str = "PASS" if not fails else "FAIL"
        print(f"  [{status_str}] {name} (type={part_type}, score={score})")

        for msg in fails:
            print(f"    FAIL: {msg}")
            total_fail += 1
        for msg in warns:
            print(f"    WARN: {msg}")
            total_warn += 1
        if not fails:
            total_pass += 1

    # Summary
    n = len(qa_files)
    print(f"\n{'='*50}")
    print(f"Results: {total_pass}/{n} PASS, {total_fail} FAIL gates, {total_warn} warnings")

    if total_fail > 0:
        print("\nGolden gate violations found — review metrics above.")
        sys.exit(1)
    else:
        print("\nAll golden gates passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
