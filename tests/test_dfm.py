#!/usr/bin/env python3
"""DFM Checker + D4 Manufacturing Strategy Tests.

Tests:
  1. Normal config → 0 errors, high score
  2. Thin wall → DFM-01 error
  3. Hole near edge → DFM-02 error
  4. Close holes → DFM-03 warning
  5. No fillet/chamfer → DFM-04 warning
  6. Deep drill → DFM-05 warning
  7. Undercut → DFM-06 warning
  8. Process-specific constraints (casting vs machining)
  9. D4 preset → dim_intents have process_step + tolerance_grade
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from dfm_checker import run_dfm_check, PROCESS_CONSTRAINTS


def _base_config(extra_shapes=None, extra_ops=None, manufacturing=None):
    """Build a minimal config for testing."""
    shapes = [
        {"id": "disc", "type": "cylinder", "radius": 100, "height": 20, "position": [0, 0, 0]},
    ]
    ops = []
    if extra_shapes:
        shapes.extend(extra_shapes)
    if extra_ops:
        ops.extend(extra_ops)
    cfg = {"shapes": shapes, "operations": ops}
    if manufacturing:
        cfg["manufacturing"] = manufacturing
    return cfg


class TestDFM01WallThickness(unittest.TestCase):
    """DFM-01: Minimum wall thickness."""

    def test_no_holes_no_errors(self):
        cfg = _base_config()
        result = run_dfm_check(cfg)
        errors = [c for c in result["checks"] if c["code"] == "DFM-01"]
        self.assertEqual(len(errors), 0)

    def test_thin_wall_error(self):
        """Hole very close to edge → wall < min_wall (1.5mm for machining)."""
        # Position 94.5, radius 5 → wall = 100 - 94.5 - 5 = 0.5mm < 1.5mm
        cfg = _base_config(
            extra_shapes=[
                {"id": "hole1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [94.5, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "hole1"}],
        )
        result = run_dfm_check(cfg)
        dfm01 = [c for c in result["checks"] if c["code"] == "DFM-01"]
        self.assertTrue(any(c["severity"] == "error" for c in dfm01),
                        f"Expected DFM-01 error, got: {dfm01}")


class TestDFM02HoleEdge(unittest.TestCase):
    """DFM-02: Hole-to-edge minimum distance."""

    def test_hole_far_from_edge(self):
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [50, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "h1"}],
        )
        result = run_dfm_check(cfg)
        dfm02 = [c for c in result["checks"] if c["code"] == "DFM-02"]
        self.assertEqual(len(dfm02), 0, f"Expected no DFM-02, got: {dfm02}")

    def test_hole_near_edge_error(self):
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [92, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "h1"}],
        )
        result = run_dfm_check(cfg)
        dfm02 = [c for c in result["checks"] if c["code"] == "DFM-02"]
        self.assertTrue(len(dfm02) > 0, "Expected DFM-02 error for near-edge hole")

    def test_central_bore_excluded(self):
        """Central bore should be excluded from DFM-02."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "bore", "type": "cylinder", "radius": 30,
                 "height": 25, "position": [0, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "bore"}],
        )
        result = run_dfm_check(cfg)
        dfm02 = [c for c in result["checks"] if c["code"] == "DFM-02"]
        self.assertEqual(len(dfm02), 0, "Central bore should not trigger DFM-02")


class TestDFM03HoleSpacing(unittest.TestCase):
    """DFM-03: Hole-to-hole minimum spacing."""

    def test_close_holes_warning(self):
        # Center dist = 15, edge gap = 15-5-5 = 5mm < 1.0 × 10mm = 10mm
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [40, 0, -2]},
                {"id": "h2", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [55, 0, -2]},
            ],
            extra_ops=[
                {"op": "cut", "base": "disc", "tool": "h1"},
                {"op": "cut", "base": "disc", "tool": "h2"},
            ],
        )
        result = run_dfm_check(cfg)
        dfm03 = [c for c in result["checks"] if c["code"] == "DFM-03"]
        self.assertTrue(len(dfm03) > 0, "Expected DFM-03 warning for close holes")


class TestDFM04FilletChamfer(unittest.TestCase):
    """DFM-04: Missing fillet/chamfer on internal corners."""

    def test_no_chamfer_warning(self):
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [50, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "h1"}],
        )
        result = run_dfm_check(cfg)
        dfm04 = [c for c in result["checks"] if c["code"] == "DFM-04"]
        self.assertTrue(len(dfm04) > 0, "Expected DFM-04 warning without chamfer")

    def test_with_chamfer_no_error(self):
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [50, 0, -2]},
            ],
            extra_ops=[
                {"op": "cut", "base": "disc", "tool": "h1"},
                {"op": "chamfer", "target": "disc", "size": 1.0},
            ],
        )
        result = run_dfm_check(cfg)
        dfm04_err = [c for c in result["checks"]
                     if c["code"] == "DFM-04" and c["severity"] in ("error", "warning")]
        self.assertEqual(len(dfm04_err), 0)


class TestDFM05DrillRatio(unittest.TestCase):
    """DFM-05: Drill depth-to-diameter ratio."""

    def test_deep_drill_warning(self):
        """60mm deep, 5mm diameter = 6:1 ratio > machining max 5:1."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "deep_hole", "type": "cylinder", "radius": 2.5,
                 "height": 60, "position": [50, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "deep_hole"}],
        )
        result = run_dfm_check(cfg)
        dfm05 = [c for c in result["checks"] if c["code"] == "DFM-05"]
        self.assertTrue(len(dfm05) > 0, "Expected DFM-05 warning for deep drill")

    def test_normal_drill_ok(self):
        """20mm deep, 10mm diameter = 2:1 ratio, well within limits."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "normal_hole", "type": "cylinder", "radius": 5,
                 "height": 20, "position": [50, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "normal_hole"}],
        )
        result = run_dfm_check(cfg)
        dfm05 = [c for c in result["checks"] if c["code"] == "DFM-05"]
        self.assertEqual(len(dfm05), 0, f"Unexpected DFM-05: {dfm05}")


class TestDFM06Undercut(unittest.TestCase):
    """DFM-06: Undercut detection."""

    def test_undercut_coaxial_warning(self):
        """Two coaxial holes with different radii = potential undercut."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "large_bore", "type": "cylinder", "radius": 15,
                 "height": 25, "position": [0, 0, -2]},
                {"id": "small_bore", "type": "cylinder", "radius": 8,
                 "height": 30, "position": [0, 0, -5]},
            ],
            extra_ops=[
                {"op": "cut", "base": "disc", "tool": "large_bore"},
                {"op": "cut", "base": "disc", "tool": "small_bore"},
            ],
        )
        result = run_dfm_check(cfg)
        dfm06 = [c for c in result["checks"] if c["code"] == "DFM-06"]
        self.assertTrue(len(dfm06) > 0, "Expected DFM-06 for coaxial step")

    def test_counterbore_info_not_warning(self):
        """Counterbore (larger+shallower) should be info, not warning."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "bolt_hole", "type": "cylinder", "radius": 6,
                 "height": 25, "position": [50, 0, -2]},
                {"id": "counterbore", "type": "cylinder", "radius": 10,
                 "height": 7, "position": [50, 0, 10]},
            ],
            extra_ops=[
                {"op": "cut", "base": "disc", "tool": "bolt_hole"},
                {"op": "cut", "base": "disc", "tool": "counterbore"},
            ],
        )
        result = run_dfm_check(cfg)
        dfm06 = [c for c in result["checks"] if c["code"] == "DFM-06"]
        for c in dfm06:
            self.assertEqual(c["severity"], "info",
                             f"Counterbore should be 'info', got '{c['severity']}'")


class TestProcessConstraints(unittest.TestCase):
    """Process-specific constraint differences."""

    def test_casting_stricter_wall(self):
        self.assertEqual(PROCESS_CONSTRAINTS["casting"]["min_wall"], 3.0)
        self.assertEqual(PROCESS_CONSTRAINTS["machining"]["min_wall"], 1.5)

    def test_3d_printing_relaxed(self):
        self.assertEqual(PROCESS_CONSTRAINTS["3d_printing"]["max_drill_ratio"], 20.0)

    def test_process_override(self):
        """Config manufacturing.process should change constraints."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [50, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "h1"}],
            manufacturing={"process": "3d_printing"},
        )
        result = run_dfm_check(cfg)
        self.assertEqual(result["process"], "3d_printing")


class TestDFMScore(unittest.TestCase):
    """Score calculation."""

    def test_clean_config_high_score(self):
        """Config with no issues should score 100."""
        cfg = _base_config(manufacturing={"process": "machining"})
        result = run_dfm_check(cfg)
        self.assertEqual(result["score"], 100)

    def test_score_deduction(self):
        """Errors and warnings should reduce score."""
        cfg = _base_config(
            extra_shapes=[
                {"id": "h1", "type": "cylinder", "radius": 5,
                 "height": 25, "position": [92, 0, -2]},
            ],
            extra_ops=[{"op": "cut", "base": "disc", "tool": "h1"}],
        )
        result = run_dfm_check(cfg)
        self.assertLess(result["score"], 100)


class TestD4ManufacturingStrategy(unittest.TestCase):
    """D4 manufacturing dimension strategy via intent_compiler."""

    def test_d4_process_step_assignment(self):
        """D4 scheme should assign process_step to dim_intents."""
        from intent_compiler import merge_plan

        config = {
            "drawing_plan": {
                "dimensioning": {
                    "scheme": "manufacturing",
                    "process_sequence": ["face", "rough_turn", "bore", "drill", "finish_turn"],
                    "tolerance_grade_mapping": True,
                    "functional_surface_priority": True,
                },
                "dim_intents": [
                    {"id": "OD", "feature": "outer_diameter", "view": "front",
                     "style": "diameter", "required": True, "priority": 90},
                    {"id": "ID", "feature": "inner_diameter", "view": "front",
                     "style": "diameter", "required": True, "priority": 85},
                    {"id": "THK", "feature": "thickness", "view": "right",
                     "style": "linear", "required": True, "priority": 75},
                ],
            }
        }
        plan = merge_plan(config, None)

        intents = plan["dim_intents"]
        # THK → face, OD → rough_turn, ID → bore
        steps = {di["id"]: di.get("process_step") for di in intents}
        self.assertEqual(steps["THK"], "face")
        self.assertEqual(steps["OD"], "rough_turn")
        self.assertEqual(steps["ID"], "bore")

        # Tolerance grades should be assigned
        grades = {di["id"]: di.get("tolerance_grade") for di in intents}
        self.assertEqual(grades["ID"], "IT7")
        self.assertEqual(grades["THK"], "IT11")

    def test_d4_sorting_by_process(self):
        """D4 should sort dim_intents by process sequence."""
        from intent_compiler import merge_plan

        config = {
            "drawing_plan": {
                "dimensioning": {
                    "scheme": "manufacturing",
                    "process_sequence": ["face", "rough_turn", "bore"],
                },
                "dim_intents": [
                    {"id": "ID", "feature": "inner_diameter", "view": "front",
                     "style": "diameter", "required": True, "priority": 85},
                    {"id": "THK", "feature": "thickness", "view": "right",
                     "style": "linear", "required": True, "priority": 75},
                    {"id": "OD", "feature": "outer_diameter", "view": "front",
                     "style": "diameter", "required": True, "priority": 90},
                ],
            }
        }
        plan = merge_plan(config, None)
        ids = [di["id"] for di in plan["dim_intents"]]
        # face(THK) → rough_turn(OD) → bore(ID)
        self.assertEqual(ids, ["THK", "OD", "ID"])

    def test_d4_process_groups_tag(self):
        """D4 should tag _process_groups in dimensioning."""
        from intent_compiler import merge_plan

        config = {
            "drawing_plan": {
                "dimensioning": {"scheme": "manufacturing"},
                "dim_intents": [
                    {"id": "OD", "feature": "outer_diameter", "view": "front",
                     "style": "diameter", "required": True, "priority": 90},
                ],
            }
        }
        plan = merge_plan(config, None)
        self.assertIn("_process_groups", plan["dimensioning"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
