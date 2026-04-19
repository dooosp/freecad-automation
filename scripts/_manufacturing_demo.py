#!/usr/bin/env python3

import json
from pathlib import Path


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)
    return Path(path)


def _require_fields(document, required_fields, label):
    missing = [field for field in required_fields if field not in document]
    if missing:
        raise ValueError(f"{label} is missing required fields: {', '.join(missing)}")


def validate_context(context):
    _require_fields(
        context,
        [
            "schema_version",
            "prototype_scope",
            "plant",
            "product",
            "production_line",
            "work_centers",
            "routing",
            "bom_references",
            "inspection_records",
            "quality_issues",
            "planning_data",
        ],
        "manufacturing context",
    )

    if context.get("schema_version") != "1.0":
        raise ValueError("manufacturing context schema_version must be '1.0'")

    prototype_scope = context.get("prototype_scope") or {}
    if prototype_scope.get("not_official_dassault_or_delmia_integration") is not True:
        raise ValueError(
            "manufacturing context must set prototype_scope.not_official_dassault_or_delmia_integration=true"
        )

    work_centers = context.get("work_centers") or []
    routing = context.get("routing") or []
    if not work_centers:
        raise ValueError("manufacturing context must include at least one work center")
    if not routing:
        raise ValueError("manufacturing context must include at least one routing step")

    center_ids = {item.get("work_center_id") for item in work_centers}
    required_routing_fields = {
        "operation_id",
        "sequence",
        "operation_name",
        "work_center_id",
        "machine_cycle_sec",
        "labor_cycle_sec",
    }
    for operation in routing:
        missing = sorted(required_routing_fields - set(operation))
        if missing:
            raise ValueError(
                f"routing operation is missing required fields: {', '.join(missing)}"
            )
        if operation.get("work_center_id") not in center_ids:
            raise ValueError(
                f"routing operation {operation.get('operation_id')} references unknown work center {operation.get('work_center_id')}"
            )

    return context


def extract_inspection_records(payload):
    records = payload.get("records", []) if isinstance(payload, dict) else payload
    if not isinstance(records, list) or not records:
        raise ValueError("inspection payload must contain a non-empty records list")
    for record in records:
        _require_fields(record, ["record_id", "characteristic", "status"], "inspection record")
        if not record.get("operation_id") and not record.get("feature_ref"):
            raise ValueError(
                f"inspection record {record.get('record_id')} must include operation_id or feature_ref"
            )
    return records
