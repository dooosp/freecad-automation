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
                expected = "plate" if thin_axis == "height" else "bracket"
                self.assertEqual(compile_config(config, classify_only=True)["part_type"], expected)

    def test_existing_thickness_threshold_is_preserved(self):
        for height, expected in ((24.9, "plate"), (25, "housing"), (40, "housing")):
            with self.subTest(height=height):
                config = mounting_plate()
                config["shapes"][0]["height"] = height
                self.assertEqual(compile_config(config, classify_only=True)["part_type"], expected)

    def test_runtime_dimensions_take_precedence_over_legacy_size(self):
        for height, size, expected in ((3, [120, 60, 40], "plate"), (40, [120, 60, 3], "housing")):
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

    def test_explicit_diameter_group_is_not_reported_as_a_typo(self):
        config = mounting_plate()
        config['drawing_plan'] = {'dim_intents': [{
            'id': 'HOLE_DIA',
            'member_feature_ids': ['hole1', 'hole2', 'hole3', 'hole4'],
        }]}
        result = subprocess.run([sys.executable, str(COMPILER)],
                                input=json.dumps(config), text=True, capture_output=True, check=True)
        assert 'member_feature_ids' not in result.stderr, result.stderr

    def test_flat_mount_has_no_invented_web_requirement(self):
        plan = compile_config(mounting_plate())["drawing_plan"]
        self.assertEqual(plan["part_type"], "plate")
        required = {intent["id"] for intent in plan["dim_intents"] if intent.get("required")}
        self.assertEqual(required, {"WIDTH", "HEIGHT", "THK", "HOLE_DIA", "BASE_W"})
        self.assertNotIn("WEB_H", {intent["id"] for intent in plan["dim_intents"]})

    def test_flat_mount_plan_keeps_length_and_width_distinct(self):
        plan = compile_config(mounting_plate())["drawing_plan"]
        values = {intent["id"]: intent["value_mm"] for intent in plan["dim_intents"]}
        self.assertEqual(values["WIDTH"], 120)
        self.assertEqual(values["BASE_W"], 60)

    def test_implicit_final_uses_last_inserted_result(self):
        config = mounting_plate()
        del config["final"]
        self.assertEqual(compile_config(config)["drawing_plan"]["part_type"], "plate")

    def test_in_place_cuts_require_explicit_plate_final(self):
        config = mounting_plate()
        del config["final"]
        for op in config["operations"]:
            op["type"] = op.pop("op")  # Supported operation alias.
            op["base"] = "plate"
            op["result"] = "plate"
        config["shapes"][1]["direction"] = [0, 0, 1]
        # In-place replacement does not change insertion order: the runtime's
        # implicit final shape is the last hole tool, not the updated plate.
        self.assertEqual(compile_config(config)["drawing_plan"]["part_type"], "bracket")
        config["final"] = "plate"
        self.assertEqual(compile_config(config)["drawing_plan"]["part_type"], "plate")

    def test_fused_web_keeps_bracket_requirement(self):
        config = mounting_plate()
        config["shapes"].append({
            "id": "web", "type": "box", "length": 120, "width": 3,
            "height": 40, "position": [0, 0, 3],
        })
        config["operations"][0]["base"] = "body"
        config["operations"].insert(0, {"op": "fuse", "base": "plate", "tool": "web", "result": "body"})
        plan = compile_config(config)["drawing_plan"]
        self.assertEqual(plan["part_type"], "bracket")
        self.assertTrue(next(intent for intent in plan["dim_intents"] if intent["id"] == "WEB_H")["required"])

    def test_explicit_bracket_keeps_web_even_for_flat_geometry(self):
        config = mounting_plate()
        config["drawing_plan"] = {"part_type": "bracket"}
        plan = compile_config(config)["drawing_plan"]
        self.assertEqual(plan["part_type"], "bracket")
        self.assertTrue(next(intent for intent in plan["dim_intents"] if intent["id"] == "WEB_H")["required"])

    def test_explicit_web_intent_and_dimension_patch_are_preserved(self):
        config = mounting_plate()
        config["drawing_plan"] = {"dim_intents": [
            {"id": "WEB_H", "feature": "web_height", "view": "front", "style": "linear",
             "required": True, "value_mm": 38, "reason": "User-requested check"},
            {"id": "WIDTH", "value_mm": 125, "view": "top"},
        ]}
        plan = compile_config(config)["drawing_plan"]
        self.assertEqual(plan["part_type"], "plate")
        intents = {intent["id"]: intent for intent in plan["dim_intents"]}
        self.assertTrue(intents["WEB_H"]["required"])
        self.assertEqual(intents["WEB_H"]["value_mm"], 38)
        self.assertEqual(intents["WEB_H"]["reason"], "User-requested check")
        self.assertEqual(intents["WIDTH"]["value_mm"], 125)
        self.assertEqual(intents["WIDTH"]["view"], "top")
        self.assertTrue(intents["WIDTH"]["required"])

    def test_plate_detection_does_not_guess_for_other_geometry(self):
        def rotate_body(config):
            config["shapes"][0]["rotation"] = [0, 1, 0, 90]

        def rotate_hole(config):
            config["shapes"][1]["rotation"] = [1, 0, 0, 90]

        def sideways_hole(config):
            config["shapes"][1]["direction"] = [1, 0, 0]

        def extra_body(config):
            config["shapes"].append({"id": "leg", "type": "box", "length": 3, "width": 60, "height": 40})

        def non_cylindrical_cut(config):
            config["shapes"][1].update(type="box", length=5, width=5)

        def unrelated_cut_chain(config):
            config["operations"][1]["base"] = "plate"

        def different_final(config):
            config["final"] = "plate"

        def extra_operation(config):
            config["operations"].append({"op": "fillet", "base": config["final"], "radius": 1, "result": "rounded"})
            config["final"] = "rounded"

        for modify in (rotate_body, rotate_hole, sideways_hole, extra_body,
                       non_cylindrical_cut, unrelated_cut_chain, different_final, extra_operation):
            with self.subTest(case=modify.__name__):
                config = mounting_plate()
                modify(config)
                self.assertEqual(compile_config(config, classify_only=True)["part_type"], "bracket")

    def test_bushing_plate_rule_still_takes_precedence(self):
        config = mounting_plate()
        for index in (5, 6):
            hole, result = f"hole{index}", f"cut{index}"
            config["shapes"].append({"id": hole, "type": "cylinder", "radius": 3, "height": 5})
            config["operations"].append({"op": "cut", "base": config["final"], "tool": hole, "result": result})
            config["final"] = result
        self.assertEqual(compile_config(config, classify_only=True)["part_type"], "bushing_plate")

    def test_plate_validation_enforces_remaining_requirements(self):
        plan = compile_config(mounting_plate())["drawing_plan"]
        plan["part_type"] = "plate"
        for missing_id in ("WIDTH", "HEIGHT", "THK", "HOLE_DIA", "BASE_W"):
            with self.subTest(missing=missing_id):
                incomplete = {**plan, "dim_intents": [intent for intent in plan["dim_intents"] if intent["id"] != missing_id]}
                result = subprocess.run(
                    [sys.executable, str(COMPILER.with_name("plan_validator.py")), "--json"],
                    input=json.dumps(incomplete), text=True, capture_output=True,
                )
                self.assertEqual(result.returncode, 1)
                validation = json.loads(result.stdout)
                self.assertTrue(any("V4:" in error and missing_id in error for error in validation["errors"]))

    def test_bracket_validation_still_rejects_a_missing_web(self):
        config = mounting_plate()
        config["drawing_plan"] = {"part_type": "bracket", "dim_intents": [{"id": "WEB_H", "remove": True}]}
        result = subprocess.run([sys.executable, str(COMPILER)], input=json.dumps(config), text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("WEB_H", result.stderr)
        self.assertIn("V4:", result.stderr)


class TestDrawingInputPrecedence(unittest.TestCase):
    def test_explicit_drawing_views_and_list_notes_override_template_defaults(self):
        config = mounting_plate()
        config["drawing"] = {
            "views": ["front", "top", "right"],
            "notes": ["EXPLICIT USER NOTE - KEEP"],
        }

        plan = compile_config(config)["drawing_plan"]

        self.assertEqual(plan["views"]["enabled"], ["front", "top", "right"])
        self.assertEqual(plan["notes"]["general"], ["EXPLICIT USER NOTE - KEEP"])
        self.assertEqual(plan["notes"]["placement"], "bottom_left")

    def test_explicit_drawing_notes_object_is_preserved(self):
        config = mounting_plate()
        config["drawing"] = {
            "notes": {"general": ["OBJECT-SHAPED USER NOTE - KEEP"]},
        }

        notes = compile_config(config)["drawing_plan"]["notes"]

        self.assertEqual(notes["general"], ["OBJECT-SHAPED USER NOTE - KEEP"])
        self.assertEqual(notes["placement"], "bottom_left")

    def test_explicit_empty_drawing_notes_do_not_restore_template_notes(self):
        config = mounting_plate()
        config["drawing"] = {"notes": []}

        notes = compile_config(config)["drawing_plan"]["notes"]

        self.assertEqual(notes["general"], [])
        self.assertEqual(notes["placement"], "bottom_left")

    def test_partial_plan_overrides_notes_while_drawing_supplies_views(self):
        config = mounting_plate()
        config["drawing"] = {
            "views": ["front", "top", "right"],
            "notes": ["DRAWING NOTE"],
        }
        config["drawing_plan"] = {
            "notes": {"general": ["EXPLICIT PLAN NOTE - KEEP"]},
        }

        plan = compile_config(config)["drawing_plan"]

        self.assertEqual(plan["views"]["enabled"], ["front", "top", "right"])
        self.assertEqual(plan["notes"]["general"], ["EXPLICIT PLAN NOTE - KEEP"])

    def test_explicit_plan_views_and_notes_win_over_drawing_fields(self):
        config = mounting_plate()
        config["drawing"] = {
            "views": ["front", "top", "right"],
            "notes": ["DRAWING NOTE"],
        }
        config["drawing_plan"] = {
            "views": {"enabled": ["front", "top", "right", "iso"]},
            "notes": {"general": ["PLAN NOTE"]},
        }

        plan = compile_config(config)["drawing_plan"]

        self.assertEqual(plan["views"]["enabled"], ["front", "top", "right", "iso"])
        self.assertEqual(plan["notes"]["general"], ["PLAN NOTE"])


if __name__ == "__main__":
    unittest.main()
