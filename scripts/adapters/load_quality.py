from adapters.common import build_identifier, coerce_int, pick_first, read_records


def load_quality_issues(path):
    rows = read_records(path)
    issues = []
    warnings = []

    for index, row in enumerate(rows, start=1):
        description = pick_first(row, ["description", "defect_description", "issue", "problem"], "")
        issue = {
            "issue_id": build_identifier("quality", pick_first(row, ["issue_id", "id", "ncr", "ncr_id"]), index),
            "defect_code": pick_first(row, ["defect_code", "code", "failure_code"]),
            "defect_class": pick_first(row, ["defect_class", "category", "type"]),
            "description": description or f"quality-issue-{index:03d}",
            "severity": pick_first(row, ["severity", "priority"], "medium"),
            "status": pick_first(row, ["status", "disposition"], "open"),
            "location_hint": pick_first(row, ["location_hint", "location", "zone"]),
            "feature_hint": pick_first(row, ["feature_hint", "feature", "feature_class"]),
            "process_step": pick_first(row, ["process_step", "operation", "process"]),
            "occurrence_count": coerce_int(pick_first(row, ["occurrence_count", "count", "frequency"], 1)) or 1,
            "quantity": coerce_int(pick_first(row, ["quantity", "qty"])),
            "source_row": index,
        }
        if not description:
            warnings.append(f"Quality row {index} missing description")
        issues.append(issue)

    return issues, warnings
