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


def test_analyze_part_generates_geometry_intelligence():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    result = run_json_script("scripts/analyze_part.py", {"context": context})

    assert result["success"] is True
    geometry = result["geometry_intelligence"]
    hotspots = result["manufacturing_hotspots"]["hotspots"]
    derived_features = geometry["derived_features"]

    assert geometry["artifact_type"] == "geometry_intelligence"
    assert geometry["schema_version"] == "1.0"
    assert geometry["analysis_version"] == "d1"
    assert geometry["source_artifact_refs"]
    assert geometry["coverage"]["source_artifact_count"] >= 1
    assert geometry["metrics"]["bounding_box_mm"]["x"] == 120.0
    assert geometry["features"]["hole_like_feature_count"] == 4
    assert geometry["features"]["complexity_score"] > 0
    assert geometry["geometry_facts"]["raw_feature_stats"]["hole_cylinder_count"] == 4
    assert geometry["geometry_facts"]["inspect_facts"]["inspection_out_of_tolerance_count"] == 2
    assert geometry["entity_index"]["bolt_circles"][0]["entity_ref"].startswith("entity:")
    assert derived_features
    assert len(hotspots) >= 2
    assert any(hotspot["category"] == "wall_thickness" for hotspot in hotspots)
    assert all(hotspot["hotspot_id"].startswith("hotspot:") for hotspot in hotspots)

    wall_hotspot = next(hotspot for hotspot in hotspots if hotspot["category"] == "wall_thickness")
    pattern_hotspot = next(hotspot for hotspot in hotspots if hotspot["category"] == "patterning")

    assert wall_hotspot["region_ref"] == "region:left_web"
    assert "geometry.thinness.low" in wall_hotspot["reason_codes"]
    assert "inspection:INSP-002" in wall_hotspot["evidence_refs"]
    assert "quality:NCR-001" in wall_hotspot["evidence_refs"]
    assert pattern_hotspot["feature_refs"]
    assert pattern_hotspot["entity_refs"]
    assert "geometry.hole_pattern.repeated" in pattern_hotspot["reason_codes"]
    assert "inspection:INSP-001" in pattern_hotspot["evidence_refs"]


def test_analyze_part_supports_metadata_only_fallback():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    context["geometry_source"]["path"] = None
    context["geometry_source"]["feature_hints"] = {}

    result = run_json_script("scripts/analyze_part.py", {"context": context})

    assert result["success"] is True
    geometry = result["geometry_intelligence"]
    assert geometry["geometry_source"]["path"] is None
    assert geometry["analysis_confidence"] == "heuristic"
    assert geometry["coverage"]["source_file_count"] == 4
    assert geometry["geometry_facts"]["raw_feature_stats"]["cylinder_count"] == 0
    assert geometry["features"]["hole_pattern_count"] == 0
    assert all(hotspot["hotspot_id"] for hotspot in result["manufacturing_hotspots"]["hotspots"])


def test_analyze_part_builds_low_confidence_metadata_only_fallback_without_model_metadata():
    result = run_json_script(
        "scripts/analyze_part.py",
        {
            "part": {"name": "weak_step_part"},
            "geometry_source": {
                "path": "tests/fixtures/sample_part.step",
                "file_type": "step",
            },
            "allow_metadata_only_fallback": True,
            "warnings": ["Runtime-backed inspection failed for weak STEP input."],
            "runtime_diagnostics": [
                {
                    "stage": "model-inspection",
                    "message": "Runtime-backed model inspection failed: shape is invalid",
                    "fallback_mode": "metadata-only",
                }
            ],
        },
    )

    assert result["success"] is True
    geometry = result["geometry_intelligence"]
    hotspots = result["manufacturing_hotspots"]

    assert geometry["analysis_confidence"] == "low"
    assert geometry["confidence"]["level"] == "low"
    assert geometry["metrics"]["bounding_box_mm"]["x"] == 0.0
    assert geometry["geometry_source"]["analysis_mode"] == "metadata_only_fallback"
    assert geometry["geometry_source"]["runtime_diagnostics"][0]["stage"] == "model-inspection"
    assert "Runtime-backed inspection failed for weak STEP input." in geometry["warnings"]
    assert any("metadata-only fallback" in warning for warning in geometry["warnings"])
    assert hotspots["confidence"]["level"] == "low"


def test_analyze_part_hotspot_ids_are_stable_for_equivalent_inputs():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))

    first = run_json_script("scripts/analyze_part.py", {"context": context})
    second = run_json_script("scripts/analyze_part.py", {"context": context})

    first_hotspots = first["manufacturing_hotspots"]["hotspots"]
    second_hotspots = second["manufacturing_hotspots"]["hotspots"]

    assert [item["hotspot_id"] for item in first_hotspots] == [item["hotspot_id"] for item in second_hotspots]
    assert [item["reason_codes"] for item in first_hotspots] == [item["reason_codes"] for item in second_hotspots]


def test_analyze_part_keeps_distinct_pattern_hotspots_per_entity():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    context["geometry_source"]["feature_hints"]["bolt_circles"] = [
        {
            "count": 4,
            "hole_diameter": 10.0,
            "pcd": 60.0,
        },
        {
            "count": 6,
            "hole_diameter": 8.0,
            "pcd": 92.0,
        },
    ]

    result = run_json_script("scripts/analyze_part.py", {"context": context})

    pattern_hotspots = [
        hotspot
        for hotspot in result["manufacturing_hotspots"]["hotspots"]
        if hotspot["category"] == "patterning"
    ]

    assert len(pattern_hotspots) == 2
    assert len({hotspot["hotspot_id"] for hotspot in pattern_hotspots}) == 2
    assert len({tuple(hotspot["entity_refs"]) for hotspot in pattern_hotspots}) == 2


def test_analyze_part_preserves_bootstrap_contract_evidence():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    context["bootstrap"] = {
        "import_diagnostics": {
            "import_kind": "assembly",
            "body_count": 3,
        },
        "bootstrap_summary": {
            "review_gate": {
                "status": "review_required",
            }
        },
        "confidence_map": {
            "overall": {
                "level": "medium",
                "score": 0.58,
            }
        },
        "warnings": [
            "Imported assembly classification needs confirmation.",
        ],
    }

    result = run_json_script("scripts/analyze_part.py", {"context": context})

    assert result["success"] is True
    geometry = result["geometry_intelligence"]
    hotspots = result["manufacturing_hotspots"]

    assert geometry["bootstrap"]["import_diagnostics"]["import_kind"] == "assembly"
    assert geometry["bootstrap"]["bootstrap_summary"]["review_gate"]["status"] == "review_required"
    assert geometry["bootstrap"]["confidence_map"]["overall"]["level"] == "medium"
    assert "Imported assembly classification needs confirmation." in geometry["warnings"]
    assert hotspots["bootstrap"]["import_diagnostics"]["body_count"] == 3
    assert hotspots["bootstrap"]["warnings"] == ["Imported assembly classification needs confirmation."]
