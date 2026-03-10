import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "configs" / "examples"
DOC_EXAMPLE = ROOT / "docs" / "examples" / "infotainment-display-bracket"
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
    ]

    for filename in required_files:
        assert (DOC_EXAMPLE / filename).exists(), f"missing checked-in example artifact: {filename}"

    review = json.loads((DOC_EXAMPLE / "review.json").read_text(encoding="utf-8"))
    readiness = json.loads((DOC_EXAMPLE / "readiness-report.json").read_text(encoding="utf-8"))
    assert review["part"]["name"] == readiness["part"]["name"]
    assert readiness["summary"]["top_issues"]


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
