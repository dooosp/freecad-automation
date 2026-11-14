import copy
import json
import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "fcad.js"


def run(args):
    return subprocess.run(
        ["node", *args], cwd=ROOT, capture_output=True, text=True, timeout=150
    )


def test_cli_requires_output_path(tmp_path):
    case_path = tmp_path / "case.json"
    case_path.write_text("{}")
    result = run([str(CLI), "retrofit-check", str(case_path)])
    assert result.returncode != 0
    assert "--out requires a value" in result.stderr


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    probe = run([
        "--input-type=module", "-e",
        "import { hasFreeCADRuntime } from './lib/paths.js'; "
        "console.log(hasFreeCADRuntime() ? 'yes' : 'no');",
    ])
    assert probe.returncode == 0, probe.stderr
    if probe.stdout.strip() != "yes":
        pytest.skip("FreeCAD runtime not available")

    directory = tmp_path_factory.mktemp("retrofit")
    driver = (
        "import { runScript } from './lib/runner.js'; "
        "await runScript('retrofit_check_demo.py', { output_directory: process.argv[1] });"
    )
    generated = run(["--input-type=module", "-e", driver, str(directory)])
    assert generated.returncode == 0, generated.stderr
    return directory, json.loads((directory / "case.json").read_text())


def run_case(demo, name, change=None, succeed=True):
    directory, template = demo
    case = copy.deepcopy(template)
    if change:
        change(case)
    case_path = directory / f"{name}.json"
    report_path = directory / "reports" / f"{name}.json"
    case_path.write_text(json.dumps(case))
    result = run([str(CLI), "retrofit-check", str(case_path), "--out", str(report_path)])
    if succeed:
        assert result.returncode == 0, result.stdout + result.stderr
        return json.loads(report_path.read_text())
    assert result.returncode != 0
    assert not report_path.exists()
    return result


def candidate_a_only(case):
    case["candidates"] = [case["candidates"][0]]
    return case["candidates"][0]


def test_four_cases_use_step_holes_and_solid_contact(demo):
    report = run_case(demo, "all-candidates")
    a, b, c, d = report["candidates"]
    assert [(item["id"], item["status"]) for item in (a, b, c, d)] == [
        ("A", "direct_mount"), ("B", "adapter_candidate"),
        ("C", "blocked"), ("D", "needs_input"),
    ]
    assert a["direct"]["clearance"]["minimum_mm"] == pytest.approx(8)
    assert b["adapter"]["clearance"]["minimum_mm"] == pytest.approx(8)
    assert c["direct"]["clearance"]["minimum_mm"] == pytest.approx(2)
    assert d["direct"]["clearance"] is None
    assert "CONNECTOR_CLEARANCE_BELOW_MINIMUM" in c["reason_codes"]
    assert "candidates[D].connector_box" in d["needed_inputs"]

    assert a["direct"]["mount_interfaces"][0]["contact_area_mm2"] > 0
    assert a["direct"]["intersections"][0]["volume_mm3"] == pytest.approx(0)
    c1 = a["direct"]["hole_pairs"][0]
    assert c1["base"]["center_mm"] == pytest.approx([22, 22, 4])
    assert c1["candidate"]["diameter_mm"] == pytest.approx(4)
    assert c1["offset_mm"] == pytest.approx(0)
    assert b["direct"]["hole_pairs"][0]["offset_mm"] == pytest.approx(14.142135624)
    assert b["adapter"]["plate"]["thickness_mm"] == pytest.approx(6)
    assert b["adapter"]["plate"]["min_hole_web_mm"] == pytest.approx(10.142135624)
    assert b["adapter"]["plate"]["min_edge_web_mm"] == pytest.approx(8)
    assert all(pair["contact_area_mm2"] > 0 for pair in b["adapter"]["mount_interfaces"])
    assert report["runtime"]["freecad_version"]
    assert len(report["mount_plate"]["step"]["sha256"]) == 64


def test_same_hole_spacing_with_shifted_placement_is_blocked(demo):
    def shift(case):
        candidate_a_only(case)["translation_mm"][0] = 0.5

    candidate = run_case(demo, "shifted", shift)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert candidate["reason_codes"] == ["HOLE_OFFSET_EXCEEDED"]
    assert [pair["offset_mm"] for pair in candidate["direct"]["hole_pairs"]] == pytest.approx([0.5] * 4)


def test_hint_is_for_identification_and_is_not_used_as_measurement(demo):
    def change_hint(case):
        candidate_a_only(case)["holes"][0]["center_mm"][0] += 0.03

    candidate = run_case(demo, "shifted-hint", change_hint)["candidates"][0]
    assert candidate["status"] == "direct_mount"
    assert candidate["direct"]["hole_pairs"][0]["offset_mm"] == pytest.approx(0)


def test_body_interference_is_separate_from_connector_clearance(demo):
    def add_collision(case):
        candidate_a_only(case)
        case["obstacles"].append({
            "id": "body_block", "min_mm": [18, 18, 4], "max_mm": [19, 19, 6],
        })

    candidate = run_case(demo, "body-collision", add_collision)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert candidate["reason_codes"] == ["BODY_INTERFERENCE"]
    obstruction = next(
        item for item in candidate["direct"]["intersections"] if item["against"] == "body_block"
    )
    assert obstruction["volume_mm3"] == pytest.approx(2)
    assert candidate["direct"]["clearance"]["minimum_mm"] == pytest.approx(8)


def test_same_plane_without_face_contact_is_blocked(demo):
    def move_off_plate(case):
        candidate_a_only(case)["translation_mm"][0] = -200
        case["obstacles"] = []

    candidate = run_case(demo, "no-face-contact", move_off_plate)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert "MOUNT_FACE_CONTACT_MISSING" in candidate["reason_codes"]
    assert candidate["direct"]["mount_interfaces"][0]["contact_area_mm2"] == pytest.approx(0)
    assert candidate["direct"]["clearance"]["minimum_mm"] is None


@pytest.mark.parametrize(("field", "value", "reason"), [
    ("min_adapter_hole_web_mm", 11, "ADAPTER_HOLE_WEB_BELOW_MINIMUM"),
    ("min_adapter_edge_web_mm", 9, "ADAPTER_EDGE_WEB_BELOW_MINIMUM"),
])
def test_adapter_minimum_webs_are_hard_requirements(demo, field, value, reason):
    def change_requirement(case):
        case["candidates"] = [case["candidates"][1]]
        case["requirements"][field] = value

    candidate = run_case(demo, field, change_requirement)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert reason in candidate["reason_codes"]


def test_adapter_offset_must_include_plate_thickness(demo):
    def sink_candidate(case):
        case["candidates"] = [case["candidates"][1]]
        case["candidates"][0]["adapter"]["translation_mm"][2] = 9

    candidate = run_case(demo, "wrong-adapter-height", sink_candidate)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert "MOUNT_PLANE_MISMATCH" in candidate["reason_codes"]
    assert "BODY_INTERFERENCE" in candidate["reason_codes"]
    assert candidate["adapter"]["mount_interfaces"][1]["plane_gap_mm"] == pytest.approx(-1)


def test_missing_obstacle_geometry_cannot_produce_a_pass(demo):
    def incomplete_obstacle(case):
        candidate_a_only(case)
        del case["obstacles"][0]["max_mm"]

    candidate = run_case(demo, "missing-obstacle", incomplete_obstacle)["candidates"][0]
    assert candidate["status"] == "needs_input"
    assert "obstacles[0].max_mm" in candidate["needed_inputs"]
    assert candidate["direct"]["clearance"] is None


def test_two_hints_for_the_same_bore_cannot_count_as_two_holes(demo):
    def alias_hole(case):
        candidate = candidate_a_only(case)
        candidate["holes"][1]["center_mm"] = candidate["holes"][0]["center_mm"]

    candidate = run_case(demo, "aliased-bore", alias_hole)["candidates"][0]
    assert candidate["status"] == "needs_input"
    assert "HOLE_PAIRING_AMBIGUOUS" in candidate["reason_codes"]


def test_mount_plane_hint_must_resolve_to_a_real_outward_face(demo):
    def use_internal_plane(case):
        candidate_a_only(case)["mount_plane"]["z_mm"] = 1

    candidate = run_case(demo, "internal-plane", use_internal_plane)["candidates"][0]
    assert candidate["status"] == "needs_input"
    assert "MOUNT_PLANE_NOT_FOUND" in candidate["reason_codes"]


def test_adapter_is_not_evaluated_if_direct_clearance_also_fails(demo):
    def fail_direct_clearance(case):
        case["candidates"] = [case["candidates"][1]]
        case["candidates"][0]["connector_box"]["max_mm"][0] = 141

    candidate = run_case(demo, "adapter-ineligible", fail_direct_clearance)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert "CONNECTOR_CLEARANCE_BELOW_MINIMUM" in candidate["reason_codes"]
    assert candidate["adapter"] is None


def test_report_is_write_once_and_rerun_is_identical(demo):
    directory, _ = demo
    report = run_case(demo, "repeatable")
    first = directory / "reports" / "repeatable.json"
    second = first.with_name("repeatable-again.json")
    case_path = directory / "repeatable.json"
    repeat = run([str(CLI), "retrofit-check", str(case_path), "--out", str(second)])
    assert repeat.returncode == 0, repeat.stderr
    assert first.read_bytes() == second.read_bytes()

    duplicate = run([str(CLI), "retrofit-check", str(case_path), "--out", str(first)])
    assert duplicate.returncode != 0
    assert "already exists" in duplicate.stderr
    assert report == json.loads(first.read_text())


def test_rejects_bad_json_and_bad_units_without_creating_reports(demo):
    directory, _ = demo
    bad_json = directory / "bad-syntax.json"
    bad_json.write_text('{"case_id":')
    output = directory / "bad-syntax-report.json"
    result = run([str(CLI), "retrofit-check", str(bad_json), "--out", str(output)])
    assert result.returncode != 0
    assert "Invalid JSON" in result.stderr
    assert not output.exists()
    bad_units = run_case(demo, "bad-units", lambda case: case.update(units="inch"), succeed=False)
    assert 'units must be "mm"' in bad_units.stderr


def test_unreadable_step_is_an_execution_error(demo):
    directory, _ = demo
    (directory / "invalid.step").write_text("This is not a STEP file.")

    def use_invalid_step(case):
        candidate_a_only(case)["step_file"] = "invalid.step"

    result = run_case(demo, "broken-step", use_invalid_step, succeed=False)
    assert "Failed to read STEP" in result.stderr


@pytest.fixture(scope="module")
def altered_steps(demo):
    directory, _ = demo
    builder = directory / "altered_steps.py"
    builder.write_text(
        'import Part\n'
        'from FreeCAD import Vector\n'
        'from pathlib import Path\n'
        'root = Path(__file__).parent\n'
        'body = Part.read(str(root / "candidate_a.step"))\n'
        'plug = Part.makeCylinder(2, 2, Vector(22, 22, 2))\n'
        'body.fuse(plug).Solids[0].exportStep(str(root / "blind.step"))\n'
        'print(\'{"success": true}\', flush=True)\n'
    )
    driver = (
        "import { runScript } from './lib/runner.js'; "
        "await runScript(process.argv[1], {});"
    )
    script_name = os.path.relpath(builder, ROOT / "scripts")
    generated = run(["--input-type=module", "-e", driver, script_name])
    assert generated.returncode == 0, generated.stderr
    return demo


def test_blind_hole_is_unverified(altered_steps):
    def use_blind_hole(case):
        candidate_a_only(case)["step_file"] = "blind.step"

    candidate = run_case(altered_steps, "blind-hole", use_blind_hole)["candidates"][0]
    assert candidate["status"] == "needs_input"
    assert candidate["reason_codes"] == ["HOLE_NOT_VERIFIED"]


def test_connector_containment_reports_zero_distance(demo):
    def contain_connector(case):
        candidate = candidate_a_only(case)
        candidate["connector_box"] = {"min_mm": [128, 44, 1], "max_mm": [130, 46, 2]}
        case["obstacles"] = [{"id": "cover", "min_mm": [127, 43, 4], "max_mm": [131, 47, 7]}]

    candidate = run_case(demo, "contained-connector", contain_connector)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert "CONNECTOR_INTERFERENCE" in candidate["reason_codes"]
    assert "BODY_INTERFERENCE" not in candidate["reason_codes"]
    assert candidate["direct"]["clearance"]["minimum_mm"] == pytest.approx(0)
    assert candidate["direct"]["clearance"]["obstacles"][0]["intersection_volume_mm3"] == pytest.approx(4)


def test_fully_missing_candidate_geometry_is_reported(demo):
    def remove_candidate_model(case):
        candidate = candidate_a_only(case)
        del candidate["step_file"]

    candidate = run_case(demo, "candidate-step-omitted", remove_candidate_model)["candidates"][0]
    assert candidate["status"] == "needs_input"
    assert candidate["needed_inputs"] == ["candidates[A].step_file"]


def test_malformed_optional_container_is_an_execution_error(demo):
    result = run_case(demo, "wrong-container", lambda case: case.update(requirements=[]), succeed=False)
    assert "requirements must be an object" in result.stderr


def test_known_clearance_failure_still_blocks_with_an_unmeasured_obstacle(demo):
    def add_incomplete_obstacle(case):
        candidate_a_only(case)["connector_box"]["max_mm"][0] = 141
        case["obstacles"].append({"id": "unmeasured", "min_mm": [1, 1, 1]})

    candidate = run_case(demo, "incomplete-obstacle-with-known-failure", add_incomplete_obstacle)["candidates"][0]
    assert candidate["status"] == "blocked"
    assert "CONNECTOR_CLEARANCE_BELOW_MINIMUM" in candidate["reason_codes"]
    assert "obstacles[1].max_mm" in candidate["needed_inputs"]
    clearance = candidate["direct"]["clearance"]
    assert clearance["minimum_mm"] is None
    assert clearance["obstacles"][0]["distance_mm"] == pytest.approx(2)
