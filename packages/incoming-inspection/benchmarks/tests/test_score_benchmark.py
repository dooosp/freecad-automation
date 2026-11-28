"""Exercise the scorer with real CLI artifacts, then remove or corrupt specific evidence."""

from collections import Counter
from copy import deepcopy
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

BENCHMARK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BENCHMARK / "scripts"))
import score_benchmark as score
from benchmark_cases import STAGES, digest, load_cases, load_submission, read_json


class BenchmarkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.cases = load_cases(BENCHMARK / "cases")
        cls.reports = {}
        cls.diffs = {}
        for case in ("B02", "B04", "B05", "B06", "B10"):
            submissions, _ = cls.cases[case]
            paths = []
            for stage, submission in submissions.items():
                args = ["review", "--supplier", submission.identity["supplier"], "--lot", submission.identity["lot"]]
                for name, path in submission.paths.items():
                    args.extend(["--" + name, path])
                out = cls.root / f"{case}-{stage}"
                doc, _, error = score.artifact_command(args, out, "review.json")
                if error:
                    raise AssertionError(error)
                cls.reports[case, stage] = doc, out
                paths.append(out / "review.json")
            diff, _, error = score.artifact_command(["diff", *paths], cls.root / f"{case}-diff", "diff.json")
            if error:
                raise AssertionError(error)
            cls.diffs[case] = diff

    def review(self, case, edit, stage="first"):
        doc, path = self.reports[case, stage]
        altered = deepcopy(doc)
        edit(altered)
        return score.score_review(self.cases[case][0][stage], altered, path)

    def diff(self, case, edit):
        doc = deepcopy(self.diffs[case])
        edit(doc)
        before, before_path = self.reports[case, "first"]
        after, after_path = self.reports[case, "revised"]
        hashes = {"before": digest(before_path / "review.json"), "after": digest(after_path / "review.json")}
        return score.score_diff(self.cases[case][1], doc, before, after, hashes)

    def test_complete_frozen_population(self):
        total = Counter()
        for submissions, _ in self.cases.values():
            for sub in submissions.values():
                counts, issues = score.score_review(sub, None, self.root)
                self.assertTrue(issues)
                total.update(counts)
        self.assertEqual(len(self.cases), 10)
        self.assertEqual(total["expected_results"], 180)
        self.assertEqual(total["expected_non_normal"], 19)
        self.assertEqual(total["expected_normal"], 160)
        self.assertEqual(total["expected_warnings"], 27)
        # The 161st in-tolerance result legitimately disagrees with the supplier.
        self.assertEqual(180 - 19 - 160, 1)
        for stage in STAGES:
            compact = self.cases["B07"][0][stage]
            self.assertNotIn("supplier", compact.mapping)
            self.assertNotIn("unit", compact.mapping)
            self.assertEqual(compact.mapping["value"], "실측(mm)")
            large = self.cases["B09"][0][stage]
            self.assertEqual(len(large.cells), 60)
            self.assertEqual(len(large.definition["characteristics"]), 12)
            self.assertTrue(all(len(spec["samples"]) == 5 for spec in large.definition["characteristics"]))
        self.assertEqual(len(self.cases["B09"][1]["changes"]), 4)

    def test_incomplete_suite_or_independent_answer_sheet_is_rejected(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaisesRegex(ValueError, "B01 through B10"):
                load_cases(Path(empty))
        folder = self.cases["B05"][0]["first"].paths["requirements"].parent
        intake = read_json(folder / "intake.json")
        truth = read_json(folder / "ground_truth.json")["first"]
        truth["results"][0]["source_rows"] = [1, 2]  # row 2 exists but belongs to S2
        with self.assertRaisesRegex(ValueError, "does not belong"):
            load_submission(folder, intake, "first", truth)
        truth["results"].pop(0)
        with self.assertRaisesRegex(ValueError, "omits required pairs"):
            load_submission(folder, intake, "first", truth)

    def test_absent_outputs_keep_denominators_and_cannot_pass(self):
        with tempfile.TemporaryDirectory() as scratch, patch.object(
            score, "artifact_command", return_value=(None, None, "no output")
        ):
            result = score.run_suite({"B02": self.cases["B02"]}, Path(scratch))
        measured = result["metrics"]
        self.assertEqual(measured["expected_results"], 6)
        self.assertEqual(measured["expected_normal"], 4)
        self.assertEqual(measured["expected_warnings"], 2)
        self.assertEqual(measured["observed_results"], 0)
        self.assertIsNone(measured["false_warning_rate"])
        self.assertEqual(measured["evidence_reachability"], 0.0)
        self.assertEqual(measured["replay_determinism"], 0.0)
        self.assertEqual(measured["diffs_correct"], 0)
        self.assertFalse(result["machine_gate_pass"])
        self.assertFalse(any(result["thresholds"].values()))

    def test_exit_zero_needs_a_review_file_and_nonempty_schema(self):
        with tempfile.TemporaryDirectory() as scratch, patch.object(
            subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
        ):
            out = Path(scratch)
            for content in (None, "", "{}", '{"schema_version":1,"results":[]}'):
                with self.subTest(content=content):
                    if content is not None:
                        (out / "review.json").write_text(content)
                    document, fingerprint, error = score.artifact_command(["review"], out, "review.json")
                    self.assertIsNone(document)
                    self.assertIsNone(fingerprint)
                    self.assertTrue(error)

    def test_replay_requires_five_matching_bytes(self):
        run = score.artifact_command

        def different_last_run(arguments, out, name):
            doc, fingerprint, error = run(arguments, out, name)
            if out.name == "5":
                path = out / name
                path.write_bytes(path.read_bytes() + b"\n")  # identical JSON, different raw bytes
                fingerprint = digest(path)
            return doc, fingerprint, error

        with tempfile.TemporaryDirectory() as scratch, patch.object(score, "artifact_command", different_last_run):
            _, record, counts, issues = score.run_stage(self.cases["B02"][0]["first"], Path(scratch))
        self.assertEqual(counts["replay_valid_runs"], 5)
        self.assertEqual(counts["replay_matching_runs"], 4)
        self.assertEqual(len(set(record["review_sha256"])), 2)
        self.assertEqual(counts["replay_deterministic_submissions"], 0)
        self.assertTrue(issues)

    def test_false_normal_false_warning_and_legitimate_disagreement(self):
        def counterfeit(doc):
            clean, bad, disputed = doc["results"]
            clean["reasons"] = ["supplier_result_mismatch"]
            bad.update(computed_result="in_tolerance", reasons=[])
            disputed["supplier_result"] = "합격"  # measured within limits but the actual source declares failure

        counts, issues = self.review("B02", counterfeit)
        self.assertEqual(counts["expected_normal"], 1)
        self.assertEqual(counts["false_normal_count"], 1)
        self.assertEqual(counts["false_warning_count"], 1)
        self.assertEqual(counts["expected_warnings"], 2)
        self.assertEqual(counts["unexpected_warnings"], 1)
        self.assertEqual(score.metrics(counts)["false_warning_rate"], 1.0)
        self.assertTrue(any("supplier_result=" in issue for issue in issues))

    def test_omitted_and_duplicate_results_are_unassessed(self):
        def remove_and_double(doc):
            del doc["results"][2]
            doc["results"].append(doc["results"][0].copy())

        counts, issues = self.review("B02", remove_and_double)
        self.assertEqual(counts["observed_results"], 1)
        self.assertEqual(counts["observed_normal"], 0)
        self.assertIsNone(score.metrics(counts)["false_warning_rate"])
        self.assertTrue(any("duplicate" in issue for issue in issues))
        self.assertTrue(any("missing" in issue for issue in issues))

    def test_malformed_reasons_cannot_hide_an_explicit_false_normal(self):
        counts, issues = self.review("B02", lambda doc: doc["results"][1].update(
            computed_result="in_tolerance", reasons=None))
        self.assertEqual(counts["false_normal_count"], 1)
        self.assertEqual(counts["observed_non_normal"], 0)
        self.assertTrue(issues)

    def test_supplier_discrepancy_does_not_excuse_wrong_deviation(self):
        _, issues = self.review("B02", lambda doc: doc["results"][1].update(deviation_mm="0.1"))
        self.assertTrue(any("expected deviation 0.01" in issue for issue in issues))

    def test_duplicate_measurement_must_reference_all_and_only_its_raw_rows(self):
        for wrong in ([1], [1, 2], [1, True, 3], [1, 3, 3]):
            with self.subTest(wrong=wrong):
                counts, issues = self.review("B05", lambda doc: doc["results"][0].update(source_rows=wrong))
                self.assertEqual(counts["reachable_warnings"], 1)  # unknown characteristic still has correct evidence
                self.assertTrue(issues)
        counts, issues = self.review("B05", lambda doc: doc["unmatched_rows"][0].update(row=2))
        self.assertTrue(issues)
        self.assertEqual(counts["reachable_warnings"], 1)

    def test_missing_requirement_and_archive_are_real_evidence(self):
        counts, issues = self.review("B04", lambda doc: doc["results"][1].update(drawing_ref="unrelated"))
        self.assertEqual(counts["reachable_warnings"], 1)
        self.assertTrue(issues)
        doc, path = self.reports["B05", "first"]
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / "edited"
            shutil.copytree(path, copy)
            (copy / "inputs" / "measurements.csv").write_bytes(b"changed")
            counts, issues = score.score_review(self.cases["B05"][0]["first"], doc, copy)
            self.assertEqual(counts["reachable_warnings"], 0)
            self.assertTrue(issues)
        counts, issues = self.review("B05", lambda doc: doc["source"]["rows"][0]["cells"].__setitem__(0, "wrong"))
        self.assertEqual(counts["reachable_warnings"], 1)
        self.assertTrue(issues)

    def test_diff_requires_exact_events_and_both_sides_of_the_evidence(self):
        _, issues = self.diff("B04", lambda doc: doc["changes"].pop(0))  # unresolved required sample disappears
        self.assertTrue(issues)
        _, issues = self.diff("B06", lambda doc: doc["changes"].extend(deepcopy(doc["changes"])))
        self.assertTrue(issues)
        _, issues = self.diff("B05", lambda doc: doc["unmatched_changes"][0]["before"].update(row=3))
        self.assertTrue(issues)
        _, issues = self.diff("B06", lambda doc: doc["changes"][0]["before"].update(measured_mm="900"))
        self.assertTrue(issues)
        _, issues = self.diff("B06", lambda doc: doc["inputs"].update(after="0" * 64))
        self.assertTrue(issues)
        _, issues = self.diff("B06", lambda doc: doc.pop("unmatched_changes"))
        self.assertTrue(issues)

    def test_revision_requires_explicit_full_review_and_forbids_partial_changes(self):
        def alternate(doc, flag):
            doc.update(mode="separate_case", reasons=["identity_changed"])
            doc.pop("full_review_required", None)
            if flag is not None:
                doc["full_review_required"] = flag

        for value in (None, False, 1, "true", True):
            with self.subTest(value=value):
                _, issues = self.diff("B10", lambda doc: alternate(doc, value))
                self.assertEqual(bool(issues), value is not True)
        _, issues = self.diff("B10", lambda doc: doc.update(
            mode="full_review_required", reasons=["requirements_changed", "mapping_changed"]))
        self.assertFalse(issues)

        def partial(doc):
            alternate(doc, True)
            doc["changes"] = [{"kind": "changed", "characteristic": "SLOT", "sample": "S1",
                               "before": doc["before"]["results"][0], "after": doc["after"]["results"][0]}]

        _, issues = self.diff("B10", partial)
        self.assertTrue(issues)


if __name__ == "__main__":
    unittest.main()
