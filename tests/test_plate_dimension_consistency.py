"""Keep box footprint values and SVG dimension axes consistent."""

from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from feature_extractor import extract_values
from _dim_plan import render_plan_dimensions_svg


def plate_config(length=120, width=60):
    return {"shapes": [{"id": "plate", "type": "box", "length": length, "width": width, "height": 3}]}


def width_intent(**changes):
    return {"id": "BASE_W", "feature": "base_width", "style": "linear",
            "view": "top", "value_mm": 60, "required": True, **changes}


def render(intent, view="top", auto_dims=None, policy="off"):
    bounds = (0, 0, 60, 3) if view == "right" else (0, 0, 120, 60)
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        [intent], view, bounds, [], [], 100, 100, 1, 0, 0,
        existing_auto_dims=auto_dims, dedupe_policy=policy, telemetry=telemetry,
    )
    return svg, telemetry


def line_spans(svg):
    return {
        (round(abs(float(line.attrib["x2"]) - float(line.attrib["x1"])), 2),
         round(abs(float(line.attrib["y2"]) - float(line.attrib["y1"])), 2))
        for line in ET.fromstring(svg).iter("line")
    }


class TestPlateValues(unittest.TestCase):
    def test_base_length_uses_box_length_instead_of_width(self):
        for length, width in ((120, 60), (80, 35)):
            with self.subTest(length=length, width=width):
                intents = [{"id": "WIDTH", "feature": "base_length", "required": True}]
                value = extract_values(plate_config(length, width), None, intents)[0]
                self.assertEqual(value["value_mm"], length)
                self.assertEqual(value["source"], "shapes.plate.length")
                self.assertNotIn("value_mm", intents[0])

    def test_footprint_feature_keeps_its_meaning_with_custom_intent_ids(self):
        intents = [
            {"id": "PLATE_X", "feature": "base_length"},
            {"id": "PLATE_Y", "feature": "base_width"},
        ]
        values = extract_values(plate_config(), None, intents)
        self.assertEqual([value["value_mm"] for value in values], [120, 60])

    def test_explicit_nominal_value_is_not_overwritten(self):
        intent = {"id": "WIDTH", "feature": "base_length", "value_mm": 119.8}
        value = extract_values(plate_config(), None, [intent])[0]
        self.assertEqual(value["value_mm"], 119.8)
        self.assertEqual(value["source"], "user_override")

    def test_taller_leg_does_not_replace_the_base_footprint(self):
        config = plate_config(length=180, width=95)
        config["shapes"][0]["height"] = 2
        config["shapes"].append({
            "id": "leg", "type": "box", "length": 20, "width": 60,
            "height": 80, "position": [0, 0, 2],
        })
        config["operations"] = [{"op": "fuse", "base": "plate", "tool": "leg", "result": "body"}]
        intents = [{"id": "WIDTH", "feature": "base_length"},
                   {"id": "BASE_W", "feature": "base_width"}]
        values = extract_values(config, None, intents)
        self.assertEqual([value["value_mm"] for value in values], [180, 95])
        self.assertEqual([value["source"] for value in values],
                         ["shapes.plate.length", "shapes.plate.width"])


class TestPlateDimensionOrientation(unittest.TestCase):
    def test_top_width_dimension_spans_y_not_the_longer_x_axis(self):
        svg, telemetry = render(width_intent())
        self.assertIn((0, 60), line_spans(svg))
        self.assertNotIn((120, 0), line_spans(svg))
        text = ET.fromstring(svg).find("text")
        self.assertEqual(text.text, "60")
        self.assertEqual(telemetry["plan_dimensions"][0]["status"], "rendered")

    def test_top_width_uses_feature_when_intent_id_is_custom(self):
        svg, _ = render(width_intent(id="PLATE_Y"))
        self.assertIn((0, 60), line_spans(svg))

    def test_width_uses_actual_render_view_when_target_is_unspecified(self):
        svg, _ = render(width_intent(view=""))
        self.assertIn((0, 60), line_spans(svg))

    def test_right_width_remains_horizontal(self):
        svg, _ = render(width_intent(view="right"), view="right")
        self.assertIn((60, 0), line_spans(svg))

    def test_smart_dedupe_matches_vertical_auto_width(self):
        auto = [
            {"dim_id": "x_distance", "category": "chain_horizontal", "value_mm": 60},
            {"dim_id": "y_extent", "category": "overall_height", "value_mm": 60},
        ]
        svg, telemetry = render(width_intent(), auto_dims=auto, policy="smart")
        self.assertEqual(svg, "")
        record = telemetry["plan_dimensions"][0]
        self.assertEqual(record["status"], "skipped_duplicate")
        self.assertEqual(record["dedupe_match"]["auto_dim_id"], "y_extent")

    def test_equal_horizontal_value_does_not_suppress_vertical_width(self):
        auto = [{"dim_id": "x_distance", "category": "chain_horizontal", "value_mm": 60}]
        svg, telemetry = render(width_intent(), auto_dims=auto, policy="smart")
        self.assertEqual(telemetry["plan_dimensions"][0]["status"], "rendered")
        self.assertIn((0, 60), line_spans(svg))


if __name__ == "__main__":
    unittest.main()
