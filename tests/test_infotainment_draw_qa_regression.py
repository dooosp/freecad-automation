#!/usr/bin/env python3
"""Artifact-level draw/QA regression coverage for infotainment_display_bracket."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import tomllib
import uuid
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "configs" / "examples" / "infotainment_display_bracket_hole_dia_repro.toml"
QA_SCORER = PROJECT_ROOT / "scripts" / "qa_scorer.py"
_RUNTIME_AVAILABLE = None


def _has_freecad_runtime():
    global _RUNTIME_AVAILABLE
    if _RUNTIME_AVAILABLE is not None:
        return _RUNTIME_AVAILABLE
    completed = subprocess.run(
        [
            "node",
            "-e",
            "import { hasFreeCADRuntime } from './lib/paths.js'; console.log(hasFreeCADRuntime() ? 'yes' : 'no');",
        ],
        text=True,
        capture_output=True,
        cwd=PROJECT_ROOT,
        check=False,
    )
    _RUNTIME_AVAILABLE = completed.returncode == 0 and completed.stdout.strip() == "yes"
    return _RUNTIME_AVAILABLE


def _run_cli(args):
    return subprocess.run(
        ["node", str(PROJECT_ROOT / "bin" / "fcad.js"), *args],
        text=True,
        capture_output=True,
        check=False,
        cwd=PROJECT_ROOT,
    )


def _render_infotainment_artifacts(tmp_path):
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"infotainment_display_bracket_{uuid.uuid4().hex[:8]}"
    override_path = tmp_path / "override.toml"
    override_path.write_text(
        "\n".join(
            [
                f'name = "{stem}"',
                "[export]",
                f'directory = "{output_dir.as_posix()}"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    completed = _run_cli(["draw", str(CONFIG_PATH), "--override", str(override_path)])
    assert completed.returncode == 0, (
        "fcad draw failed for infotainment QA regression\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )

    svg_path = output_dir / f"{stem}_drawing.svg"
    plan_path = output_dir / f"{stem}_plan.toml"
    dimension_map_path = output_dir / f"{stem}_dimension_map.json"
    assert svg_path.exists(), f"Missing drawing fixture: {svg_path}"
    assert plan_path.exists(), f"Missing plan fixture: {plan_path}"
    assert dimension_map_path.exists(), f"Missing dimension-map fixture: {dimension_map_path}"
    return svg_path, plan_path, dimension_map_path


def _run_infotainment_qa(svg_path, plan_path):
    with tempfile.NamedTemporaryFile(suffix=".json") as tmp:
        cmd = [
            sys.executable,
            str(QA_SCORER),
            str(svg_path),
            "--plan",
            str(plan_path),
            "--json",
            tmp.name,
        ]
        completed = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert completed.returncode == 0, (
            "qa_scorer.py failed for infotainment bracket repro\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
        return json.loads(Path(tmp.name).read_text(encoding="utf8"))


def _load_hole_dia_dimension(dimension_map_path):
    dimension_map = json.loads(dimension_map_path.read_text(encoding="utf8"))
    for dim in dimension_map.get("plan_dimensions") or []:
        if dim.get("dim_id") == "HOLE_DIA":
            return dim
    raise AssertionError("HOLE_DIA was not found in infotainment dimension_map fixture")


def test_infotainment_bracket_generated_artifacts_clear_hole_dia_presence_gate(tmp_path):
    if not _has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")

    svg_path, plan_path, dimension_map_path = _render_infotainment_artifacts(tmp_path)
    report = _run_infotainment_qa(svg_path, plan_path)

    assert report["metrics"]["required_presence_miss"] == 0, (
        "The generated infotainment drawing artifacts should keep HOLE_DIA out "
        "of the required-presence miss bucket."
    )
    assert report["details"]["required_presence_missing_ids"] == [], (
        "No required presence misses should remain in the generated drawing QA "
        "artifact for the infotainment bracket."
    )
    assert report["metrics"]["value_inconsistency"] == 0
    assert report["metrics"]["view_coverage"] is False

    hole_dia = _load_hole_dia_dimension(dimension_map_path)
    assert hole_dia["status"] == "rendered"
    assert hole_dia.get("reason") is None
    assert hole_dia["required"] is True
    assert hole_dia["value_mm"] == 5
    assert hole_dia["view"] == "top"


@pytest.mark.parametrize("case", ["normal", "changed_height", "wrong_web_target"])
def test_infotainment_required_vertical_dimensions_follow_final_edges(tmp_path, case):
    if not _has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")
    source = CONFIG_PATH.with_name("infotainment_display_bracket.toml")
    config = tomllib.loads(source.read_text())
    web = next(shape for shape in config["shapes"] if shape["id"] == "vertical_leg")
    if case == "changed_height":
        web["height"] = 44
        next(dim for dim in config["quality"]["critical_dimensions"] if dim["id"] == "cd-02")["target_mm"] = 44
    if case == "wrong_web_target":
        config["drawing_plan"] = {"dim_intents": [
            {"id": "WEB_H", "feature": "overall_height", "value_mm": 40}
        ]}
    output = tmp_path / "output"
    config["export"]["directory"] = str(output)
    case_path = tmp_path / "input.json"
    case_path.write_text(json.dumps(config))
    completed = _run_cli(["draw", str(case_path), "--bom", "--strict-quality"])
    stem = config["name"]
    plan = json.loads((output / f"{stem}_dimension_map.json").read_text())
    entries = {entry["dim_id"]: entry for entry in plan["plan_dimensions"]}
    qa = json.loads((output / f"{stem}_drawing_qa.json").read_text())
    if case == "wrong_web_target":
        assert completed.returncode == 1
        assert entries["WEB_H"]["reason"] == "bracket_reference_definition_mismatch"
        assert qa["details"]["required_presence_missing_ids"] == ["WEB_H"]
        return

    top = web["height"] + 2
    expected = {"HEIGHT": (top, [[0, 0, 0], [0, 0, top]]),
                "THK": (2, [[180, 0, 0], [180, 0, 2]]),
                "WEB_H": (web["height"], [[20, 0, 2], [20, 0, top]])}
    for dim_id, (value, endpoints) in expected.items():
        assert entries[dim_id]["value_mm"] == value, dim_id
        assert entries[dim_id]["status"] == "rendered", dim_id
        assert entries[dim_id]["runtime_binding"]["endpoints_3d_mm"] == endpoints, dim_id
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert qa["metrics"]["required_presence_miss"] == 0
    assert qa["metrics"]["text_overlap_pairs"] == 0
    quality = json.loads((output / f"{stem}_drawing_quality.json").read_text())
    assert quality["traceability"]["coverage_percent"] == 100

    if case == "normal":
        svg_path = output / f"{stem}_drawing.svg"
        svg = svg_path.read_text()
        extension, = re.findall(r'<line\b(?=[^>]*data-dim-id="WEB_H")(?=[^>]*data-endpoint-index="0")[^>]*>', svg)
        shifted = re.sub(r'\sx1="([^"]+)"', lambda match: f' x1="{float(match[1]) + 3:.2f}"', extension)
        assert shifted != extension
        bad_svg = tmp_path / "wrong_web_extension.svg"
        bad_svg.write_text(svg.replace(extension, shifted, 1))
        bad_qa = _run_infotainment_qa(bad_svg, output / f"{stem}_plan.toml")
        assert [(issue["dim_id"], issue["reason"]) for issue in bad_qa["details"]["linear_binding_issues"]] == [
            ("WEB_H", "linear_reference_geometry_mismatch")
        ]
        checked = subprocess.run([
            "node", "--input-type=module", "-e", """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentTraceability } from './src/services/drawing/current-traceability.js';
const [map, trace, good, bad] = process.argv.slice(1).map((p) => readFileSync(p, 'utf8'));
const web = (svg) => currentTraceability(JSON.parse(trace), JSON.parse(map), svg, new Map())
  .links.find((link) => link.dim_id === 'WEB_H');
assert.equal(web(good).feature_id, 'vertical_leg');
assert.equal(web(bad).feature_id, null);
assert.equal(web(bad).reason, 'final_svg_evidence_missing_or_changed');
""", str(output / f"{stem}_dimension_map.json"), str(output / f"{stem}_traceability.json"),
            str(svg_path), str(bad_svg),
        ], cwd=PROJECT_ROOT, text=True, capture_output=True)
        assert checked.returncode == 0, checked.stdout + checked.stderr
