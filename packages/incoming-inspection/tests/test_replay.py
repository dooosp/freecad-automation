import unittest
from copy import deepcopy

from incoming_inspection.diff import compare_reviews


def make_review(values=(), *, lot="L42"):
    records = {}
    rows = []
    unmatched = []
    for number, (sample, value, reason) in enumerate(values, 1):
        rows.append({"row": number, "cells": [sample, value]})
        if sample in {"S1", "S2", "S3"}:
            records.setdefault(sample, []).append((number, value, reason))
        else:
            unmatched.append({
                "row": number, "characteristic": "H1", "sample": sample,
                "reasons": ["unexpected_sample"],
            })
    results = []
    for sample in ("S1", "S2", "S3"):
        matches = records.get(sample, [])
        computed_result, measured, reasons = "missing", None, ["missing_measurement"]
        if len(matches) > 1:
            computed_result, reasons = "cannot_evaluate", ["duplicate_measurement"]
        elif matches:
            _, measured, reason = matches[0]
            if not reason:
                computed_result, reasons = "in_tolerance", []
            else:
                computed_result, reasons = "out_of_tolerance", [reason, "supplier_result_mismatch"]
        results.append({
            "characteristic": "H1", "sample": sample, "drawing_ref": "B2",
            "unit": "mm", "lower": "9.90", "upper": "10.10",
            "measured_mm": measured, "measured_value": measured,
            "measured_unit": "mm" if measured is not None else None,
            "deviation_mm": "0.10" if computed_result == "out_of_tolerance" else None,
            "supplier_result": "pass" if measured is not None else None,
            "computed_result": computed_result, "reasons": reasons,
            "source_rows": [number for number, _, _ in matches],
        })
    return {
        "schema_version": 1,
        "rule_version": "1",
        "identity": {"part": "P", "revision": "B", "lot": lot, "supplier": "A"},
        "supplier_source": "operator",
        "inputs": {
            name: {"path": filename, "sha256": digest * 64}
            for name, filename, digest in (
                ("requirements", "requirements.json", "a"),
                ("mapping", "mapping.json", "b"),
                ("measurements", "measurements.csv", "c"),
            )
        },
        "requirements": {"part": "P", "revision": "B", "characteristics": [
            {"id": "H1", "unit": "mm", "lower": "9.90", "upper": "10.10",
             "drawing_ref": "B2", "samples": ["S1", "S2", "S3"]},
        ]},
        "source": {"headers": ["sample", "value"], "rows": rows},
        "results": results,
        "unmatched_rows": unmatched,
    }


class ComparisonTests(unittest.TestCase):
    def test_resubmission_preserves_both_sources_and_unresolved_missing(self):
        before = make_review([("S1", "10.10", None), ("S2", "10.20", "above_upper_limit")])
        after = make_review([("S2", "10.02", None), ("S1", "10.1000", None)])
        after["inputs"]["measurements"]["sha256"] = "d" * 64
        comparison = compare_reviews(before, after)
        self.assertEqual(comparison["mode"], "comparison")
        self.assertEqual(
            [(item["sample"], item["kind"]) for item in comparison["changes"]],
            [("S2", "changed"), ("S3", "unresolved")],
        )
        changed = comparison["changes"][0]
        self.assertEqual((changed["before"]["measured_mm"], changed["after"]["measured_mm"]),
                         ("10.20", "10.02"))
        self.assertEqual((changed["before"]["source_rows"], changed["after"]["source_rows"]), ([2], [1]))
        self.assertNotEqual(comparison["before"]["inputs"]["measurements"]["sha256"],
                            comparison["after"]["inputs"]["measurements"]["sha256"])

    def test_added_and_removed_measurements_have_required_context_on_both_sides(self):
        compared = compare_reviews(make_review([("S1", "10.10", None)]),
                                   make_review([("S2", "10.01", None)]))
        self.assertEqual([(row["sample"], row["kind"]) for row in compared["changes"]],
                         [("S1", "removed"), ("S2", "added"), ("S3", "unresolved")])
        self.assertEqual(compared["changes"][1]["before"]["drawing_ref"], "B2")

    def test_unresolved_duplicate_and_unmatched_rows_survive_reordering(self):
        before = make_review([("S1", "9.95", None), ("S1", "10.06", None), ("S4", "9.99", None)])
        after = make_review([("S4", "9.99", None), ("S1", "10.06", None), ("S1", "9.95", None)])
        compared = compare_reviews(before, after)
        self.assertEqual([row["kind"] for row in compared["changes"]], ["unresolved"] * 3)
        unmatched = compared["unmatched_changes"]
        self.assertEqual([(row["kind"], row["before"]["row"], row["after"]["row"])
                          for row in unmatched], [("unresolved", 3, 1)])

    def test_changed_unusable_and_unmatched_raw_measurements_are_identified(self):
        before = make_review([("S1", "9.95", None), ("S1", "10.06", None), ("S4", "9.99", None)])
        after = make_review([("S1", "9.95", None), ("S1", "10.09", None), ("S4", "10.01", None)])
        compared = compare_reviews(before, after)
        self.assertEqual(compared["changes"][0]["kind"], "changed")
        self.assertEqual(compared["unmatched_changes"][0]["kind"], "changed")

    def test_changed_configuration_requires_review_of_all_after_results(self):
        before = make_review()
        cases = [
            ("requirements_changed", lambda review: review["inputs"]["requirements"].update(sha256="d" * 64)),
            ("mapping_changed", lambda review: review["inputs"]["mapping"].update(sha256="d" * 64)),
            ("rule_version_changed", lambda review: review.update(rule_version="2")),
        ]
        for reason, update in cases:
            with self.subTest(reason=reason):
                after = deepcopy(before)
                update(after)
                compared = compare_reviews(before, after)
                self.assertEqual(compared["mode"], "full_review_required")
                self.assertEqual(compared["reasons"], [reason])
                self.assertEqual(compared["changes"], [])
                self.assertEqual(len(compared["after"]["results"]), 3)

    def test_other_identity_is_a_separate_case(self):
        compared = compare_reviews(make_review(), make_review(lot="L43"))
        self.assertEqual(compared["mode"], "separate_case")
        self.assertEqual(compared["reasons"], ["identity_changed"])
        self.assertEqual(compared["changes"], [])

    def test_rejects_incompatible_or_malformed_review(self):
        invalid = [
            lambda item: item.update(schema_version=True),
            lambda item: item.update(source=None),
            lambda item: item["results"].append(deepcopy(item["results"][0])),
            lambda item: item["results"][0].update(source_rows=[42]),
            lambda item: item["results"][0].update(measured_mm="NaN"),
            lambda item: item["inputs"]["mapping"].update(sha256="malformed"),
        ]
        for corrupt in invalid:
            with self.subTest(corrupt=corrupt):
                altered = make_review()
                corrupt(altered)
                with self.assertRaisesRegex(ValueError, "after"):
                    compare_reviews(make_review(), altered)

    def test_rejects_results_detached_from_measurement_evidence(self):
        before = make_review([("S1", "10.20", "above_upper_limit"), ("S2", "10.02", None)])
        cases = [
            lambda review: review["results"][0].update(source_rows=[]),
            lambda review: review["results"][0].update(measured_mm=None),
            lambda review: review["results"][1].update(source_rows=[1]),
            lambda review: review["results"][2].update(source_rows=[2]),
            lambda review: review["results"][2].update(computed_result="cannot_evaluate"),
            lambda review: review["source"]["rows"].append({"row": 3, "cells": ["S4", "10.0"]}),
            lambda review: review["unmatched_rows"].append({
                "row": 1, "characteristic": "H1", "sample": "S1", "reasons": ["revision_mismatch"],
            }),
        ]
        for modify in cases:
            with self.subTest(modify=modify):
                malformed = deepcopy(before)
                modify(malformed)
                with self.assertRaisesRegex(ValueError, "invalid after review"):
                    compare_reviews(before, malformed)
