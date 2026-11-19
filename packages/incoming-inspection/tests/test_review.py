import unittest
from decimal import localcontext

from incoming_inspection.evaluate import evaluate


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.characteristic = {
            "id": "H1", "drawing_ref": "B / sheet 1 / A3", "unit": "mm",
            "lower": "9.90", "upper": "10.10", "samples": ["S1", "S2", "S3"],
        }
        self.requirements = {
            "part": "P12", "revision": "B", "characteristics": [self.characteristic],
        }

    def row(self, number, sample, value, **changes):
        row = {
            "row": number, "cells": [],
            "part": "P12", "revision": "B", "lot": "L42",
            "sample": sample, "characteristic": "H1", "value": value,
            "unit": "mm", "supplier_result": "합격", "supplier": None,
        }
        row.update(changes)
        return row

    def review(self, *rows):
        return evaluate(self.requirements, rows, supplier="A", lot="L42")

    def test_bracket_boundaries_mismatch_and_missing(self):
        result = self.review(self.row(1, "S1", "10.10"), self.row(2, "S2", "10.20"))
        first, second, third = result["results"]
        self.assertEqual(first["computed_result"], "in_tolerance")
        self.assertEqual(first["source_rows"], [1])
        self.assertEqual(second["computed_result"], "out_of_tolerance")
        self.assertEqual(second["supplier_result"], "합격")
        self.assertEqual(second["reasons"], ["above_upper_limit", "supplier_result_mismatch"])
        self.assertEqual(second["deviation_mm"], "0.1")
        self.assertEqual(third["computed_result"], "missing")
        self.assertEqual(third["reasons"], ["missing_measurement"])
        self.assertEqual(third["drawing_ref"], "B / sheet 1 / A3")
        self.assertEqual(third["source_rows"], [])

    def test_inch_conversion_and_inclusive_lower_limit(self):
        self.characteristic.update(unit="inch", lower="0.35", upper="0.45")
        result = self.review(
            self.row(1, "S1", "8.89"),
            self.row(2, "S2", "0.34", unit="inch"),
            self.row(3, "S3", "0.45", unit="in"),
        )
        first, second, third = result["results"]
        self.assertEqual(first["computed_result"], "in_tolerance")
        self.assertEqual(second["computed_result"], "out_of_tolerance")
        self.assertEqual(second["measured_mm"], "8.636")
        self.assertEqual(second["deviation_mm"], "0.254")
        self.assertEqual(third["computed_result"], "in_tolerance")

    def test_no_rounding_before_comparison_even_with_low_ambient_precision(self):
        value = "1.00000000000000000000000000000000000000000000000001"
        self.characteristic.update(lower="0", upper="1")
        with localcontext() as context:
            context.prec = 8
            result = self.review(self.row(1, "S1", value))
        first = result["results"][0]
        self.assertEqual(first["computed_result"], "out_of_tolerance")
        self.assertEqual(first["measured_mm"], value)
        self.assertEqual(first["deviation_mm"], "0.00000000000000000000000000000000000000000000000001")

    def test_blank_invalid_and_unknown_unit_remain_unevaluable(self):
        result = self.review(
            self.row(1, "S1", ""), self.row(2, "S2", "NaN"),
            self.row(3, "S3", "10", unit="cm"),
        )
        self.assertEqual(
            [(item["computed_result"], item["reasons"]) for item in result["results"]],
            [("cannot_evaluate", ["invalid_measurement"]),
             ("cannot_evaluate", ["invalid_measurement"]),
             ("cannot_evaluate", ["invalid_measurement_unit"])],
        )

    def test_unrepresentable_exponent_is_reported_instead_of_crashing(self):
        first = self.review(self.row(1, "S1", "1e" + "9" * 40))["results"][0]
        self.assertEqual(first["computed_result"], "cannot_evaluate")
        self.assertEqual(first["reasons"], ["invalid_measurement"])

    def test_missing_or_reversed_limits_are_reported(self):
        for lower, upper in ((None, "10.10"), ("10.10", "9.90"), ("NaN", "10.10")):
            with self.subTest(lower=lower, upper=upper):
                self.characteristic.update(lower=lower, upper=upper)
                first = self.review(self.row(1, "S1", "10"))["results"][0]
                self.assertEqual(first["computed_result"], "cannot_evaluate")
                self.assertEqual(first["reasons"], ["invalid_limits"])
                self.assertEqual(first["measured_mm"], "10")

    def test_all_conflicting_rows_stay_attached(self):
        result = self.review(
            self.row(1, "S1", "10"), self.row(2, "S1", "11"),
            self.row(3, "S2", "10", characteristic="UNKNOWN"),
            self.row(4, "S4", "10"),
        )
        first, second, _ = result["results"]
        self.assertEqual(first["computed_result"], "cannot_evaluate")
        self.assertEqual(first["source_rows"], [1, 2])
        self.assertEqual(first["reasons"], ["duplicate_measurement"])
        self.assertEqual(second["computed_result"], "missing")
        self.assertEqual(
            [(item["row"], item["reasons"]) for item in result["unmatched_rows"]],
            [(3, ["unknown_characteristic"]), (4, ["unexpected_sample"])],
        )

    def test_wrong_part_revision_lot_and_supplier_do_not_fill_required_pairs(self):
        result = self.review(
            self.row(1, "S1", "10", part="P13"),
            self.row(2, "S2", "10", revision="A", lot="L41"),
            self.row(3, "S3", "10", supplier="B"),
        )
        self.assertEqual([item["computed_result"] for item in result["results"]], ["missing"] * 3)
        self.assertEqual(
            [item["reasons"] for item in result["unmatched_rows"]],
            [["part_mismatch"], ["revision_mismatch", "lot_mismatch"], ["supplier_mismatch"]],
        )

    def test_supplier_outcomes_are_kept_separate(self):
        result = self.review(
            self.row(1, "S1", "10", supplier_result="FAIL"),
            self.row(2, "S2", "10", supplier_result="RECHECK"),
            self.row(3, "S3", "10", supplier_result=""),
        )
        first, second, third = result["results"]
        self.assertEqual(first["computed_result"], "in_tolerance")
        self.assertEqual(first["reasons"], ["supplier_result_mismatch"])
        self.assertEqual(second["supplier_result"], "RECHECK")
        self.assertEqual(second["reasons"], [])
        self.assertIsNone(third["supplier_result"])
