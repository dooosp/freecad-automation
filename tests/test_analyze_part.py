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

    assert geometry["metrics"]["bounding_box_mm"]["x"] == 120.0
    assert geometry["features"]["hole_like_feature_count"] == 4
    assert geometry["features"]["complexity_score"] > 0
    assert len(hotspots) >= 2
    assert any(hotspot["category"] == "wall_thickness" for hotspot in hotspots)


def test_analyze_part_supports_metadata_only_fallback():
    context = json.loads((FIXTURES / "sample_part_context.json").read_text(encoding="utf-8"))
    context["geometry_source"]["path"] = None

    result = run_json_script("scripts/analyze_part.py", {"context": context})

    assert result["success"] is True
    assert result["geometry_intelligence"]["geometry_source"]["path"] is None
    assert result["geometry_intelligence"]["analysis_confidence"] == "heuristic"
