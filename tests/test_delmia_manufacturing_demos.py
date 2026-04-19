import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "configs" / "examples" / "manufacturing"


def run_script(script_name, *args):
    completed = subprocess.run(
        ["python3", str(ROOT / "scripts" / script_name), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def run_script_raw(script_name, *args):
    return subprocess.run(
        ["python3", str(ROOT / "scripts" / script_name), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )


def test_simulate_production_flow_generates_expected_outputs(tmp_path):
    result = run_script(
        "simulate_production_flow.py",
        "--context",
        str(CONFIG_DIR / "bracket_line_context.json"),
        "--out-dir",
        str(tmp_path),
    )

    report = json.loads(Path(result["report_path"]).read_text(encoding="utf-8"))
    assert Path(result["summary_path"]).exists()
    assert report["throughput"]["units_per_hour"] > 0
    assert report["bottleneck_work_center"]["work_center_id"] == "WC30"
    assert report["wip_estimate"]["units"] >= 1
    assert report["recommended_improvement_actions"]
    assert "not an official DELMIA" in report["disclaimer"]


def test_link_inspection_to_manufacturing_generates_review_guidance(tmp_path):
    result = run_script(
        "link_inspection_to_manufacturing.py",
        "--context",
        str(CONFIG_DIR / "bracket_line_context.json"),
        "--inspection",
        str(CONFIG_DIR / "bracket_inspection_records.json"),
        "--out-dir",
        str(tmp_path),
    )

    report = json.loads(Path(result["report_path"]).read_text(encoding="utf-8"))
    assert Path(result["summary_path"]).exists()
    assert report["summary"]["record_count"] == 3
    assert report["summary"]["linked_to_operation_count"] == 3
    first = report["review_guidance"][0]
    assert first["related_operation"]["operation_id"] == "OP30"
    assert first["confidence"] >= 0.7
    assert first["evidence_references"]
    assert "Guidance only" in first["review_guidance_note"]


def test_link_inspection_to_manufacturing_fails_closed_for_ambiguous_feature_only_match(tmp_path):
    ambiguous_inspection = {
        "records": [
            {
                "record_id": "INSP-AMB-001",
                "feature_ref": "hole1",
                "characteristic": "mounting_hole_diameter",
                "status": "warning"
            }
        ]
    }
    inspection_path = tmp_path / "ambiguous_inspection.json"
    inspection_path.write_text(json.dumps(ambiguous_inspection), encoding="utf-8")

    result = run_script(
        "link_inspection_to_manufacturing.py",
        "--context",
        str(CONFIG_DIR / "bracket_line_context.json"),
        "--inspection",
        str(inspection_path),
        "--out-dir",
        str(tmp_path),
    )

    report = json.loads(Path(result["report_path"]).read_text(encoding="utf-8"))
    first = report["review_guidance"][0]
    assert report["summary"]["linked_to_operation_count"] == 0
    assert first["related_operation"] is None
    assert "multiple routing steps" in first["possible_manufacturing_cause"]
    assert "routing_candidate:OP30" in first["evidence_references"]
    assert "routing_candidate:OP40" in first["evidence_references"]
    assert "routing_candidate:OP50" in first["evidence_references"]


def test_simulate_production_flow_rejects_invalid_context(tmp_path):
    invalid_context = json.loads((CONFIG_DIR / "bracket_line_context.json").read_text(encoding="utf-8"))
    invalid_context["prototype_scope"]["not_official_dassault_or_delmia_integration"] = False
    invalid_context_path = tmp_path / "invalid_context.json"
    invalid_context_path.write_text(json.dumps(invalid_context), encoding="utf-8")

    completed = run_script_raw(
        "simulate_production_flow.py",
        "--context",
        str(invalid_context_path),
        "--out-dir",
        str(tmp_path),
    )
    assert completed.returncode != 0
    assert "not_official_dassault_or_delmia_integration=true" in completed.stderr
