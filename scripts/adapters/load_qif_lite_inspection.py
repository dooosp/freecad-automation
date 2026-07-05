from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "1.0"
ADAPTER_NAME = "qif-lite"
FINAL_OVERALL_RESULTS = {"pass", "fail", "partial"}
FINAL_FEATURE_RESULTS = {"pass", "fail", "not_measured"}
FINAL_INSPECTION_STATUSES = {"completed", "final", "approved"}
SUPPORTED_SOURCE_TYPES = {
    "cmm_report",
    "manual_caliper_check",
    "go_no_go_gauge",
    "first_article_inspection",
    "supplier_inspection_report",
    "other_inspection_source",
}


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find_first(parent: ET.Element, tag: str) -> ET.Element | None:
    for node in parent.iter():
        if _local_name(node.tag) == tag:
            return node
    return None


def _find_all(parent: ET.Element, tag: str) -> list[ET.Element]:
    return [node for node in parent.iter() if _local_name(node.tag) == tag]


def _text(parent: ET.Element, tag: str, default: str | None = None) -> str | None:
    node = _find_first(parent, tag)
    if node is None or node.text is None:
        return default
    value = node.text.strip()
    return value if value else default


def _number(value: str | None) -> float | str | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return value


def _normalized_result(value: str | None, default: str = "unknown") -> str:
    normalized = (value or default).strip().lower()
    return normalized or default


def _measurement_system(units: str | None) -> str:
    normalized = (units or "").strip().lower()
    if normalized in {"mm", "millimeter", "millimeters"}:
        return "metric"
    if normalized in {"in", "inch", "inches"}:
        return "imperial"
    return "unknown"


def parse_qif_lite_xml(path: Path, source_ref: str) -> dict[str, Any]:
    root = ET.parse(path).getroot()
    inspection = _find_first(root, "Inspection")
    if inspection is None:
        return {
            "schema_version": SCHEMA_VERSION,
            "adapter": ADAPTER_NAME,
            "source_ref": source_ref,
            "classification": {
                "attachment_ready_candidate": False,
                "rejection_reasons": ["missing_inspection_node"],
            },
            "inspection_evidence": None,
        }

    units = _text(inspection, "Units", "unknown")
    features = []
    feature_rejection_reasons = []
    measured_feature_count = 0
    for index, feature in enumerate(_find_all(inspection, "Feature"), start=1):
        result = _normalized_result(_text(feature, "Result"), "unknown")
        measured_value = _number(_text(feature, "MeasuredValue"))
        feature_id = _text(feature, "FeatureId", f"unknown_feature_{index:03d}")
        if result not in FINAL_FEATURE_RESULTS:
            feature_rejection_reasons.append(f"feature_{index}_result_not_final")
        if measured_value is None and result != "not_measured":
            feature_rejection_reasons.append(f"feature_{index}_missing_measured_value")
        if measured_value is not None and result != "not_measured":
            measured_feature_count += 1
        features.append({
            "feature_id": feature_id,
            "nominal_value": _number(_text(feature, "NominalValue")),
            "measured_value": measured_value,
            "tolerance_lower": _number(_text(feature, "ToleranceLower")),
            "tolerance_upper": _number(_text(feature, "ToleranceUpper")),
            "units": _text(feature, "Units", units),
            "result": result,
            "measurement_method": _text(feature, "MeasurementMethod", "unknown"),
        })

    package_id = _text(inspection, "PackageId")
    inspected_part = _text(inspection, "InspectedPart")
    inspected_at = _text(inspection, "InspectedAt")
    source_type_raw = _text(inspection, "SourceType")
    normalized_source_type = (source_type_raw or "").strip().lower()
    source_type = normalized_source_type if normalized_source_type in SUPPORTED_SOURCE_TYPES else "other_inspection_source"
    inspection_status_raw = _text(inspection, "InspectionStatus")
    inspection_status = _normalized_result(inspection_status_raw, "unknown")
    inspector = _text(inspection, "Inspector")
    reviewed_by = _text(inspection, "ReviewedBy")
    part_revision = _text(inspection, "PartRevision")
    overall_result = _normalized_result(_text(inspection, "OverallResult"), "unknown")
    evidence = {
        "schema_version": SCHEMA_VERSION,
        "evidence_type": "inspection_evidence",
        "source_type": source_type,
        "source_type_raw": source_type_raw,
        "package_id": package_id,
        "inspected_part": inspected_part,
        "inspected_at": inspected_at,
        "inspection_status": inspection_status,
        "inspector": inspector,
        "reviewed_by": reviewed_by,
        "part_revision": part_revision,
        "units": units,
        "measurement_system": _measurement_system(units),
        "overall_result": overall_result,
        "source_ref": source_ref,
        "measured_features": features,
    }

    rejection_reasons = []
    if measured_feature_count == 0:
        rejection_reasons.append("missing_measured_features")
    if not package_id:
        rejection_reasons.append("missing_package_id")
    if not inspected_part:
        rejection_reasons.append("missing_inspected_part")
    if not inspected_at:
        rejection_reasons.append("missing_inspected_at")
    if not source_type_raw:
        rejection_reasons.append("missing_source_type")
    elif source_type != normalized_source_type:
        rejection_reasons.append("unsupported_source_type")
    if not inspection_status_raw:
        rejection_reasons.append("missing_inspection_status")
    elif inspection_status not in FINAL_INSPECTION_STATUSES:
        rejection_reasons.append("inspection_status_not_final")
    if not inspector:
        rejection_reasons.append("missing_inspector")
    if not reviewed_by:
        rejection_reasons.append("missing_reviewed_by")
    if not part_revision:
        rejection_reasons.append("missing_part_revision")
    if overall_result not in FINAL_OVERALL_RESULTS:
        rejection_reasons.append("overall_result_not_final")
    rejection_reasons.extend(feature_rejection_reasons)

    return {
        "schema_version": SCHEMA_VERSION,
        "adapter": ADAPTER_NAME,
        "source_ref": source_ref,
        "classification": {
            "attachment_ready_candidate": len(rejection_reasons) == 0,
            "rejection_reasons": rejection_reasons,
        },
        "inspection_evidence": evidence,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert QIF-lite inspection XML to inspection evidence JSON.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--source-ref", required=True)
    args = parser.parse_args(argv)

    report = parse_qif_lite_xml(Path(args.input), source_ref=args.source_ref)
    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
