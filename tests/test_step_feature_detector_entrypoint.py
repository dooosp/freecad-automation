"""The STEP detector must handle FreeCADCmd entry without running on imports."""

import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
DETECTOR = ROOT / "scripts" / "step_feature_detector.py"
IMPORT_DETECTOR = """
import importlib
import json
import sys
from pathlib import Path

script = Path(sys.argv[1])
argv = json.loads(sys.argv[2])
sys.path.insert(0, str(script.parent))
sys.argv = argv
importlib.import_module(script.stem)
print("imported")
"""


@pytest.mark.parametrize("launcher", ["python", "freecadcmd"])
def test_detector_entrypoint_returns_json_for_invalid_input(launcher):
    command = [sys.executable, str(DETECTOR)]
    if launcher == "freecadcmd":
        # Native FreeCADCmd imports the script by stem and keeps its path in argv[1].
        command = [
            sys.executable, "-c", IMPORT_DETECTOR, str(DETECTOR),
            json.dumps(["FreeCADCmd", str(DETECTOR)]),
        ]

    completed = subprocess.run(command, input="{}", text=True, capture_output=True, cwd=ROOT)

    assert completed.returncode == 1, completed.stdout + completed.stderr
    assert json.loads(completed.stdout) == {
        "success": False,
        "error": "'file' field required in input",
    }


@pytest.mark.parametrize("argv", [
    ["-c"],
    ["FreeCADCmd", "other_script.py"],
    ["FreeCADCmd", "other_directory/step_feature_detector.py"],
])
def test_importing_detector_does_not_consume_stdin_or_run_analysis(argv):
    completed = subprocess.run(
        [sys.executable, "-c", IMPORT_DETECTOR, str(DETECTOR), json.dumps(argv)],
        input="not JSON", text=True, capture_output=True, cwd=ROOT,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert completed.stdout.strip() == "imported"
    assert completed.stderr == ""
