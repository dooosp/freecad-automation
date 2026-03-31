from adapters.column_mapper import ColumnMapper
from adapters.common import build_identifier, coerce_float, coerce_int, read_records
from adapters.evidence_refs import build_evidence_refs, warning_messages
from adapters.process_normalizer import normalize_process_ref, normalize_process_step


def load_bom_entries(path):
    rows = read_records(path)
    entries = []
    warnings = []
    diagnostics = []

    for index, row in enumerate(rows, start=1):
        mapper = ColumnMapper(row, index)
        entry_id = build_identifier("bom", mapper.pick("entry_id", ["entry_id", "id"]), index)
        quantity = coerce_float(mapper.pick("quantity", ["quantity", "qty", "count"], 1)) or 1.0
        line_number = coerce_int(mapper.pick("line_number", ["line_number", "item", "item_no", "line"]))
        part_number = mapper.pick("part_number", ["part_number", "part_no", "part", "item_code", "sku"], f"ITEM-{index:03d}")
        description = mapper.pick("description", ["description", "name", "title", "component"], "")
        process = mapper.pick("process", ["process", "operation", "routing_step"])

        record_diagnostics = list(mapper.diagnostics)
        if not description:
            record_diagnostics.append({
                "code": "missing_description",
                "message": f"BOM row {index} missing description.",
                "severity": "warning",
                "row": index,
                "field": "description",
            })

        entry = {
            "entry_id": entry_id,
            "line_number": line_number,
            "part_number": str(part_number),
            "description": description or None,
            "quantity": quantity,
            "unit": mapper.pick("unit", ["unit", "uom"], "ea"),
            "material": mapper.pick("material", ["material", "material_spec"]),
            "revision": mapper.pick("revision", ["revision", "rev"]),
            "supplier": mapper.pick("supplier", ["supplier", "vendor"]),
            "process": normalize_process_step(process) if process else None,
            "normalized_process_ref": normalize_process_ref(process),
            "notes": mapper.pick("notes", ["notes", "comment", "remarks"]),
            "source_row": index,
        }
        entry.update(build_evidence_refs(
            path,
            index,
            row,
            mapper.field_map,
            record_diagnostics,
            [entry_id, part_number, description, process],
        ))
        entries.append(entry)
        warnings.extend(warning_messages(record_diagnostics))
        diagnostics.extend(record_diagnostics)

    return entries, warnings, diagnostics
