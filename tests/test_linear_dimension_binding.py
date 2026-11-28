"""Plan labels must describe their actual endpoints, never an arbitrary extent."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _dim_plan import render_plan_dimensions_svg
from qa_scorer import collect_metrics, check_required_presence


def render(value=145, width=145, **changes):
    intent = {"id": "TOTAL_LENGTH", "feature": "plate", "view": "top",
              "style": "linear", "value_mm": value, "required": True, **changes}
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        [intent], "top", (0, 0, width, 98), [], [], 112.5, 73, .5, 0, 0,
        telemetry=telemetry, dedupe_policy="smart",
        existing_auto_dims=[{"dim_id": "auto_top", "category": "overall_width", "value_mm": 42}],
    )
    tree = ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>'))
    return intent, telemetry, tree


def test_optional_slot_position_does_not_fall_back_to_whole_plate_or_numeric_dedupe():
    intent, telemetry, tree = render(42, id="CONNECTOR_SLOT_POSITION", feature="slot", required=False)
    record = telemetry["plan_dimensions"][0]
    assert record["rendered"] is False
    assert record["reason"] == "linear_anchor_unresolved"
    assert "REVIEW" in "".join(tree.getroot().itertext())
    assert not any(e.get("data-value-mm") == "42" for e in tree.iter())
    metrics = collect_metrics(tree, {"dim_intents": [intent]})
    assert metrics.get("linear_binding_mismatch", 0) == 1


@pytest.mark.parametrize("dim_id", ["SLOT_POSITION", "TOTAL_LENGTH"])
def test_equal_number_cannot_establish_an_unknown_feature_binding(dim_id):
    _, telemetry, _ = render(145, id=dim_id, feature="slot")
    assert telemetry["plan_dimensions"][0]["rendered"] is False


def test_recognized_extent_rejects_a_nominal_different_from_its_endpoints():
    intent, telemetry, tree = render(142)
    assert telemetry["plan_dimensions"][0]["reason"] == "linear_value_geometry_mismatch"
    assert telemetry["plan_dimensions"][0]["rendered"] is False
    assert check_required_presence(tree, {"dim_intents": [intent]}) == (0, 1, ["TOTAL_LENGTH"])


@pytest.mark.parametrize("width", [145, 155])
def test_overall_dimension_tracks_actual_endpoints_and_passes_semantic_check(width):
    intent, telemetry, tree = render(width, width)
    assert telemetry["plan_dimensions"][0]["rendered"] is True
    line = next(e for e in tree.iter() if e.get("data-dimension-line") == "linear")
    assert abs(float(line.get("x2")) - float(line.get("x1"))) == width / 2
    assert collect_metrics(tree, {"dim_intents": [intent]}).get("linear_binding_mismatch") == 0


@pytest.mark.parametrize("tamper", ["label", "line"])
def test_svg_qa_measures_visible_label_and_line_instead_of_trusting_metadata(tamper):
    intent, _, tree = render()
    if tamper == "label":
        text = next(e for e in tree.iter() if e.get("data-value-mm") == "145")
        text.text = "142"  # Leave data-value-mm unchanged deliberately.
    else:
        # Existing renderer's third line is the dimension line (after extension lines).
        line = [e for e in tree.iter() if e.tag.endswith("}line")][2]
        line.set("x2", str(float(line.get("x2")) - 1.5))
    metrics = collect_metrics(tree, {"dim_intents": [intent]})
    assert metrics.get("linear_binding_mismatch", 0) > 0
    assert metrics["_details"]["linear_binding_issues"][0]["dim_id"] == "TOTAL_LENGTH"
