#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path

from _manufacturing_demo import ensure_dir, extract_inspection_records, load_json, validate_context


DISCLAIMER = (
    "DELMIA-adjacent review guidance only. This is not an official DELMIA or "
    "3DEXPERIENCE integration and not verified engineering truth."
)


def issue_lookup(quality_issues):
    lookup = {}
    for issue in quality_issues or []:
        lookup.setdefault(issue.get("operation_id"), []).append(issue)
    return lookup


def match_operation(context, record):
    routing = context.get("routing", [])
    direct = next((op for op in routing if op.get("operation_id") == record.get("operation_id")), None)
    if direct:
        return direct, "direct_operation_id", [direct.get("operation_id")]

    feature_ref = (record.get("feature_ref") or "").strip().lower()
    if feature_ref:
        matches = []
        for operation in routing:
            refs = [str(value).lower() for value in operation.get("cad_feature_refs", [])]
            if feature_ref in refs:
                matches.append(operation)
        if len(matches) == 1:
            return matches[0], "feature_ref_match", [matches[0].get("operation_id")]
        if len(matches) > 1:
            return None, "ambiguous_feature_ref", [item.get("operation_id") for item in matches]
    return None, "unmatched", []


def derive_cause(record, operation):
    characteristic = (record.get("characteristic") or "").lower()
    feature = (record.get("feature_ref") or "").lower()
    operation_name = (operation.get("operation_name") or "").lower()

    if "hole" in characteristic or "diameter" in characteristic or "hole" in feature:
        if "drill" in operation_name:
            return "Hole variation is consistent with drill wear, offset drift, or fixture repeatability loss."
        return "Hole variation likely comes from upstream datum shift or feature transfer into the current operation."
    if "burr" in characteristic:
        return "Residual burrs suggest incomplete deburr coverage or worn finishing media."
    if "perpendicularity" in characteristic or "flatness" in characteristic:
        return "Datum or clamping variation may be carrying into the measured feature."
    return "Feature variation should be reviewed at the matched operation before changing downstream inspection logic."


def derive_action(record, operation):
    characteristic = (record.get("characteristic") or "").lower()
    operation_name = operation.get("operation_name")
    if "hole" in characteristic or "diameter" in characteristic:
        return f"Add first-piece offset verification and tool-life trigger review at {operation_name}."
    if "burr" in characteristic:
        return f"Add a groove-specific deburr confirmation and media replacement check at {operation_name}."
    if "perpendicularity" in characteristic or "flatness" in characteristic:
        return f"Re-check fixture clamping and datum recovery logic at {operation_name}."
    return f"Review work instructions and in-station checks at {operation_name} before changing final inspection."


def compute_confidence(record, match_type, linked_issues):
    confidence = 0.35
    if match_type == "direct_operation_id":
        confidence += 0.3
    elif match_type == "feature_ref_match":
        confidence += 0.2
    elif match_type == "ambiguous_feature_ref":
        confidence += 0.05
    if record.get("feature_ref"):
        confidence += 0.1
    if record.get("status") in {"out_of_tolerance", "warning"}:
        confidence += 0.1
    if linked_issues:
        confidence += 0.1
    return round(min(confidence, 0.95), 2)


def build_guidance(context, records):
    centers = {item["work_center_id"]: item for item in context.get("work_centers", [])}
    issues_by_operation = issue_lookup(context.get("quality_issues"))
    guidance = []

    for record in records:
        operation, match_type, candidate_operation_ids = match_operation(context, record)
        if operation:
            work_center = centers.get(operation.get("work_center_id"), {})
            linked_issues = issues_by_operation.get(operation.get("operation_id"), [])
            guidance.append({
                "inspection_record_id": record.get("record_id"),
                "status": record.get("status"),
                "affected_feature": record.get("feature_ref"),
                "related_operation": {
                    "operation_id": operation.get("operation_id"),
                    "operation_name": operation.get("operation_name"),
                    "work_center_id": operation.get("work_center_id"),
                    "work_center_name": work_center.get("name")
                },
                "possible_manufacturing_cause": derive_cause(record, operation),
                "recommended_action": derive_action(record, operation),
                "confidence": compute_confidence(record, match_type, linked_issues),
                "evidence_references": [
                    f"inspection:{record.get('record_id')}",
                    f"routing:{operation.get('operation_id')}",
                    f"work_center:{operation.get('work_center_id')}",
                    *[f"quality_issue:{item.get('issue_id')}" for item in linked_issues]
                ],
                "review_guidance_note": "Guidance only. Validate with manufacturing engineering and quality before changing the process."
            })
        else:
            ambiguous = match_type == "ambiguous_feature_ref"
            guidance.append({
                "inspection_record_id": record.get("record_id"),
                "status": record.get("status"),
                "affected_feature": record.get("feature_ref"),
                "related_operation": None,
                "possible_manufacturing_cause": (
                    "Feature reference matches multiple routing steps in the sample context, so the script fails closed to manual review."
                    if ambiguous
                    else "No deterministic routing match was found in the sample context."
                ),
                "recommended_action": (
                    "Manually review the candidate operations before using this result."
                    if ambiguous
                    else "Manually review the routing and feature reference before using this result."
                ),
                "confidence": compute_confidence(record, match_type, []),
                "evidence_references": [
                    f"inspection:{record.get('record_id')}",
                    *[f"routing_candidate:{item}" for item in candidate_operation_ids]
                ],
                "review_guidance_note": (
                    "Guidance only. Manual review is required because the feature maps to multiple routing steps."
                    if ambiguous
                    else "Guidance only. Validate with manufacturing engineering and quality before changing the process."
                )
            })
    return guidance


def build_report(context, inspection_payload):
    records = extract_inspection_records(inspection_payload)
    guidance = build_guidance(context, records)
    linked = sum(1 for item in guidance if item["related_operation"])
    return {
        "report_type": "delmia_style_inspection_quality_linkage_demo",
        "disclaimer": DISCLAIMER,
        "prototype_positioning": "Deterministic DELMIA-style review guidance that links inspection findings to routing and feature references.",
        "summary": {
            "record_count": len(guidance),
            "out_of_tolerance_count": sum(1 for item in guidance if item["status"] == "out_of_tolerance"),
            "linked_to_operation_count": linked,
            "manual_review_count": len(guidance) - linked
        },
        "review_guidance": guidance
    }


def write_summary(report, output_path):
    lines = [
        "# Inspection To Manufacturing Review Guidance",
        "",
        f"- Disclaimer: {report['disclaimer']}",
        f"- Records reviewed: `{report['summary']['record_count']}`",
        f"- Out of tolerance: `{report['summary']['out_of_tolerance_count']}`",
        f"- Routed matches: `{report['summary']['linked_to_operation_count']}`",
        "",
        "## Guidance",
        ""
    ]
    for item in report["review_guidance"]:
        lines.append(f"- `{item['inspection_record_id']}` -> {item['recommended_action']}")
        lines.append(f"  Cause: {item['possible_manufacturing_cause']}")
        lines.append(f"  Confidence: {item['confidence']}")
    Path(output_path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Link inspection records to manufacturing operations.")
    parser.add_argument("--context", default="configs/examples/manufacturing/bracket_line_context.json")
    parser.add_argument("--inspection", default="configs/examples/manufacturing/bracket_inspection_records.json")
    parser.add_argument("--out-dir", default="output/delmia-demo")
    args = parser.parse_args()

    try:
        context = validate_context(load_json(args.context))
        report = build_report(context, load_json(args.inspection))
        out_dir = ensure_dir(args.out_dir)
        report_path = out_dir / "inspection_quality_linkage_report.json"
        summary_path = out_dir / "inspection_quality_linkage_summary.md"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        write_summary(report, summary_path)

        print(json.dumps({
            "success": True,
            "report_path": str(report_path),
            "summary_path": str(summary_path),
            "record_count": report["summary"]["record_count"],
            "linked_to_operation_count": report["summary"]["linked_to_operation_count"]
        }))
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
