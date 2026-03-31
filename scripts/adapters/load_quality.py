from adapters.column_mapper import ColumnMapper
from adapters.common import build_identifier, coerce_int, read_records
from adapters.evidence_refs import build_evidence_refs, warning_messages
from adapters.id_resolver import normalize_feature_ref, normalize_issue_ref
from adapters.location_normalizer import normalize_location_ref
from adapters.process_normalizer import (
    normalize_process_ref,
    normalize_process_step,
    normalize_quality_status,
    normalize_severity,
)


def load_quality_issues(path):
    rows = read_records(path)
    issues = []
    warnings = []
    diagnostics = []

    for index, row in enumerate(rows, start=1):
        mapper = ColumnMapper(row, index)
        raw_issue_id = mapper.pick("issue_id", ["issue_id", "id", "ncr", "ncr_id"])
        issue_id = build_identifier("quality", raw_issue_id, index)
        description = mapper.pick("description", ["description", "defect_description", "issue", "problem"], "")
        severity = mapper.pick("severity", ["severity", "priority"], "medium")
        status = mapper.pick("status", ["status", "disposition"], "open")
        feature_hint = mapper.pick("feature_hint", ["feature_hint", "feature", "feature_class"])
        location_hint = mapper.pick("location_hint", ["location_hint", "location", "zone"])
        process_step = mapper.pick("process_step", ["process_step", "operation", "process"])

        record_diagnostics = list(mapper.diagnostics)
        if not description:
            record_diagnostics.append({
                "code": "missing_description",
                "message": f"Quality row {index} missing description.",
                "severity": "warning",
                "row": index,
                "field": "description",
            })
        if not feature_hint:
            record_diagnostics.append({
                "code": "missing_feature_hint",
                "message": f"Quality row {index} missing feature_hint.",
                "severity": "warning",
                "row": index,
                "field": "feature_hint",
            })
        if not location_hint:
            record_diagnostics.append({
                "code": "missing_location_hint",
                "message": f"Quality row {index} missing location_hint.",
                "severity": "warning",
                "row": index,
                "field": "location_hint",
            })

        issue = {
            "issue_id": issue_id,
            "normalized_issue_ref": normalize_issue_ref(issue_id),
            "defect_code": mapper.pick("defect_code", ["defect_code", "code", "failure_code"]),
            "defect_class": mapper.pick("defect_class", ["defect_class", "category", "type"]),
            "description": description or f"quality-issue-{index:03d}",
            "severity": normalize_severity(severity) or "medium",
            "status": normalize_quality_status(status) or "open",
            "location_hint": location_hint,
            "normalized_location_ref": normalize_location_ref(location_hint),
            "feature_hint": feature_hint,
            "normalized_feature_ref": normalize_feature_ref(feature_hint),
            "process_step": normalize_process_step(process_step) if process_step else None,
            "normalized_process_ref": normalize_process_ref(process_step),
            "occurrence_count": coerce_int(mapper.pick("occurrence_count", ["occurrence_count", "count", "frequency"], 1)) or 1,
            "quantity": coerce_int(mapper.pick("quantity", ["quantity", "qty"])),
            "source_row": index,
        }
        issue.update(build_evidence_refs(
            path,
            index,
            row,
            mapper.field_map,
            record_diagnostics,
            [issue_id, description, issue["defect_code"], issue["defect_class"], feature_hint, location_hint, process_step],
        ))
        issues.append(issue)
        warnings.extend(warning_messages(record_diagnostics))
        diagnostics.extend(record_diagnostics)

    return issues, warnings, diagnostics
