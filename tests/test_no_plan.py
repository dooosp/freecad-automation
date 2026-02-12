#!/usr/bin/env python3
"""Regression test: --no-plan flag must produce valid QA with intent metrics = 0."""

import json
import subprocess
import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QA_SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "qa_scorer.py")
# Use any existing SVG in output/ as test input
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

INTENT_METRICS = ["dim_completeness", "dim_redundancy", "datum_coherence", "view_coverage", "note_convention"]


def find_test_svg():
    """Find any SVG in output/ for testing."""
    for f in sorted(os.listdir(OUTPUT_DIR)):
        if f.endswith("_drawing.svg"):
            return os.path.join(OUTPUT_DIR, f)
    return None


def test_no_plan():
    svg = find_test_svg()
    if not svg:
        print("SKIP: No SVG found in output/ — run `fcad draw` first")
        sys.exit(0)

    report = svg.replace(".svg", "_noplan_qa.json")
    result = subprocess.run(
        ["python3", QA_SCRIPT, svg, "--json", report],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, f"QA scorer failed: {result.stderr}"

    with open(report) as f:
        qa = json.load(f)

    score = qa.get("score", 0)
    metrics = qa.get("metrics", {})

    assert score > 0, f"Score must be > 0 without plan, got {score}"

    # Without --plan, plan-dependent intent metrics must be None (N/A)
    for m in ["dim_completeness", "view_coverage",
              "required_presence_rate", "required_presence_miss", "value_inconsistency",
              "virtual_pcd_present", "note_semantic_mismatch"]:
        val = metrics.get(m)
        assert val is None, f"{m} must be null/N/A without plan, got {val}"

    # intent_metrics_applicable flag must be false
    assert metrics.get("intent_metrics_applicable") is False, \
        f"intent_metrics_applicable must be false without plan"

    # Clean up
    try:
        os.remove(report)
    except OSError:
        pass

    print(f"PASS: --no-plan regression OK (score={score})")


if __name__ == "__main__":
    test_no_plan()
