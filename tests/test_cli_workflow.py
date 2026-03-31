import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


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


def run_json_script(script_path, payload):
    completed = subprocess.run(
        ["python3", str(ROOT / script_path)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_cli_ingest_rejects_missing_model():
    completed = run_cli(
        [
            "ingest",
            "--model",
            str(FIXTURES / "missing.step"),
            "--inspection",
            str(FIXTURES / "sample_inspection.csv"),
            "--out",
            str(FIXTURES / "tmp_context.json"),
        ],
        check=False,
    )

    assert completed.returncode != 0
    assert "model file not found" in (completed.stderr or completed.stdout).lower()


def test_cli_output_contract_and_end_to_end_review_flow(tmp_path):
    context_path = tmp_path / "custom_context.json"
    geometry_path = tmp_path / "custom_geometry.json"
    priorities_path = tmp_path / "custom_priorities.json"
    review_pack_path = tmp_path / "custom_review.json"

    run_cli(
        [
            "ingest",
            "--model",
            str(FIXTURES / "sample_part.step"),
            "--bom",
            str(FIXTURES / "sample_bom.csv"),
            "--inspection",
            str(FIXTURES / "sample_inspection.csv"),
            "--quality",
            str(FIXTURES / "sample_quality.csv"),
            "--part-name",
            "sample_part",
            "--out",
            str(context_path),
        ]
    )
    assert context_path.exists()

    run_cli(["analyze-part", str(FIXTURES / "sample_part_context.json"), "--out", str(geometry_path)])
    hotspot_path = tmp_path / "custom_geometry_manufacturing_hotspots.json"
    assert geometry_path.exists()
    assert hotspot_path.exists()

    run_cli(
        [
            "quality-link",
            "--context",
            str(FIXTURES / "sample_part_context.json"),
            "--geometry",
            str(geometry_path),
            "--out",
            str(priorities_path),
        ]
    )
    assert priorities_path.exists()
    assert (tmp_path / "custom_priorities_inspection_linkage.json").exists()
    assert (tmp_path / "custom_priorities_quality_linkage.json").exists()

    run_cli(
        [
            "review-pack",
            "--context",
            str(FIXTURES / "sample_part_context.json"),
            "--geometry",
            str(geometry_path),
            "--review",
            str(priorities_path),
            "--out",
            str(review_pack_path),
        ]
    )
    assert review_pack_path.exists()
    assert (tmp_path / "custom_review_review_pack.md").exists()
    assert (tmp_path / "custom_review_review_pack.pdf").exists()

    review_pack = json.loads(review_pack_path.read_text(encoding="utf-8"))
    assert review_pack["geometry_hotspots"]
    assert review_pack["inspection_anomalies"]
    assert review_pack["quality_hotspots"]
    assert review_pack["review_priorities"]
    assert review_pack["metadata"]["artifact_provenance"]["source_files"]


def test_compare_rev_reports_risk_signal_changes(tmp_path):
    baseline_context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    candidate_context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    candidate_context["part"]["revision"] = "B"
    candidate_context["geometry_source"]["model_metadata"]["bounding_box"]["size"] = [120, 80, 20]
    candidate_context["geometry_source"]["model_metadata"]["faces"] = 12
    candidate_context["geometry_source"]["feature_hints"]["bolt_circles"] = []
    candidate_context["geometry_source"]["feature_hints"]["cylinders"] = []
    candidate_context["quality_issues"] = []
    candidate_context["inspection_results"] = []

    baseline_analysis = run_json_script("scripts/analyze_part.py", {"context": baseline_context})
    candidate_analysis = run_json_script("scripts/analyze_part.py", {"context": candidate_context})
    baseline_linkage = run_json_script(
        "scripts/quality_link.py",
        {
            "context": baseline_context,
            "geometry_intelligence": baseline_analysis["geometry_intelligence"],
            "manufacturing_hotspots": baseline_analysis["manufacturing_hotspots"],
        },
    )
    candidate_linkage = run_json_script(
        "scripts/quality_link.py",
        {
            "context": candidate_context,
            "geometry_intelligence": candidate_analysis["geometry_intelligence"],
            "manufacturing_hotspots": candidate_analysis["manufacturing_hotspots"],
        },
    )

    baseline_pack = run_json_script(
        "scripts/reporting/review_pack.py",
        {
            "context": baseline_context,
            "geometry_intelligence": baseline_analysis["geometry_intelligence"],
            "manufacturing_hotspots": baseline_analysis["manufacturing_hotspots"],
            "inspection_linkage": baseline_linkage["inspection_linkage"],
            "inspection_outliers": baseline_linkage["inspection_outliers"],
            "quality_linkage": baseline_linkage["quality_linkage"],
            "quality_hotspots": baseline_linkage["quality_hotspots"],
            "review_priorities": baseline_linkage["review_priorities"],
            "output_dir": str(tmp_path),
            "output_stem": "baseline",
        },
    )
    candidate_pack = run_json_script(
        "scripts/reporting/review_pack.py",
        {
            "context": candidate_context,
            "geometry_intelligence": candidate_analysis["geometry_intelligence"],
            "manufacturing_hotspots": candidate_analysis["manufacturing_hotspots"],
            "inspection_linkage": candidate_linkage["inspection_linkage"],
            "inspection_outliers": candidate_linkage["inspection_outliers"],
            "quality_linkage": candidate_linkage["quality_linkage"],
            "quality_hotspots": candidate_linkage["quality_hotspots"],
            "review_priorities": candidate_linkage["review_priorities"],
            "output_dir": str(tmp_path),
            "output_stem": "candidate",
        },
    )

    comparison_path = tmp_path / "comparison.json"
    run_cli(
        [
            "compare-rev",
            baseline_pack["artifacts"]["json"],
            candidate_pack["artifacts"]["json"],
            "--out",
            str(comparison_path),
        ]
    )

    comparison = json.loads(comparison_path.read_text(encoding="utf-8"))
    assert comparison["artifact_type"] == "revision_comparison"
    assert comparison["schema_version"] == "1.0"
    assert comparison["analysis_version"] == "d1"
    assert comparison["source_artifact_refs"]
    assert comparison["comparison_type"] == "heuristic_artifact_diff"
    assert comparison["metrics"]["face_count"]["delta"] != 0
    assert "patterning" in comparison["risk_signals"]["review_priority_categories"]["removed"]
    assert "wall_thickness" in comparison["risk_signals"]["review_priority_categories"]["removed"]
