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


def test_quality_link_builds_priorities():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    analysis = run_json_script("scripts/analyze_part.py", {"context": context})
    result = run_json_script(
        "scripts/quality_link.py",
        {
            "context": context,
            "geometry_intelligence": analysis["geometry_intelligence"],
            "manufacturing_hotspots": analysis["manufacturing_hotspots"],
        },
    )

    assert result["success"] is True
    assert len(result["inspection_outliers"]["records"]) == 2
    assert len(result["quality_hotspots"]["records"]) >= 1
    priorities = result["review_priorities"]["records"]
    assert priorities
    assert priorities[0]["score"] > 0
    assert priorities[0]["hotspot_id"]
    assert priorities[0]["score_breakdown"]["geometry_evidence_score"] > 0
    assert "ambiguity_penalty" in priorities[0]["score_breakdown"]
    actions = result["review_priorities"]["recommended_actions"]
    assert actions
    assert actions[0]["target_hotspot_id"] == priorities[0]["hotspot_id"]
    assert actions[0]["evidence_refs"]


def test_quality_link_surfaces_ambiguous_hotspot_matches():
    payload = {
        "context": {
            "inspection_results": [
                {
                    "record_id": "INSP-AMB-001",
                    "dimension_name": "Wall thickness side",
                    "deviation": -0.22,
                    "status": "out_of_tolerance",
                    "feature_hint": "wall",
                    "location_hint": "side_wall",
                    "source_row": 1,
                }
            ]
        },
        "geometry_intelligence": {"features": {"thin_wall_candidates": [{"feature_type": "thin_wall"}]}},
        "manufacturing_hotspots": {
            "hotspots": [
                {
                    "title": "Left wall review",
                    "category": "wall_thickness",
                    "severity": "high",
                    "score": 0.8,
                    "rationale": "Left wall section needs review.",
                    "evidence": {"feature_type": "thin_wall", "evidence": "left wall section"},
                },
                {
                    "title": "Right wall review",
                    "category": "wall_thickness",
                    "severity": "high",
                    "score": 0.79,
                    "rationale": "Right wall section needs review.",
                    "evidence": {"feature_type": "thin_wall", "evidence": "right wall section"},
                },
            ]
        },
    }

    result = run_json_script("scripts/quality_link.py", payload)
    record = result["inspection_linkage"]["records"][0]

    assert record["match_type"] == "multi_factor"
    assert len(record["linked_hotspot_ids"]) == 2
    assert record["ambiguity"]["is_ambiguous"] is True
    assert record["reason_codes"]


def test_quality_link_avoids_false_positive_cross_category_matches():
    payload = {
        "context": {
            "quality_issues": [
                {
                    "issue_id": "NCR-WALL-001",
                    "description": "Wall warp near thin section",
                    "defect_code": "WARP-01",
                    "defect_class": "distortion",
                    "feature_hint": "wall",
                    "location_hint": "left_web",
                    "process_step": "heat_treat",
                    "occurrence_count": 2,
                    "source_row": 1,
                }
            ]
        },
        "geometry_intelligence": {},
        "manufacturing_hotspots": {
            "hotspots": [
                {
                    "title": "Thin-wall review",
                    "category": "wall_thickness",
                    "severity": "high",
                    "score": 0.8,
                    "rationale": "Thin wall may distort.",
                    "evidence": {"feature_type": "thin_wall", "evidence": "left wall section"},
                },
                {
                    "title": "Repeated hole pattern",
                    "category": "patterning",
                    "severity": "medium",
                    "score": 0.5,
                    "rationale": "Hole pattern needs datum review.",
                    "evidence": {"hole_pattern_count": 1},
                },
            ]
        },
    }

    result = run_json_script("scripts/quality_link.py", payload)
    record = result["quality_linkage"]["records"][0]

    assert record["linked_hotspot_ids"] == ["wall_thickness-001"]
    assert "patterning-001" not in record["linked_hotspot_ids"]
    quality_hotspot = result["quality_hotspots"]["records"][0]
    assert quality_hotspot["hotspot_id"] == "wall_thickness-001"
    assert quality_hotspot["score"] > 0
