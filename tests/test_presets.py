#!/usr/bin/env python3
"""Preset validation tests — verify preset TOML files are well-formed
and produce valid plans when merged with base configs.

Usage:
    python3 tests/test_presets.py [--verbose]
"""

import json
import os
import sys
import tomllib

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS_DIR = os.path.join(PROJECT_ROOT, "configs", "overrides", "presets")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))
from plan_validator import validate_plan


# Expected preset characteristics
PRESET_EXPECTATIONS = {
    "V1_D3": {
        "key": ("drawing_plan", "dimensioning", "required_only"),
        "value": True,
    },
    "V1_D1_S1": {
        "key": ("drawing_plan", "style", "dim_offset"),
        "min": 10.0,  # clean = wider spacing
    },
    "V1_D1_S3": {
        "key": ("drawing_plan", "style", "dim_offset"),
        "max": 6.0,  # dense = tighter spacing
    },
    "V4_D1_S2": {
        "key": ("drawing_plan", "style", "stroke_profile"),
        "value": "exam",
    },
}


def deep_get(d, keys):
    """Get nested dict value by key tuple."""
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def deep_merge(base, override):
    """Recursively merge override into base (copy)."""
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def _run_preset_parse():
    """All preset TOML files must parse without errors."""
    passed = 0
    failed = 0
    for f in sorted(os.listdir(PRESETS_DIR)):
        if not f.endswith(".toml"):
            continue
        path = os.path.join(PRESETS_DIR, f)
        try:
            with open(path, "rb") as fh:
                data = tomllib.load(fh)
            assert "drawing_plan" in data, f"missing drawing_plan section"
            passed += 1
        except Exception as e:
            print(f"  FAIL: {f} — {e}")
            failed += 1
    return passed, failed


def test_preset_parse():
    """All preset TOML files must parse without errors."""
    _, failed = _run_preset_parse()
    assert failed == 0, f"{failed} preset parse failure(s)"


def _run_preset_expectations():
    """Key presets have expected characteristic values."""
    passed = 0
    failed = 0
    for name, expect in PRESET_EXPECTATIONS.items():
        path = os.path.join(PRESETS_DIR, f"{name}.toml")
        if not os.path.exists(path):
            print(f"  FAIL: {name}.toml not found")
            failed += 1
            continue
        with open(path, "rb") as f:
            data = tomllib.load(f)
        val = deep_get(data, expect["key"])
        if "value" in expect:
            if val != expect["value"]:
                print(f"  FAIL: {name} {'.'.join(expect['key'])} = {val}, expected {expect['value']}")
                failed += 1
                continue
        if "min" in expect:
            if not isinstance(val, (int, float)) or val < expect["min"]:
                print(f"  FAIL: {name} {'.'.join(expect['key'])} = {val}, expected >= {expect['min']}")
                failed += 1
                continue
        if "max" in expect:
            if not isinstance(val, (int, float)) or val > expect["max"]:
                print(f"  FAIL: {name} {'.'.join(expect['key'])} = {val}, expected <= {expect['max']}")
                failed += 1
                continue
        passed += 1
    return passed, failed


def test_preset_expectations():
    """Key presets must match expected characteristic values."""
    _, failed = _run_preset_expectations()
    assert failed == 0, f"{failed} preset expectation failure(s)"


def _run_preset_merge_valid():
    """Presets merged with a base plan must pass plan validation."""
    # Find a base plan to merge with
    base_plan_path = os.path.join(OUTPUT_DIR, "ks_flange_plan.toml")
    if not os.path.exists(base_plan_path):
        print("  SKIP: no base plan found (run fcad draw first)")
        return 0, 0

    with open(base_plan_path, "rb") as f:
        base = tomllib.load(f)

    passed = 0
    failed = 0
    for f in sorted(os.listdir(PRESETS_DIR)):
        if not f.endswith(".toml"):
            continue
        path = os.path.join(PRESETS_DIR, f)
        with open(path, "rb") as fh:
            preset = tomllib.load(fh)
        merged = deep_merge(base, preset)
        plan = merged.get("drawing_plan", {})
        result = validate_plan(plan)
        if not result["valid"]:
            print(f"  FAIL: {f} merged — {result['errors']}")
            failed += 1
        else:
            passed += 1
    return passed, failed


def test_preset_merge_valid():
    """Presets merged with base plans must pass plan validation."""
    _, failed = _run_preset_merge_valid()
    assert failed == 0, f"{failed} preset merge validation failure(s)"


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    total_pass = 0
    total_fail = 0

    print("=== Preset Parse Test ===")
    p, f = _run_preset_parse()
    total_pass += p
    total_fail += f
    print(f"  {p} parsed OK, {f} failed\n")

    print("=== Preset Expectations Test ===")
    p, f = _run_preset_expectations()
    total_pass += p
    total_fail += f
    print(f"  {p} expectations OK, {f} failed\n")

    print("=== Preset Merge Validation Test ===")
    p, f = _run_preset_merge_valid()
    total_pass += p
    total_fail += f
    print(f"  {p} merges valid, {f} failed\n")

    print(f"{'='*50}")
    print(f"Total: {total_pass} PASS, {total_fail} FAIL")

    if total_fail > 0:
        sys.exit(1)
    else:
        print("\nAll preset tests passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
