import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
_RUNTIME_AVAILABLE = None


def run_cli(args, check=True):
    completed = subprocess.run(
        ["node", str(ROOT / "bin" / "fcad.js"), *args],
        text=True,
        capture_output=True,
        check=False,
        cwd=ROOT,
    )
    if check and completed.returncode != 0:
        raise AssertionError(f"CLI failed: {completed.stdout}\n{completed.stderr}")
    return completed


def has_freecad_runtime():
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
        check=False,
        cwd=ROOT,
    )
    _RUNTIME_AVAILABLE = completed.returncode == 0 and completed.stdout.strip() == "yes"
    return _RUNTIME_AVAILABLE


def test_cli_create_accepts_canonical_single_part_config(tmp_path):
    if not has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")

    config_path = tmp_path / "single_part.toml"
    output_dir = tmp_path / "single_out"
    config_path.write_text(
        f"""
name = "cli_single_part"
final = "body_fillet"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 5

[[operations]]
op = "fillet"
target = "body"
radius = 0.5
result = "body_fillet"

[export]
formats = ["brep"]
directory = "{output_dir}"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    completed = run_cli(["create", str(config_path)])

    assert completed.returncode == 0
    assert "Model created successfully!" in completed.stdout
    assert (output_dir / "cli_single_part.brep").exists()


def test_cli_create_accepts_canonical_assembly_config(tmp_path):
    if not has_freecad_runtime():
        pytest.skip("FreeCAD runtime not available")

    config_path = tmp_path / "assembly.toml"
    output_dir = tmp_path / "assembly_out"
    config_path.write_text(
        f"""
name = "cli_minimal_assembly"

[[parts]]
id = "base"
final = "base_body"
  [[parts.shapes]]
  id = "base_body"
  type = "box"
  length = 20
  width = 10
  height = 5

[[parts]]
id = "pin"
final = "pin_body"
  [[parts.shapes]]
  id = "pin_body"
  type = "cylinder"
  radius = 2
  height = 8

[assembly]

  [[assembly.parts]]
  ref = "base"
  position = [0, 0, 0]

  [[assembly.parts]]
  ref = "pin"
  position = [10, 5, 0]

[export]
formats = ["brep"]
directory = "{output_dir}"
""".strip()
        + "\n",
        encoding="utf-8",
    )

    completed = run_cli(["create", str(config_path)])

    assert completed.returncode == 0
    assert "Model created successfully!" in completed.stdout
    assert "Assembly: 2 parts" in completed.stdout
    assert (output_dir / "cli_minimal_assembly.brep").exists()
