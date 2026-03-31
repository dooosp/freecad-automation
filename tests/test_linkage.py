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
    assert result["inspection_linkage"]["artifact_type"] == "inspection_linkage"
    assert result["quality_linkage"]["artifact_type"] == "quality_linkage"
    assert result["review_priorities"]["artifact_type"] == "review_priorities"
    assert len(result["inspection_outliers"]["records"]) == 2
    assert len(result["quality_hotspots"]["records"]) >= 1
    priorities = result["review_priorities"]["records"]
    assert priorities
    assert priorities[0]["score"] > 0
    assert result["review_priorities"]["recommended_actions"]
