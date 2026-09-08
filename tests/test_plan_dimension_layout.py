"""Pure SVG regressions for supported anchors and coherent plan placement."""

import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _annotation_planner import AnnotationPlanner
from _dim_plan import render_plan_dimensions_svg


def test_named_anchor_uses_whole_view_origin_and_preserves_observation():
    observation = dict(status='resolved', source='freecad_final_topology',
        dim_id='THK', feature_ids=['plate'], view='front', style='linear',
        value_mm=4, bounds_uv=[30,10,30,14], vertical=True,
        requirement_ids=['PLATE_THICKNESS'], members=[])
    tree, record, _, _ = render(dict(id='THK', feature='plate', value_mm=4, view='front'),
        bounds=(30,10,175,22), named_anchors={'THK': observation})
    assert record['status'] == 'rendered'
    assert record['observation'] == observation
    label = tree.find(".//text[@data-dim-id='THK']")
    assert label.get('data-observation')
    lines = tree.findall('.//line')
    # View midpoint=(102.5,16), not the plate feature's midpoint.
    assert {float(lines[0].get('y1')),float(lines[1].get('y1'))} == {102,106}


def test_conflicting_named_anchor_cannot_label_another_feature():
    observation = dict(status='resolved', source='freecad_final_topology', dim_id='THK',
        feature_ids=['other'], view='front', style='linear', value_mm=8,
        bounds_uv=[0,0,0,8], vertical=True, members=[])
    tree, row, _, _ = render(dict(id='THK', feature='plate', view='front', value_mm=4),
        named_anchors={'THK': observation})
    assert row['status'] == 'skipped_no_anchor'
    assert not tree.findall('.//*[@data-value-mm]')


def render(intent, *, bounds=(0, 0, 100, 40), circles=(), **kwargs):
    telemetry = {}
    svg, hs, vs = render_plan_dimensions_svg(
        [intent], intent.get("view", "top"), bounds, circles, [],
        100, 100, 1, kwargs.pop("h_stack", 0), kwargs.pop("v_stack", 0),
        telemetry=telemetry, dedupe_policy=kwargs.pop("dedupe_policy", "off"),
        **kwargs,
    )
    return ET.fromstring(f"<svg>{svg}</svg>"), telemetry["plan_dimensions"][0], hs, vs


@pytest.mark.parametrize("intent,bounds", [
    ({"id": "CONNECTOR_SLOT_POSITION", "feature": "slot", "value_mm": 42,
      "tolerance": "±0.10", "required": True}, (0, 0, 145, 98)),
    ({"id": "STANDOFF_HEIGHT", "feature": "standoff1", "value_mm": 8,
      "tolerance": "±0.05", "required": True}, (0, 0, 145, 12)),
    # A coincident numeric value alone cannot identify a feature's endpoints.
    ({"id": "SLOT_SIZE", "feature": "slot", "value_mm": 100,
      "tolerance": "±0.1", "required": True}, (0, 0, 100, 40)),
])
def test_unresolved_feature_anchor_is_review_evidence_not_a_dimension(intent, bounds):
    tree, record, _, _ = render(intent, bounds=bounds)
    assert record["status"] == "skipped_no_anchor"
    assert record["reason"] == "linear_feature_anchor_unavailable"
    assert record["rendered"] is False
    assert record["value_mm"] == intent["value_mm"]
    assert record["tolerance"] == intent["tolerance"]
    assert record["drawing_object_id"] is None
    assert not tree.findall(".//*[@data-value-mm]")
    assert not tree.findall(".//line")
    assert "REVIEW" in "".join(tree.itertext())


def test_known_thickness_cannot_label_whole_part_height_with_wrong_value():
    tree, record, _, _ = render({"id": "THK", "value_mm": 4, "required": True},
                               bounds=(0, 0, 145, 12))
    assert record["status"] == "skipped_no_anchor"
    assert record["reason"] == "linear_value_does_not_match_projected_extent"
    assert not tree.findall(".//*[@data-value-mm]")


def test_auto_value_dedupe_does_not_disguise_unresolved_feature_anchor():
    _, record, _, _ = render({"id": "SLOT_POSITION", "value_mm": 42},
        dedupe_policy="smart", existing_auto_dims=[{
            "dim_id": "auto_top_2", "category": "chain_horizontal", "value_mm": 42,
        }])
    assert record["status"] == "skipped_no_anchor"


def test_supported_overall_dimension_keeps_actual_extent_and_tolerance():
    tree, record, hs, _ = render({"id": "TOTAL_LENGTH", "value_mm": 100,
                                "tolerance": "±0.2"})
    label = tree.find(".//text[@data-dim-id='TOTAL_LENGTH']")
    assert record["status"] == "rendered"
    assert label.get("data-value-mm") == "100"
    assert "±0.2" in "".join(tree.itertext())
    dimline = tree.findall(".//line")[2]
    assert (float(dimline.get("x1")), float(dimline.get("x2"))) == (50, 150)
    assert hs == 1


def test_top_dimension_starts_its_own_rows_and_stays_inside_cell():
    tree, record, hs, _ = render({"id": "WIDTH", "value_mm": 100,
                                 "placement_side": "top"},
        h_stack=7, cell_bounds=(35, 60, 165, 160),
        annotation_planner=AnnotationPlanner())
    assert record["status"] == "rendered"
    dimline = tree.findall(".//line")[2]
    assert 60 <= float(dimline.get("y1")) < 80
    assert hs == 7  # Top rows do not consume the bottom stack.


def test_diameter_callout_relocates_as_a_unit_around_the_same_circle():
    intent = {"id": "HOLE_DIA", "value_mm": 10, "style": "diameter",
              "placement_angle_deg": 45, "tolerance": "H7"}
    before, _, _, _ = render(intent, circles=[(50, 20, 5)],
                            cell_bounds=(70, 70, 130, 130))
    text_before = before.find(".//text[@data-value-mm]")
    tx, ty = float(text_before.get("x")), float(text_before.get("y"))
    planner = AnnotationPlanner()
    planner.register(tx - 10, ty - 5, tx + 10, ty + 2)
    after, record, _, _ = render(intent, circles=[(50, 20, 5)],
        cell_bounds=(70, 70, 130, 130), annotation_planner=planner)
    label = after.find(".//text[@data-value-mm]")
    assert (label.get("x"), label.get("y")) != (text_before.get("x"), text_before.get("y"))
    assert "H7" in "".join(label.itertext())
    assert record["dim_id"] == "HOLE_DIA"
    leader, shelf = after.findall(".//line")[:2]
    assert math.hypot(float(leader.get("x1")) - 100,
                      float(leader.get("y1")) - 100) == pytest.approx(5, abs=0.01)
    assert leader.get("x2") == shelf.get("x1")
    assert leader.get("y2") == shelf.get("y1")
    assert float(label.get("y")) == pytest.approx(float(shelf.get("y1")) - 1.2, abs=0.02)


def test_wrong_radius_is_not_a_supported_diameter_anchor():
    tree, record, _, _ = render({"id": "HOLE_DIA", "style": "diameter", "value_mm": 8},
                               circles=[(50, 20, 4.5)])
    assert record["status"] == "skipped_no_anchor"
    assert record["reason"] == "no_matching_circle"
    assert not tree.findall(".//*[@data-value-mm]")
