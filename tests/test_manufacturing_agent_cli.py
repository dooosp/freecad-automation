import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "configs" / "examples"
DOC_EXAMPLE = ROOT / "docs" / "examples" / "infotainment-display-bracket"
DOC_ELECTRONICS_EXAMPLE = ROOT / "docs" / "examples" / "controller-housing-eol"
CASE_STUDY = ROOT / "docs" / "portfolio" / "infotainment-production-readiness-case.md"


def run_cli(args, check=True):
    completed = subprocess.run(
        ["node", str(ROOT / "bin" / "fcad.js"), *args],
        text=True,
        capture_output=True,
        check=False,
        cwd=ROOT,
    )
    if check and completed.returncode != 0:
        raise AssertionError(f"CLI failed: {completed.stdout}\n{completed.stderr}")
    return completed


def test_review_command_outputs_product_review_pack(tmp_path):
    output_path = tmp_path / "display_bracket_review.json"

    run_cli(
        [
            "review",
            str(EXAMPLES / "infotainment_display_bracket.toml"),
            "--out",
            str(output_path),
        ]
    )

    assert output_path.exists()
    review_pack = json.loads(output_path.read_text(encoding="utf-8"))
    assert review_pack["agent"] == "product_review"
    assert review_pack["summary"]["part_type"] in {"bracket", "housing", "generic"}
    assert isinstance(review_pack["risk_items"], list)
    assert isinstance(review_pack["recommendations"], list)


def test_readiness_report_outputs_all_agent_sections(tmp_path):
    output_path = tmp_path / "pcb_mount_plate_readiness.json"

    run_cli(
        [
            "readiness-report",
            str(EXAMPLES / "pcb_mount_plate.toml"),
            "--batch",
            "150",
            "--out",
            str(output_path),
        ]
    )

    markdown_path = tmp_path / "pcb_mount_plate_readiness.md"
    assert output_path.exists()
    assert markdown_path.exists()

    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["workflow"] == "production_readiness"
    assert "product_review" in report
    assert "process_plan" in report
    assert "line_plan" in report
    assert "quality_risk" in report
    assert "investment_review" in report
    assert "decision_summary" in report
    assert "summary" in report
    assert report["readiness_summary"]["score"] > 0


def test_line_plan_includes_production_engineering_summary_fields(tmp_path):
    output_path = tmp_path / "line_plan.json"

    run_cli(
        [
            "line-plan",
            str(EXAMPLES / "infotainment_display_bracket.toml"),
            "--out",
            str(output_path),
        ]
    )

    line_plan = json.loads(output_path.read_text(encoding="utf-8"))
    assert line_plan["agent"] == "line_layout_support"
    assert "summary" in line_plan
    assert "inspection_split" in line_plan
    assert "traceability_capture_points" in line_plan
    assert "rework_repair_station" in line_plan
    assert "operator_skill_sensitivity_notes" in line_plan
    assert line_plan["summary"]["heuristics_notice"]
    assert line_plan["station_concept"]


def test_line_plan_runtime_input_adds_stabilization_fields(tmp_path):
    output_path = tmp_path / "line_plan_runtime.json"

    run_cli(
        [
            "line-plan",
            str(EXAMPLES / "infotainment_display_bracket.toml"),
            "--runtime",
            str(ROOT / "data" / "runtime_examples" / "display_bracket_runtime.json"),
            "--profile",
            str(ROOT / "configs" / "profiles" / "site_korea_ulsan.toml"),
            "--out",
            str(output_path),
        ]
    )

    line_plan = json.loads(output_path.read_text(encoding="utf-8"))
    assert line_plan["runtime_summary"]["runtime_informed"] is True
    assert line_plan["runtime_summary"]["stations_over_target"]
    assert any(station["actual_ct_gap_sec"] is not None for station in line_plan["station_concept"])
    assert any(station["launch_instability_signals"] for station in line_plan["station_concept"])


def test_stabilization_review_outputs_runtime_informed_analysis(tmp_path):
    output_path = tmp_path / "stabilization_review.json"

    run_cli(
        [
            "stabilization-review",
            str(EXAMPLES / "infotainment_display_bracket.toml"),
            "--runtime",
            str(ROOT / "data" / "runtime_examples" / "display_bracket_runtime.json"),
            "--profile",
            str(ROOT / "configs" / "profiles" / "site_korea_ulsan.toml"),
            "--out",
            str(output_path),
        ]
    )

    review = json.loads(output_path.read_text(encoding="utf-8"))
    assert review["agent"] == "stabilization_review"
    assert review["summary"]["runtime_basis"] == "runtime_informed"
    assert review["station_runtime_review"]
    assert review["launch_instability_signals"]
    assert review["likely_root_causes"]
    assert review["improvement_candidates"]


def test_investment_review_includes_summary_and_tooling_hints(tmp_path):
    output_path = tmp_path / "investment_review.json"

    run_cli(
        [
            "investment-review",
            str(EXAMPLES / "pcb_mount_plate.toml"),
            "--out",
            str(output_path),
        ]
    )

    investment_review = json.loads(output_path.read_text(encoding="utf-8"))
    assert investment_review["agent"] == "cost_investment_review"
    assert investment_review["summary"]["investment_pressure"] in {"low", "medium", "high"}
    assert investment_review["summary"]["manual_labor_sensitivity"] in {"low", "medium", "high"}
    assert investment_review["equipment_need_hints"]
    assert investment_review["inspection_fixture_tooling_hints"]
    assert investment_review["setup_complexity_notes"]
    assert investment_review["manual_labor_sensitivity"]["level"] in {"low", "medium", "high"}


def test_electronics_assembly_example_surfaces_process_line_and_quality_signals(tmp_path):
    process_output = tmp_path / "controller_process_plan.json"
    line_output = tmp_path / "controller_line_plan.json"
    quality_output = tmp_path / "controller_quality_risk.json"

    run_cli(["process-plan", str(EXAMPLES / "controller_housing_eol.toml"), "--out", str(process_output)])
    run_cli(["line-plan", str(EXAMPLES / "controller_housing_eol.toml"), "--out", str(line_output)])
    run_cli(["quality-risk", str(EXAMPLES / "controller_housing_eol.toml"), "--out", str(quality_output)])

    process_plan = json.loads(process_output.read_text(encoding="utf-8"))
    line_plan = json.loads(line_output.read_text(encoding="utf-8"))
    quality_risk = json.loads(quality_output.read_text(encoding="utf-8"))

    operations = [step["operation"] for step in process_plan["process_flow"]]
    assert "torque-controlled fastening" in operations
    assert "barcode / serial pairing" in operations
    assert "EOL electrical test" in operations

    station_names = [station["station_name"] for station in line_plan["station_list"]]
    assert any("torque" in name.lower() for name in station_names)
    assert any("barcode" in name.lower() for name in station_names)
    assert any("eol electrical test" in name.lower() for name in station_names)

    risk_titles = [risk["title"] for risk in quality_risk["quality_risks"]]
    assert any("Connector misalignment risk" in title for title in risk_titles)
    assert any("Traceability mismatch risk" in title for title in risk_titles)


def test_generate_standard_docs_creates_expected_files(tmp_path):
    out_dir = tmp_path / "standard_docs"

    run_cli(
        [
            "generate-standard-docs",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--out-dir",
            str(out_dir),
        ]
    )

    expected_files = [
        "process_flow.md",
        "control_plan_draft.csv",
        "inspection_checksheet_draft.csv",
        "work_instruction_draft.md",
        "pfmea_seed.csv",
        "standard_docs_manifest.json",
    ]
    for filename in expected_files:
        assert (out_dir / filename).exists(), f"missing generated standard doc: {filename}"

    process_flow = (out_dir / "process_flow.md").read_text(encoding="utf-8")
    control_plan = (out_dir / "control_plan_draft.csv").read_text(encoding="utf-8")
    work_instruction = (out_dir / "work_instruction_draft.md").read_text(encoding="utf-8")

    assert "Draft / generated planning aid" in process_flow
    assert "process_step,station_id,characteristic" in control_plan
    assert "Work Instruction Draft" in work_instruction


def test_checked_in_case_study_artifacts_exist_and_are_consistent():
    assert CASE_STUDY.exists()

    required_files = [
        "README.md",
        "review.json",
        "process-plan.json",
        "line-plan.json",
        "quality-risk.json",
        "investment-review.json",
        "readiness-report.json",
        "readiness-report.md",
        "stabilization-review.json",
    ]

    for filename in required_files:
        assert (DOC_EXAMPLE / filename).exists(), f"missing checked-in example artifact: {filename}"

    review = json.loads((DOC_EXAMPLE / "review.json").read_text(encoding="utf-8"))
    readiness = json.loads((DOC_EXAMPLE / "readiness-report.json").read_text(encoding="utf-8"))
    stabilization = json.loads((DOC_EXAMPLE / "stabilization-review.json").read_text(encoding="utf-8"))
    assert review["part"]["name"] == readiness["part"]["name"]
    assert readiness["summary"]["top_issues"]
    assert stabilization["agent"] == "stabilization_review"


def test_checked_in_electronics_standard_doc_example_exists():
    assert (DOC_ELECTRONICS_EXAMPLE / "README.md").exists()

    expected_files = [
        "standard-docs/process_flow.md",
        "standard-docs/control_plan_draft.csv",
        "standard-docs/inspection_checksheet_draft.csv",
        "standard-docs/work_instruction_draft.md",
        "standard-docs/pfmea_seed.csv",
        "standard-docs/standard_docs_manifest.json",
    ]

    for filename in expected_files:
        assert (DOC_ELECTRONICS_EXAMPLE / filename).exists(), f"missing checked-in electronics standard doc: {filename}"


def test_markdown_docs_do_not_contain_local_paths_and_links_resolve():
    markdown_files = [ROOT / "README.md", *sorted((ROOT / "docs").rglob("*.md"))]
    link_pattern = re.compile(r"\]\(([^)]+)\)")

    for markdown_file in markdown_files:
        content = markdown_file.read_text(encoding="utf-8")
        assert "/Users/" not in content, f"machine-local path found in {markdown_file}"

        for raw_target in link_pattern.findall(content):
            target = raw_target.split("#", 1)[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue

            resolved = (markdown_file.parent / target).resolve()
            assert resolved.exists(), f"broken markdown link in {markdown_file}: {raw_target}"
