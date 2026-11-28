"""Synthetic protocol tests only. All filled forms exist in disposable directories."""

import csv
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import pilot


def save_rows(path, rows):
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def form_rows(path):
    with path.open(newline="", encoding="utf-8") as source:
        return list(csv.DictReader(source))


def passing_machine():
    return {"machine_gate_pass": True, "metrics": {"expected_results": 180, "observed_results": 180,
            "replay_valid_runs": 100, "replay_expected_runs": 100, "diffs_observed": 10, "diffs_expected": 10}}


class PilotTests(unittest.TestCase):
    def setUp(self):
        scratch = TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.run_dir = Path(scratch.name) / "run"
        pilot.prepare(self.run_dir, "planned")

    def test_balanced_crossover_and_blank_measurements(self):
        for mode, size in [("planned", 60), ("unavailable", 40), ("offline_required", 40)]:
            schedule = list(pilot.crossover(mode))
            self.assertEqual(len(schedule), size)
            self.assertEqual(len(set(schedule)), size)
            for case in pilot.CASES:
                assignments = [[m for r, _, c, m in schedule if c == case and r == reviewer]
                               for reviewer in pilot.REVIEWERS]
                self.assertEqual(assignments[0], assignments[1][::-1])
                self.assertEqual(len(set(assignments[0])), size // 20)
            for reviewer in pilot.REVIEWERS:
                order = [c for r, _, c, _ in schedule if r == reviewer]
                self.assertEqual(order[10:], order[:-10])
        rows = form_rows(self.run_dir / "sessions.csv")
        self.assertTrue(all(all(not row[field] for field in pilot.PHASES) for row in rows))
        with self.assertRaisesRegex(ValueError, "human observation"):
            pilot.summarize(self.run_dir)
        with self.assertRaisesRegex(ValueError, "already exists"):
            pilot.prepare(self.run_dir, "unavailable")

    def test_blind_inputs_and_prompt_are_immutable(self):
        packets, _, _ = pilot.materials()
        pilot.verify_distributed_packets(self.run_dir, packets)
        packet = self.run_dir / "packets" / "B10" / "revised"
        self.assertEqual({p.name for p in packet.iterdir()}, {"measurements.csv", "requirements.json",
                                                               "mapping.json", "intake.json"})
        self.assertEqual(set(json.loads((packet / "intake.json").read_bytes())), {"lot", "supplier"})
        (packet / "ground_truth.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "packets"):
            pilot.verify_distributed_packets(self.run_dir, packets)
        (packet / "ground_truth.json").unlink()
        (packet / "measurements.csv").write_text("different bytes")
        with self.assertRaisesRegex(ValueError, "packets"):
            pilot.verify_distributed_packets(self.run_dir, packets)

    def test_timings_include_both_checks_and_reject_invalid_sessions(self):
        schedule = list(pilot.crossover("planned"))
        path = self.run_dir / "sessions.csv"
        rows = form_rows(path)
        for idx, row in enumerate(rows):
            record = f"evidence/test-{idx}.txt"
            (self.run_dir / record).write_text("unit-test submission")
            row.update(status="complete", mapping_s="2", first_s="3", revised_s="4",
                       manual_first_s="1", manual_revised_s="0.5", evidence_file=record)
        save_rows(path, rows)
        actual = pilot.timings(self.run_dir, schedule)["excel"]
        self.assertEqual(actual["revised_with_manual"], Decimal("4.5"))
        self.assertEqual(actual["manual"], Decimal("1.5"))
        self.assertEqual(actual["total"], Decimal("10.5"))
        for field, value in [("manual_first_s", ""), ("manual_revised_s", "NaN"), ("revised_s", "0"),
                             ("status", "failed"), ("round", "99"), ("evidence_file", rows[1]["evidence_file"])]:
            with self.subTest(field=field):
                save_rows(path, [{**rows[0], field: value}, *rows[1:]])
                with self.assertRaises(ValueError):
                    pilot.timings(self.run_dir, schedule)
        for incomplete in (rows[:-1], rows + [rows[0]]):
            save_rows(path, incomplete)
            with self.assertRaises(ValueError):
                pilot.timings(self.run_dir, schedule)

    def test_independent_scoring_requires_complete_decisions(self):
        _, cases, _ = pilot.materials()
        schedule = list(pilot.crossover("planned"))
        path = self.run_dir / "decisions.csv"
        rows = form_rows(path)
        for row in rows:
            key = (row["characteristic"], row["sample"])
            truth = cases[row["case"]][0][row["stage"]].expected[key]
            row["status"] = truth["status"]
            row["warning"] = "yes" if truth["status"] != "in_tolerance" or truth["reasons"] else "no"
        missed = next(row for row in rows if row["method"] == "claude" and row["status"] == "missing")
        missed.update(status="in_tolerance", warning="no")
        spurious = next(row for row in rows if row["method"] == "excel" and row["warning"] == "no")
        spurious["warning"] = "yes"
        save_rows(path, rows)
        scores = pilot.score_answers(self.run_dir, schedule, cases)
        self.assertEqual(scores["incoming-inspection"]["scored"], 360)
        self.assertEqual(scores["incoming-inspection"]["correct_status"], 360)
        self.assertEqual(scores["claude"]["false_normal"], 1)
        self.assertEqual(scores["excel"]["false_warning"], 1)
        save_rows(path, rows[:-1])
        with self.assertRaisesRegex(ValueError, "disposition"):
            pilot.score_answers(self.run_dir, schedule, cases)

    def test_quality_excel_and_comparator_gates(self):
        def decision(excel="100", claude="87.5", tool="70", offline=False, mode="planned",
                     local_misses=0, claude_misses=0, local_warnings=0, claude_warnings=0, machine=None):
            medians = {"incoming-inspection": {"revised_with_manual": Decimal(tool)},
                       "excel": {"revised_with_manual": Decimal(excel)}}
            scores = {
                "incoming-inspection": Counter(scored=360, clean_normal=320, false_normal=local_misses,
                                               false_warning=local_warnings),
                "claude": Counter(scored=360, clean_normal=320, false_normal=claude_misses,
                                  false_warning=claude_warnings),
            }
            if claude:
                medians["claude"] = {"revised_with_manual": Decimal(claude)}
            return pilot.decide(medians, scores, machine or passing_machine(), mode, offline)[:2]

        # Exactly 30% shorter than Excel, exactly 20% shorter than Claude.
        self.assertEqual(decision(), ("GO", "equal_accuracy_and_claude_time"))
        self.assertEqual(decision(tool="70.01", offline=True), ("NO_GO", "excel_time"))
        self.assertEqual(decision(claude="87.49"), ("NO_GO", "claude_comparison"))
        self.assertEqual(decision(claude_warnings=1), ("NO_GO", "claude_comparison"))
        self.assertEqual(decision(claude="60", claude_misses=1), ("GO", "fewer_false_normals_than_claude"))
        self.assertEqual(decision(local_misses=1, claude_misses=2), ("NO_GO", "local_reviewer_quality"))
        self.assertEqual(decision(local_misses=1, offline=True), ("NO_GO", "local_reviewer_quality"))
        self.assertEqual(decision(local_warnings=16, claude_warnings=16)[0], "GO")  # 16/320 = 5%
        self.assertEqual(decision(local_warnings=17, offline=True), ("NO_GO", "local_reviewer_quality"))
        self.assertEqual(decision(claude=None), ("PENDING", "planned_claude_evidence_missing"))
        self.assertEqual(decision(claude=None, offline=True), ("PENDING", "planned_claude_evidence_missing"))
        self.assertEqual(decision(claude=None, mode="unavailable"), ("GO", "excel_and_quality_claude_unavailable"))
        self.assertEqual(decision(claude=None, mode="offline_required", offline=True),
                         ("GO", "confirmed_offline_requirement"))
        machine = passing_machine()
        machine["machine_gate_pass"] = False
        self.assertEqual(decision(machine=machine, offline=True), ("NO_GO", "machine_quality"))
        machine["metrics"]["observed_results"] -= 1
        self.assertEqual(decision(machine=machine, offline=True), ("PENDING", "incomplete_machine_evidence"))

    def test_offline_exception_needs_independent_evidence(self):
        path = self.run_dir / "environment.json"
        meta = json.loads(path.read_bytes())
        meta.update(claude_mode="offline_required", collection_origin="observed_human_sessions",
                    excel_version="test", incoming_inspection_version="test",
                    offline_requirement_record="evidence/field.json")
        path.write_text(json.dumps(meta))
        # A three-method enrollment cannot become a two-method exception after the fact.
        with self.assertRaisesRegex(ValueError, "changed since allocation"):
            pilot.environment(self.run_dir, meta["materials_sha256"])
        self.run_dir = self.run_dir.parent / "offline"
        pilot.prepare(self.run_dir, "offline_required")
        path = self.run_dir / "environment.json"
        meta["allocation_sha256"] = json.loads(path.read_bytes())["allocation_sha256"]
        path.write_text(json.dumps(meta))
        ref = self.run_dir / "evidence" / "field.json"
        with self.assertRaisesRegex(ValueError, "nonempty file"):
            pilot.environment(self.run_dir, meta["materials_sha256"])
        ref.write_text('{"field_requires_offline_execution": true}')
        with self.assertRaisesRegex(ValueError, "field requirement"):
            pilot.environment(self.run_dir, meta["materials_sha256"])
        ref.write_text(json.dumps({"field_requires_offline_execution": True, "source_kind": "field_policy",
                                  "anonymous_source_reference": "UNIT-TEST", "applicable_workflow": "test workflow"}))
        self.assertEqual(pilot.environment(self.run_dir, meta["materials_sha256"]), ("offline_required", True))
        self.run_dir = self.run_dir.parent / "unavailable"
        pilot.prepare(self.run_dir, "unavailable")
        path = self.run_dir / "environment.json"
        meta.update(claude_mode="unavailable", offline_requirement_record="", claude_unavailable_record="evidence/why.txt",
                    allocation_sha256=json.loads(path.read_bytes())["allocation_sha256"])
        unavailable = self.run_dir / "evidence" / "why.txt"
        path.write_text(json.dumps(meta))
        unavailable.write_text('{"trial_available": false}')
        with self.assertRaisesRegex(ValueError, "verified reason"):
            pilot.environment(self.run_dir, meta["materials_sha256"])
        unavailable.write_text(json.dumps({"trial_available": False, "reason": "unit test",
                                           "anonymous_source_reference": "UNIT-TEST"}))
        self.assertEqual(pilot.environment(self.run_dir, meta["materials_sha256"]), ("unavailable", False))
        with self.assertRaisesRegex(ValueError, "changed"):
            pilot.environment(self.run_dir, "stale")


if __name__ == "__main__":
    unittest.main()
