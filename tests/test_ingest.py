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
    assert result["context"]["inspection_results"][0]["normalized_feature_ref"] == "feature:hole"
    assert result["context"]["inspection_results"][0]["normalized_location_ref"] == "location:pattern_a"
    assert result["context"]["inspection_results"][0]["source_ref"] == "sample_inspection.csv#row:1"
    assert result["context"]["quality_issues"][0]["normalized_process_ref"] == "process:heat_treat"
    assert result["context"]["quality_issues"][0]["data_quality_flags"] == ["missing_location_hint"]
    assert result["ingest_log"]["summary"]["diagnostics"] == 2


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
    assert result["ingest_log"]["summary"]["diagnostics"] == 0


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


def test_ingest_context_normalizes_mixed_units_and_preserves_provenance():
    payload = {
        "inspection": str(FIXTURES / "inspection_mixed_units.csv"),
        "part_name": "mixed_units_part",
    }

    result = run_json_script("scripts/ingest_context.py", payload)

    first, second = result["context"]["inspection_results"]
    assert first["units"] == "mm"
    assert first["nominal"] == 12.7
    assert first["actual"] == 12.827
    assert first["tolerance_plus"] == 0.127
    assert first["status"] == "in_tolerance"
    assert first["source_units"]["row"] == "in"
    assert first["source_ref"] == "inspection_mixed_units.csv#row:1"
    assert first["source_provenance"]["field_map"]["dimension_name"] == "dimension_name"
    assert first["normalized_feature_ref"] == "feature:hole"
    assert second["actual"] == 13.208
    assert second["data_quality_flags"] == ["unit_conflict"]
    assert result["ingest_log"]["summary"]["diagnostics"] == 1


def test_ingest_context_surfaces_ambiguous_alias_mappings():
    payload = {
        "inspection": str(FIXTURES / "inspection_ambiguous.json"),
        "part_name": "ambiguous_aliases",
    }

    result = run_json_script("scripts/ingest_context.py", payload)

    inspection = result["context"]["inspection_results"][0]
    assert inspection["feature_hint"] == "hole"
    assert inspection["location_hint"] == "left_flange"
    assert inspection["status"] == "out_of_tolerance"
    assert inspection["data_quality_flags"] == ["ambiguous_field_mapping"]
    assert [item["field"] for item in inspection["ingest_diagnostics"]] == ["feature_hint", "location_hint"]
    assert result["ingest_log"]["summary"]["diagnostics"] == 2


def test_ingest_context_retains_quality_provenance_when_hints_are_missing():
    payload = {
        "quality": str(FIXTURES / "quality_missing_hints.json"),
        "part_name": "quality_only",
    }

    result = run_json_script("scripts/ingest_context.py", payload)

    issue = result["context"]["quality_issues"][0]
    assert issue["issue_id"] == "NCR-900"
    assert issue["normalized_issue_ref"] == "issue:ncr_900"
    assert issue["severity"] == "high"
    assert issue["status"] == "closed"
    assert issue["normalized_feature_ref"] == "feature:edge"
    assert issue["normalized_location_ref"] is None
    assert issue["source_ref"] == "quality_missing_hints.json#row:1"
    assert issue["source_provenance"]["field_map"]["issue_id"] == "ncr_id"
    assert issue["data_quality_flags"] == ["missing_location_hint"]
    assert result["ingest_log"]["summary"]["diagnostics"] == 1
