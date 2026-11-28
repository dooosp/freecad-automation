"""A verified final plate edge must locate THK, independently of overall height."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _dim_plan import render_plan_dimensions_svg
from qa_scorer import collect_metrics


def draw(value=4, height=4, binding_status="resolved", **intent_changes):
    intent = {"id": "THK", "feature": "plate", "view": "front", "style": "linear",
              "value_mm": value, "required": True, **intent_changes}
    binding = {"status": binding_status, "reason": "linear_anchor_unresolved",
               "source": "freecad_runtime", "feature_id": "plate", "model_object_id": "final",
               "measurement": "final_edge", "edge_ref": "final:Edge9", "measured_mm": height,
               "endpoints_3d_mm": [[145, 0, 0], [145, 0, height]],
               "endpoints_uv_mm": [[145, 0], [145, height]],
               "bounds": [145, 0, 145, height]}
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        [intent], "front", (0, 0, 145, height + 8), [], [], 112.5, 189, .5, 0, 0,
        telemetry=telemetry, dedupe_policy="off",
        runtime_linear_bindings={("front", "THK", "plate"): binding})
    tree = ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>'))
    return intent, telemetry["plan_dimensions"][0], tree


@pytest.mark.parametrize("height", [4, 5])
def test_thickness_uses_final_edge_without_recentering_it_in_whole_view(height):
    intent, record, tree = draw(height, height)
    assert record["rendered"] is True
    assert record["runtime_binding"]["edge_ref"] == "final:Edge9"
    line = next(e for e in tree.iter() if e.get("data-dimension-line") == "linear")
    assert abs(float(line.get("y2")) - float(line.get("y1"))) == height / 2
    # At scale .5 the lower plate edge is below whole-view center by (height+8)/4.
    assert float(line.get("y2")) == 189 + (height + 8) / 4
    assert collect_metrics(tree, {"dim_intents": [intent]})["linear_binding_mismatch"] == 0


def test_wrong_thickness_remains_unrendered_even_with_a_valid_edge():
    _, record, _ = draw(6)
    assert not record["rendered"]
    assert record["reason"] == "linear_value_geometry_mismatch"


def test_attempted_but_missing_edge_never_falls_back_to_view_extent():
    _, record, _ = draw(12, binding_status="unresolved")
    assert not record["rendered"]
    assert record["reason"] == "linear_anchor_unresolved"


def test_translated_equal_length_svg_dimension_is_rejected_against_bound_edge():
    intent, _, tree = draw()
    line = next(e for e in tree.iter() if e.get("data-dimension-line") == "linear")
    for key in ("y1", "y2"):
        line.set(key, str(float(line.get(key)) - 3))
    issues = collect_metrics(tree, {"dim_intents": [intent]})["_details"]["linear_binding_issues"]
    assert any(i["reason"] == "linear_reference_geometry_mismatch" for i in issues)
