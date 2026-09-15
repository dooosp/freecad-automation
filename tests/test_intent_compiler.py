"""Regression coverage for box classification through the intent compiler CLI."""

import json
from pathlib import Path
import subprocess
import sys
import unittest


COMPILER = Path(__file__).resolve().parents[1] / "scripts" / "intent_compiler.py"


def mounting_plate():
    config = {
        "name": "device_mount",
        "shapes": [{"id": "plate", "type": "box", "length": 120, "width": 60, "height": 3}],
        "operations": [],
    }
    base = "plate"
    for index, (x, y) in enumerate(((12, 12), (108, 12), (12, 48), (108, 48)), 1):
        hole, result = f"hole{index}", f"cut{index}"
        config["shapes"].append({
            "id": hole, "type": "cylinder", "radius": 2.25,
            "height": 5, "position": [x, y, -1],
        })
        config["operations"].append({"op": "cut", "base": base, "tool": hole, "result": result})
        base = result
    config["final"] = base
    return config


def compile_config(config, *, classify_only=False):
    command = [sys.executable, str(COMPILER)]
    if classify_only:
        command.append("--classify-only")
    result = subprocess.run(command, input=json.dumps(config), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class TestBoxClassification(unittest.TestCase):
    def test_thin_box_uses_all_supported_dimension_fields(self):
        for thin_axis in ("length", "width", "height"):
            with self.subTest(thin_axis=thin_axis):
                config = mounting_plate()
                config["shapes"][0].update(length=120, width=60, height=40)
                config["shapes"][0][thin_axis] = 3
                self.assertEqual(compile_config(config, classify_only=True)["part_type"], "bracket")

    def test_existing_thickness_threshold_is_preserved(self):
        for height, expected in ((24.9, "bracket"), (25, "housing"), (40, "housing")):
            with self.subTest(height=height):
                config = mounting_plate()
                config["shapes"][0]["height"] = height
                self.assertEqual(compile_config(config, classify_only=True)["part_type"], expected)

    def test_runtime_dimensions_take_precedence_over_legacy_size(self):
        for height, size, expected in ((3, [120, 60, 40], "bracket"), (40, [120, 60, 3], "housing")):
            with self.subTest(height=height):
                config = mounting_plate()
                config["shapes"][0].update(height=height, size=size)
                self.assertEqual(compile_config(config, classify_only=True)["part_type"], expected)

    def test_legacy_size_fallback_is_preserved(self):
        config = mounting_plate()
        config["shapes"][0] = {"id": "plate", "type": "box", "size": [120, 60, 3]}
        self.assertEqual(compile_config(config, classify_only=True)["part_type"], "bracket")

    def test_thin_cut_tool_does_not_make_thick_body_a_bracket(self):
        config = mounting_plate()
        config["shapes"][0].update(length=170, width=125, height=48)
        config["shapes"].append({
            "id": "connector_port", "type": "box", "length": 38, "width": 28,
            "height": 18, "position": [120, 48, 10],
        })
        config["operations"].append({
            "op": "cut", "base": config["final"], "tool": "connector_port", "result": "housing",
        })
        config["final"] = "housing"
        self.assertEqual(compile_config(config, classify_only=True)["part_type"], "housing")

    def test_missing_dimensions_do_not_imply_thin_plate(self):
        config = mounting_plate()
        config["shapes"][0] = {"id": "plate", "type": "box"}
        self.assertEqual(compile_config(config, classify_only=True)["part_type"], "housing")

    def test_section_hint_still_selects_housing(self):
        config = mounting_plate()
        config["drawing"] = {"section": {"enabled": True}}
        self.assertEqual(compile_config(config, classify_only=True)["part_type"], "housing")

    def test_explicit_part_type_still_selects_its_template(self):
        config = mounting_plate()
        config["drawing_plan"] = {"part_type": "housing"}
        plan = compile_config(config)["drawing_plan"]
        self.assertEqual(plan["part_type"], "housing")
        self.assertIn("BORE_ID", {intent["id"] for intent in plan["dim_intents"]})

    def test_flat_mount_selects_existing_bracket_template(self):
        plan = compile_config(mounting_plate())["drawing_plan"]
        self.assertEqual(plan["part_type"], "bracket")
        required = {intent["id"] for intent in plan["dim_intents"] if intent.get("required")}
        self.assertTrue({"THK", "HOLE_DIA"}.issubset(required))
        self.assertTrue({"BORE_ID", "BEARING_SEAT", "WALL_THK"}.isdisjoint(required))


if __name__ == "__main__":
    unittest.main()
