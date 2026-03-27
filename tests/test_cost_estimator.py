#!/usr/bin/env python3
"""Cost estimator regression tests for canonical op handling and analysis linkage."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from cost_estimator import estimate_cost


class TestCostEstimatorCanonicalOps(unittest.TestCase):
    def test_canonical_op_key_counts_features(self):
        cfg = {
            "material": "SS304",
            "manufacturing": {"process": "machining", "material": "SS304"},
            "shapes": [
                {"id": "body", "type": "box", "length": 100, "width": 50, "height": 20},
                {"id": "hole", "type": "cylinder", "radius": 5, "height": 25},
            ],
            "operations": [
                {"op": "cut", "base": "body", "tool": "hole"},
                {"op": "fillet", "target": "body", "radius": 1.0},
                {"op": "circular_pattern", "target": "hole", "count": 4},
            ],
            "tolerance": {"pairs": [{}, {}]},
        }

        result = estimate_cost(cfg)

        self.assertEqual(result["details"]["faces"], 19)
        self.assertEqual(result["details"]["holes"], 4)
        self.assertEqual(result["details"]["fillets"], 1)
        self.assertEqual(result["breakdown"]["inspection"], 16000)
        self.assertGreater(result["breakdown"]["machining"], 80000)

    def test_analysis_result_fields_feed_cost_inputs(self):
        cfg = {
            "material": "AL6061",
            "manufacturing": {"process": "machining", "material": "AL6061"},
            "shapes": [
                {"id": "body", "type": "box", "length": 40, "width": 30, "height": 10},
            ],
            "operations": [],
            "tolerance_results": {"pairs": [{}, {}, {}]},
            "dfm_results": {"score": 70},
        }

        result = estimate_cost(cfg)

        self.assertEqual(result["breakdown"]["inspection"], 24000)
        self.assertEqual(result["details"]["defect_factor"], 1.15)
        self.assertIsNotNone(result["dfm_savings"])


if __name__ == "__main__":
    unittest.main()
