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


def test_review_pack_generates_artifacts(tmp_path):
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    analysis = run_json_script("scripts/analyze_part.py", {"context": context})
    linkage = run_json_script(
        "scripts/quality_link.py",
        {
            "context": context,
            "geometry_intelligence": analysis["geometry_intelligence"],
            "manufacturing_hotspots": analysis["manufacturing_hotspots"],
        },
    )

    result = run_json_script(
        "scripts/reporting/review_pack.py",
        {
            "context": context,
            "geometry_intelligence": analysis["geometry_intelligence"],
            "manufacturing_hotspots": analysis["manufacturing_hotspots"],
            "inspection_linkage": linkage["inspection_linkage"],
            "inspection_outliers": linkage["inspection_outliers"],
            "quality_linkage": linkage["quality_linkage"],
            "quality_hotspots": linkage["quality_hotspots"],
            "review_priorities": linkage["review_priorities"],
            "output_dir": str(tmp_path),
            "output_stem": "sample_part",
        },
    )

    assert result["success"] is True
    assert Path(result["artifacts"]["json"]).exists()
    assert Path(result["artifacts"]["markdown"]).exists()
    assert Path(result["artifacts"]["pdf"]).exists()
    summary = result["summary"]
    assert summary["canonical_artifact"]["json_is_source_of_truth"] is True
    assert summary["executive_summary"]["headline"]
    assert summary["prioritized_hotspots"]
    assert summary["inspection_anomaly_linkage"]["records"]
    assert summary["quality_pattern_linkage"]["records"]
    assert summary["evidence_ledger"]["records"]
    assert "numeric_score" in summary["uncertainty_coverage_report"]
    assert summary["data_quality_notes"]
    assert summary["part"]["name"] == "sample_part"
    assert summary["geometry_hotspots"]
    assert summary["inspection_anomalies"]
    assert summary["quality_linkage"]["records"]
    assert summary["review_priorities"]
    assert summary["recommended_actions"]
    assert summary["evidence_appendix"]["source_files"]
    markdown = Path(result["artifacts"]["markdown"]).read_text(encoding="utf-8")
    assert "## Executive Summary" in markdown
    assert "## Evidence Ledger" in markdown
    assert "## Uncertainty / Coverage Report" in markdown
