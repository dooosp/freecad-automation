#!/usr/bin/env python3
"""Artifact-level draw/QA regression coverage for infotainment_display_bracket."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
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
