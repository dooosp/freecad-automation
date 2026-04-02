import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "configs" / "examples"
REVIEW_PACK_FIXTURE = ROOT / "tests" / "fixtures" / "d-artifacts" / "sample_review_pack.canonical.json"
DOC_EXAMPLE = ROOT / "docs" / "examples" / "infotainment-display-bracket"
DOC_ELECTRONICS_EXAMPLE = ROOT / "docs" / "examples" / "controller-housing-eol"
CASE_STUDY = ROOT / "docs" / "portfolio" / "infotainment-production-readiness-case.md"
BEFORE_AFTER_CASE = ROOT / "docs" / "portfolio" / "before-after-improvement-case.md"


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

    completed = run_cli(
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
    assert any("legacy compatibility route" in warning.lower() for warning in report["warnings"])
    combined_output = f"{completed.stdout}\n{completed.stderr}"
    assert "legacy compatibility route" in combined_output.lower()


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


def test_mexico_runtime_example_has_expected_launch_ramp_shape():
    runtime_path = ROOT / "data" / "runtime_examples" / "display_bracket_runtime_mexico.json"
    runtime_payload = json.loads(runtime_path.read_text(encoding="utf-8"))

    assert runtime_payload["site"] == "Mexico-MTY"
    assert len(runtime_payload["stations"]) >= 7
    assert any(station["fpy"] < 0.95 for station in runtime_payload["stations"])
    assert any(station["downtime_pct"] > 9 for station in runtime_payload["stations"])
    assert any(station["actual_ct_sec"] > station["target_ct_sec"] for station in runtime_payload["stations"])


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
    readiness_path = tmp_path / "controller_readiness.json"

    run_cli(
        [
            "readiness-report",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--out",
            str(readiness_path),
        ]
    )

    run_cli(
        [
            "generate-standard-docs",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--readiness-report",
            str(readiness_path),
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


def test_profile_aware_standard_doc_presets_change_owner_and_frequency(tmp_path):
    korea_dir = tmp_path / "docs_korea"
    mexico_dir = tmp_path / "docs_mexico"
    readiness_path = tmp_path / "controller_readiness.json"

    run_cli(
        [
            "readiness-report",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--out",
            str(readiness_path),
        ]
    )

    run_cli(
        [
            "generate-standard-docs",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--readiness-report",
            str(readiness_path),
            "--profile",
            str(ROOT / "configs" / "profiles" / "site_korea_ulsan.toml"),
            "--out-dir",
            str(korea_dir),
        ]
    )
    run_cli(
        [
            "generate-standard-docs",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--readiness-report",
            str(readiness_path),
            "--profile",
            str(ROOT / "configs" / "profiles" / "site_mexico_mty.toml"),
            "--out-dir",
            str(mexico_dir),
        ]
    )

    korea_control_plan = (korea_dir / "control_plan_draft.csv").read_text(encoding="utf-8")
    mexico_control_plan = (mexico_dir / "control_plan_draft.csv").read_text(encoding="utf-8")
    korea_work_instruction = (korea_dir / "work_instruction_draft.md").read_text(encoding="utf-8")
    mexico_work_instruction = (mexico_dir / "work_instruction_draft.md").read_text(encoding="utf-8")

    assert "Pilot lot 100% + hourly layered audit" in korea_control_plan
    assert "First 3 lots 100% + hourly layered audit" in mexico_control_plan
    assert "Quality engineering" in korea_control_plan
    assert "Resident quality engineering" in mexico_control_plan
    assert "Profile preset: Korea-Ulsan launch profile" in korea_work_instruction
    assert "Profile preset: Mexico-MTY launch profile" in mexico_work_instruction


def test_generate_standard_docs_requires_explicit_canonical_readiness_input(tmp_path):
    out_dir = tmp_path / "docs_without_readiness"

    completed = run_cli(
        [
            "generate-standard-docs",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--out-dir",
            str(out_dir),
        ],
        check=False,
    )

    assert completed.returncode != 0
    combined_output = f"{completed.stdout}\n{completed.stderr}"
    assert "requires either --readiness-report" in combined_output
    assert "will not synthesize canonical readiness from config-only inputs" in combined_output


def test_generate_standard_docs_rejects_mismatched_config_and_review_pack(tmp_path):
    out_dir = tmp_path / "docs_mismatched_review_pack"

    completed = run_cli(
        [
            "generate-standard-docs",
            str(EXAMPLES / "controller_housing_eol.toml"),
            "--review-pack",
            str(REVIEW_PACK_FIXTURE),
            "--out-dir",
            str(out_dir),
        ],
        check=False,
    )

    assert completed.returncode != 0
    combined_output = f"{completed.stdout}\n{completed.stderr}"
    assert "does not match readiness report lineage" in combined_output


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


def test_checked_in_stabilization_comparison_artifacts_exist():
    comparison_md = DOC_EXAMPLE / "stabilization-comparison.md"
    comparison_json = DOC_EXAMPLE / "stabilization-comparison.json"
    mexico_review = DOC_EXAMPLE / "stabilization-review-mexico.json"

    assert comparison_md.exists()
    assert comparison_json.exists()
    assert mexico_review.exists()

    payload = json.loads(comparison_json.read_text(encoding="utf-8"))
    assert payload["summary"]["higher_risk_site"] == "Mexico-MTY"
    assert len(payload["sites"]) == 2
    assert payload["station_gap_delta_sec"]


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

    assert (DOC_ELECTRONICS_EXAMPLE / "standard-docs-korea" / "control_plan_draft.csv").exists()
    assert (DOC_ELECTRONICS_EXAMPLE / "standard-docs-mexico" / "control_plan_draft.csv").exists()

    korea_control_plan = (DOC_ELECTRONICS_EXAMPLE / "standard-docs-korea" / "control_plan_draft.csv").read_text(encoding="utf-8")
    mexico_control_plan = (DOC_ELECTRONICS_EXAMPLE / "standard-docs-mexico" / "control_plan_draft.csv").read_text(encoding="utf-8")
    assert "Pilot lot 100% + hourly layered audit" in korea_control_plan
    assert "First 3 lots 100% + hourly layered audit" in mexico_control_plan


def test_before_after_improvement_artifacts_exist_and_show_score_gain():
    assert BEFORE_AFTER_CASE.exists()

    before_report = json.loads((DOC_EXAMPLE / "before-readiness-report.json").read_text(encoding="utf-8"))
    after_report = json.loads((DOC_EXAMPLE / "after-readiness-report.json").read_text(encoding="utf-8"))
    before_after_summary = (DOC_EXAMPLE / "before-after-summary.md").read_text(encoding="utf-8")

    assert after_report["readiness_summary"]["score"] > before_report["readiness_summary"]["score"]
    assert before_report["readiness_summary"]["status"] == "needs_risk_reduction"
    assert after_report["readiness_summary"]["status"] == "pilot_line_planning_ready"
    assert "Before: `64`" in before_after_summary
    assert "After: `71`" in before_after_summary


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
