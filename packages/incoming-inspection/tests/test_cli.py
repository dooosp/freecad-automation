import json
import subprocess
import sys
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path


FIXTURES = Path(__file__).parent / "fixtures"


class CliTests(unittest.TestCase):
    def setUp(self):
        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        self.workspace = Path(workspace.name)

    def invoke(self, *args, success=True):
        result = subprocess.run(
            [sys.executable, "-m", "incoming_inspection", *map(str, args)],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("Traceback", result.stderr)
        return result

    def review(self, name, csv="first.csv", mapping="supplier-a.json", success=True):
        out = self.workspace / name
        self.invoke(
            "review",
            "--requirements", FIXTURES / "requirements.json",
            "--mapping", FIXTURES / mapping,
            "--measurements", FIXTURES / csv,
            "--supplier", "A",
            "--lot", "L42",
            "--out", out,
            success=success,
        )
        return out

    def test_review_replay_preserves_exact_input_bytes(self):
        first = self.review("first")
        replay = self.review("replay")
        report_bytes = (first / "review.json").read_bytes()
        self.assertEqual(report_bytes, (replay / "review.json").read_bytes())
        report = json.loads(report_bytes)
        expected_names = {
            "requirements": "requirements.json",
            "mapping": "supplier-a.json",
            "measurements": "first.csv",
        }
        for key, filename in expected_names.items():
            evidence = report["inputs"][key]
            data = (FIXTURES / filename).read_bytes()
            self.assertEqual((first / evidence["path"]).read_bytes(), data)
            self.assertEqual(evidence["sha256"], sha256(data).hexdigest())
        self.assertEqual(
            [row["computed_result"] for row in report["results"]],
            ["in_tolerance", "out_of_tolerance", "missing"],
        )
        self.assertIn("협력사 검사성적서", (first / "review.html").read_text(encoding="utf-8"))
        self.review("first", "revised.csv", success=False)
        self.assertEqual((first / "review.json").read_bytes(), report_bytes)

    def test_compare_findings_and_preserve_both_report_digests(self):
        first = self.review("first") / "review.json"
        revised = self.review("revised", "revised.csv") / "review.json"
        out = self.workspace / "changes"
        self.invoke("diff", first, revised, "--out", out)
        comparison = json.loads((out / "diff.json").read_bytes())
        self.assertEqual(
            comparison["inputs"],
            {"before": sha256(first.read_bytes()).hexdigest(),
             "after": sha256(revised.read_bytes()).hexdigest()},
        )
        self.assertEqual(
            [(row["sample"], row["kind"]) for row in comparison["changes"]],
            [("S2", "changed"), ("S3", "unresolved")],
        )
        self.assertTrue((out / "diff.html").is_file())

    def test_two_supplier_layouts_produce_same_numeric_decisions(self):
        a = self.review("a")
        b = self.review("b", "supplier-b.csv", "supplier-b.json")
        first = json.loads((a / "review.json").read_bytes())
        second = json.loads((b / "review.json").read_bytes())
        self.assertEqual(first["supplier_source"], "csv")
        self.assertEqual(second["supplier_source"], "operator")
        self.assertEqual(
            [r["computed_result"] for r in first["results"]],
            [r["computed_result"] for r in second["results"]],
        )

    def test_reject_malformed_review_without_output(self):
        wrong = self.workspace / "invalid.json"
        wrong.write_text("{}", encoding="utf-8")
        out = self.workspace / "invalid-diff"
        self.invoke("diff", wrong, wrong, "--out", out, success=False)
        self.assertFalse(out.exists())

    def test_duplicate_and_wrong_revision_do_not_fill_valid_samples(self):
        report = self.review("exceptions", "identity-and-duplicates.csv") / "review.json"
        document = json.loads(report.read_bytes())
        self.assertEqual(
            [row["computed_result"] for row in document["results"]],
            ["cannot_evaluate", "missing", "in_tolerance"],
        )
        self.assertEqual(document["results"][0]["source_rows"], [1, 2])
        self.assertIn("revision_mismatch", document["unmatched_rows"][0]["reasons"])

    def test_present_supplier_column_stays_csv_when_none_of_the_rows_match(self):
        measurements = self.workspace / "wrong-supplier.csv"
        data = (FIXTURES / "first.csv").read_text(encoding="utf-8")
        measurements.write_text(data.replace(",A,", ",OTHER,"), encoding="utf-8")
        out = self.review("supplier-mismatch", measurements)
        review = json.loads((out / "review.json").read_bytes())
        self.assertEqual(review["supplier_source"], "csv")
        self.assertEqual(len(review["unmatched_rows"]), 2)
        self.assertEqual(
            [row["reasons"] for row in review["unmatched_rows"]],
            [["supplier_mismatch"], ["supplier_mismatch"]],
        )

    def test_diff_rejects_deeply_nested_json_without_traceback(self):
        wrong = self.workspace / "deep.json"
        wrong.write_text("[" * 1_200 + "0" + "]" * 1_200, encoding="utf-8")
        out = self.workspace / "invalid-diff"
        self.invoke("diff", wrong, wrong, "--out", out, success=False)
        self.assertFalse(out.exists())
