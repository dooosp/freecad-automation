import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


def run_json_script(script_path, payload):
    completed = subprocess.run(
        ["python3", str(ROOT / script_path)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_ingest_context_full_inputs():
    payload = {
        "model": str(FIXTURES / "sample_part.step"),
        "bom": str(FIXTURES / "sample_bom.csv"),
        "inspection": str(FIXTURES / "sample_inspection.csv"),
        "quality": str(FIXTURES / "sample_quality.csv"),
        "part_name": "sample_part",
    }

    result = run_json_script("scripts/ingest_context.py", payload)

    assert result["success"] is True
    assert result["context"]["part"]["name"] == "sample_part"
    assert result["context"]["geometry_source"]["file_type"] == "step"
    assert result["context"]["geometry_source"]["validated"] is True
    assert len(result["context"]["bom"]) == 2
    assert len(result["context"]["inspection_results"]) == 2
    assert len(result["context"]["quality_issues"]) == 2
    assert result["ingest_log"]["summary"]["bom_entries"] == 2


def test_ingest_context_supports_partial_inputs():
    payload = {
        "inspection": str(FIXTURES / "sample_inspection.csv"),
        "part_name": "inspection_only",
    }

    result = run_json_script("scripts/ingest_context.py", payload)

    assert result["success"] is True
    assert result["context"]["part"]["name"] == "inspection_only"
    assert result["context"]["bom"] == []
    assert result["context"]["quality_issues"] == []
    assert len(result["context"]["inspection_results"]) == 2


def test_ingest_context_rejects_missing_model():
    payload = {
        "model": str(FIXTURES / "missing_part.step"),
        "inspection": str(FIXTURES / "sample_inspection.csv"),
    }

    completed = subprocess.run(
        ["python3", str(ROOT / "scripts" / "ingest_context.py")],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode != 0
    result = json.loads(completed.stdout)
    assert "Model file not found" in result["error"]
