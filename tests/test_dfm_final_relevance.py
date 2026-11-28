"""DFM corner relief must describe the selected output, not an unused branch."""

import copy
import os
import sys
import tomllib
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from dfm_checker import run_dfm_check


def _slotted_plate():
    return {
        "manufacturing": {"process": "machining", "material": "AL6061"},
        "shapes": [
            {"id": "plate", "type": "box", "length": 100, "width": 80, "height": 10},
            {"id": "slot", "type": "box", "length": 20, "width": 10,
             "height": 20, "position": [40, 35, -2]},
        ],
        "operations": [{"op": "cut", "base": "plate", "tool": "slot", "result": "final"}],
        "final": "final",
    }


def _corner_check(config):
    result = run_dfm_check(config)
    checks = [check for check in result["checks"] if check["code"] == "DFM-04"]
    return result, checks


class TestDFMFinalCornerRelief(unittest.TestCase):
    def test_declared_slot_relief_without_runtime_remains_unverified(self):
        config = _slotted_plate()
        config["shapes"][1]["side_relief_radius_mm"] = 0.5
        result, checks = _corner_check(config)
        self.assertEqual(result["score"], 95)
        self.assertEqual([check["severity"] for check in checks], ["warning"])
        issue = next(issue for issue in result["issues"] if issue["rule_id"] == "DFM-04")
        self.assertIsNone(issue["actual_value"])
        self.assertEqual(issue["evidence"]["reason_code"], "slot_relief_geometry_unavailable")

    def test_disjoint_circular_through_holes_need_no_polygonal_corner_relief(self):
        fixture = Path(__file__).resolve().parents[1] / "configs/examples/quality_pass_bracket.toml"
        config = tomllib.loads(fixture.read_text())
        for with_chamfer in (True, False):
            with self.subTest(with_chamfer=with_chamfer):
                candidate = copy.deepcopy(config)
                if not with_chamfer:
                    candidate["operations"].pop()
                result, checks = _corner_check(candidate)
                self.assertEqual(result["score"], 100)
                self.assertEqual([c["severity"] for c in checks], ["info"])
                self.assertEqual(checks[0]["evidence"]["reason_code"], "corner_relief_not_applicable")
                self.assertEqual(checks[0]["evidence"]["basis"], "config_primitive_geometry")
                self.assertEqual(checks[0]["evidence"]["geometry_verification"], "not_performed")

    def test_circular_holes_with_uncertain_or_sharp_intersections_still_warn(self):
        fixture = Path(__file__).resolve().parents[1] / "configs/examples/quality_pass_bracket.toml"
        control = tomllib.loads(fixture.read_text())
        mutations = {
            "blind_hole": {"height": 6, "position": [30, 30, 2]},
            "edge_breakout": {"position": [1, 30, -2]},
            "intersecting_holes": {"position": [120, 70, -2]},
            "rotated_hole": {"rotation": [1, 0, 0, 10]},
            "tilted_direction": {"direction": [1, 0, 1]},
        }
        for name, mutation in mutations.items():
            with self.subTest(name=name):
                config = copy.deepcopy(control)
                config["shapes"][1].update(mutation)
                _, checks = _corner_check(config)
                self.assertEqual([c["severity"] for c in checks], ["warning"])

    def test_relief_that_may_merge_surfaces_keeps_geometry_unverified(self):
        fixture = Path(__file__).resolve().parents[1] / "configs/examples/quality_pass_bracket.toml"
        control = tomllib.loads(fixture.read_text())
        for relief in (
            [{"op": "chamfer", "target": "body", "size": 5, "result": "final"}],
            [{"op": "fillet", "target": "body", "radius": 2, "result": "body"},
             {"op": "chamfer", "target": "body", "size": 2, "result": "final"}],
        ):
            with self.subTest(relief=relief):
                config = copy.deepcopy(control)
                config["operations"][-1:] = relief
                _, checks = _corner_check(config)
                self.assertEqual([c["severity"] for c in checks], ["warning"])

    def test_fused_or_rotated_base_does_not_qualify_for_primitive_exemption(self):
        fixture = Path(__file__).resolve().parents[1] / "configs/examples/quality_pass_bracket.toml"
        control = tomllib.loads(fixture.read_text())
        for mutation in ("rotation", "fuse"):
            with self.subTest(mutation=mutation):
                config = copy.deepcopy(control)
                if mutation == "rotation":
                    config["shapes"][0]["rotation"] = [1, 0, 0, 10]
                else:
                    config["shapes"].append({"id": "rib", "type": "box", "length": 10,
                                             "width": 10, "height": 10})
                    config["operations"].insert(0, {"op": "fuse", "base": "plate", "tool": "rib"})
                _, checks = _corner_check(config)
                self.assertEqual([c["severity"] for c in checks], ["warning"])

    def test_unused_relief_cannot_improve_selected_part_score(self):
        control = _slotted_plate()
        baseline, _ = _corner_check(control)
        self.assertEqual(baseline["score"], 95)
        for operation in ("fillet", "chamfer"):
            with self.subTest(operation=operation):
                config = copy.deepcopy(control)
                config["shapes"].append({"id": "unused", "type": "box", "length": 20,
                                         "width": 20, "height": 20, "position": [200, 200, 0]})
                config["operations"].append({"op": operation, "target": "unused",
                                             "radius": 1, "size": 1, "result": "unused_relief"})
                result, checks = _corner_check(config)
                self.assertEqual(result["score"], 95)
                self.assertEqual([c["severity"] for c in checks], ["warning"])
                self.assertEqual(checks[0]["evidence"]["final_shape_id"], "final")
                self.assertEqual(checks[0]["evidence"]["fillet_count"], 0)
                self.assertEqual(checks[0]["evidence"]["chamfer_count"], 0)

    def test_reachable_relief_is_not_proof_that_cut_corners_were_relieved(self):
        for operation in ("fillet", "chamfer"):
            for edges in (None, [1]):
                with self.subTest(operation=operation, edges=edges):
                    config = _slotted_plate()
                    relief = {"op": operation, "target": "final", "radius": 1, "size": 1}
                    if edges:
                        relief["edges"] = edges
                    config["operations"].append(relief)
                    result, checks = _corner_check(config)
                    self.assertEqual(result["score"], 95)
                    self.assertEqual([c["severity"] for c in checks], ["warning"])
                    self.assertEqual(checks[0]["evidence"]["reason_code"], "corner_relief_unverified")
                    self.assertEqual(checks[0]["evidence"]["basis"], "config_operation_lineage")
                    issue = next(i for i in result["issues"] if i["rule_id"] == "DFM-04")
                    self.assertIsNone(issue["actual_value"])
                    self.assertIsNone(issue["feature_id"])

    def test_unused_cut_does_not_warn_on_uncut_selected_shape(self):
        config = _slotted_plate()
        config["final"] = "plate"
        result, checks = _corner_check(config)
        self.assertEqual(checks, [])
        self.assertEqual(result["score"], 100)

    def test_implicit_final_uses_last_inserted_result(self):
        config = _slotted_plate()
        del config["final"]
        config["operations"].append({"op": "fillet", "target": "plate", "radius": 1,
                                     "result": "uncut_selected"})
        _, checks = _corner_check(config)
        self.assertEqual(checks, [])

    def test_in_place_write_does_not_reorder_implicit_final(self):
        config = _slotted_plate()
        del config["final"]
        config["operations"].append({"op": "fillet", "target": "plate", "radius": 1})
        _, checks = _corner_check(config)
        self.assertEqual([c["severity"] for c in checks], ["warning"])
        self.assertEqual(checks[0]["evidence"]["final_shape_id"], "final")
        self.assertEqual(checks[0]["evidence"]["fillet_count"], 0)

    def test_reusing_result_id_does_not_add_overwritten_relief_ancestry(self):
        config = _slotted_plate()
        config["operations"].insert(0, {"op": "fillet", "target": "plate", "radius": 1,
                                        "result": "final"})
        _, checks = _corner_check(config)
        self.assertEqual([c["severity"] for c in checks], ["warning"])
        self.assertEqual(checks[0]["evidence"]["fillet_count"], 0)

    def test_relief_before_cut_remains_unverified(self):
        config = _slotted_plate()
        config["operations"].insert(0, {"op": "fillet", "target": "plate", "radius": 1})
        _, checks = _corner_check(config)
        self.assertEqual([c["severity"] for c in checks], ["warning"])
        self.assertEqual(checks[0]["evidence"]["reason_code"], "corner_relief_unverified")

    def test_missing_final_keeps_explicit_metadata_fallback(self):
        config = _slotted_plate()
        config["final"] = "missing"
        config["operations"].append({"op": "fillet", "target": "final", "radius": 1})
        _, checks = _corner_check(config)
        self.assertEqual([c["severity"] for c in checks], ["warning"])
        self.assertEqual(checks[0]["evidence"]["basis"], "config_operation_fallback")
        self.assertEqual(checks[0]["confidence"], "low")


if __name__ == "__main__":
    unittest.main()
