"""Automatic extent telemetry must identify the actual SVG value label."""

from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _drawing_svg import render_dimensions_svg


class TestAutomaticExtentEvidence(unittest.TestCase):
    def test_extent_records_point_to_unique_numeric_labels_across_views(self):
        telemetry = {}
        svg_parts = []
        for view, bounds in (("front", (0, 0, 120, 3)), ("top", (0, 0, 120, 60))):
            svg_parts.append(render_dimensions_svg(
                view, bounds, [], 100, 100, 0.5, telemetry=telemetry,
            ))
        root = ET.fromstring('<svg>' + ''.join(svg_parts) + '</svg>')
        records = telemetry["auto_dimensions"]
        self.assertEqual(len(records), 4)
        ids = []
        for record in records:
            with self.subTest(record=record["dim_id"]):
                element_id = record.get("svg_element_id")
                self.assertIsNotNone(element_id, "telemetry must link to a real SVG element")
                labels = [node for node in root.iter("text") if node.get("id") == element_id]
                self.assertEqual(len(labels), 1)
                self.assertEqual(float(labels[0].text), record["value_mm"])
                self.assertEqual('transform' in labels[0].attrib, record["category"] == "overall_height")
                ids.append(element_id)
        self.assertEqual(len(set(ids)), len(ids))

    def test_identity_attributes_do_not_change_drawing_geometry_or_labels(self):
        args = ("front", (0, 0, 120, 3), [], 100, 100, 0.5)
        plain = ET.fromstring(render_dimensions_svg(*args))
        identified = ET.fromstring(render_dimensions_svg(*args, telemetry={}))
        for node in identified.iter("text"):
            node.attrib.pop("id", None)
        self.assertEqual(ET.tostring(identified), ET.tostring(plain))

    def test_cross_view_suppression_does_not_claim_an_absent_label(self):
        telemetry = {}
        dedupe = {"enabled": True}
        render_dimensions_svg("front", (0, 0, 120, 3), [], 100, 100, 0.5,
                              telemetry=telemetry, dedupe_state=dedupe)
        svg = render_dimensions_svg("top", (0, 0, 120, 60), [], 100, 100, 0.5,
                                    telemetry=telemetry, dedupe_state=dedupe)
        top = [record for record in telemetry["auto_dimensions"] if record["view"] == "top"]
        self.assertEqual([record["category"] for record in top], ["overall_height"])
        root = ET.fromstring(svg)
        self.assertEqual([node.get("id") for node in root.iter("text")], [top[0]["svg_element_id"]])


if __name__ == "__main__":
    unittest.main()
