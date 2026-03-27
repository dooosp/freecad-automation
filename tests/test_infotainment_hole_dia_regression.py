#!/usr/bin/env python3
"""Regression test for HOLE_DIA required-presence rendering behavior.

This test runs the narrow drawing mini-loop for a bracket repro config and verifies:
  - required_presence_miss is cleared for required HOLE_DIA
  - HOLE_DIA is rendered in the plan dimensions (not skipped due to view mismatch)
"""

import json
import subprocess
from pathlib import Path
import uuid

import pytest


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "configs/examples/infotainment_display_bracket_hole_dia_repro.toml"


_RUNTIME_AVAILABLE = None


def has_freecad_runtime():
    """Detect FreeCAD runtime presence using the same CLI signal as existing tests."""
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
        cwd=ROOT,
        check=False,
    )
    _RUNTIME_AVAILABLE = completed.returncode == 0 and completed.stdout.strip() == "yes"
    return _RUNTIME_AVAILABLE


def run_cli(args, check=False):
    return subprocess.run(
        ["node", str(ROOT / "bin/fcad.js"), *args],
        text=True,
        capture_output=True,
        check=False,
        cwd=ROOT,
    )


def test_hole_dia_required_presence_is_rendered(tmp_path):
    if not has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")

    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"infotainment_display_bracket_hole_dia_repro_{uuid.uuid4().hex[:8]}"
    override_path = tmp_path / "override.toml"
    override_path.write_text(
        '\n'.join(
            [
                f'name = "{stem}"',
                "[export]",
                f'directory = "{output_dir.as_posix()}"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    completed = run_cli(["draw", str(CONFIG), "--override", str(override_path)])
    assert completed.returncode == 0, (
        f"fcad draw failed\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
    )

    qa_path = output_dir / f"{stem}_drawing_qa.json"
    dim_map_path = output_dir / f"{stem}_dimension_map.json"
    assert qa_path.exists(), f"missing qa artifact: {qa_path}"
    assert dim_map_path.exists(), f"missing dimension map artifact: {dim_map_path}"

    qa = json.loads(qa_path.read_text(encoding="utf-8"))
    dimension_map = json.loads(dim_map_path.read_text(encoding="utf-8"))

    # Issue target: required HOLE_DIA should no longer be reported missing.
    assert qa["metrics"]["required_presence_miss"] == 0
    assert qa["details"]["required_presence_missing_ids"] == []

    hole_dims = [d for d in dimension_map.get("plan_dimensions", []) if d.get("dim_id") == "HOLE_DIA"]
    assert len(hole_dims) == 1
    assert hole_dims[0]["rendered"] is True
    assert hole_dims[0]["status"] == "rendered"
    assert hole_dims[0].get("reason") is None
