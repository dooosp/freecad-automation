"""The JSON entry point must run under FreeCADCmd as well as plain Python."""

import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "step_feature_detector.py"


def test_freecad_named_entrypoint_returns_json_for_invalid_input():
    # FreeCADCmd executes a script with its file stem as __name__, and keeps
    # the explicitly invoked filename at argv[1]. No FreeCAD is needed to
    # reject this request before geometry loading.
    launcher = (
        "import runpy,sys; "
        "path=sys.argv[1]; "
        "runpy.run_path(path, run_name='step_feature_detector')"
    )
    result = subprocess.run(
        [sys.executable, "-c", launcher, str(SCRIPT)],
        input="{}", capture_output=True, text=True, cwd=ROOT, check=False,
    )
    assert result.returncode == 1, result.stdout
    payload = json.loads(result.stdout)
    assert payload["success"] is False
    assert "file" in payload["error"]


def test_importing_detector_does_not_consume_stdin_or_run_analysis():
    launcher = (
        "import runpy; "
        f"module=runpy.run_path({str(SCRIPT)!r}, run_name='step_feature_detector'); "
        "assert callable(module['analyze_step']); print('import-safe')"
    )
    result = subprocess.run(
        [sys.executable, "-c", launcher],
        input="{}", capture_output=True, text=True, cwd=ROOT, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "import-safe"
