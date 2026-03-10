from adapters.common import build_identifier, coerce_float, coerce_int, pick_first, read_records


def load_bom_entries(path):
    rows = read_records(path)
    entries = []
    warnings = []

    for index, row in enumerate(rows, start=1):
        quantity = coerce_float(pick_first(row, ["quantity", "qty", "count"], 1)) or 1.0
        line_number = coerce_int(pick_first(row, ["line_number", "item", "item_no", "line"]))
        part_number = pick_first(row, ["part_number", "part_no", "part", "item_code", "sku"], f"ITEM-{index:03d}")
        description = pick_first(row, ["description", "name", "title", "component"], "")

        entries.append({
            "entry_id": build_identifier("bom", pick_first(row, ["entry_id", "id"]), index),
            "line_number": line_number,
            "part_number": str(part_number),
            "description": description or None,
            "quantity": quantity,
            "unit": pick_first(row, ["unit", "uom"], "ea"),
            "material": pick_first(row, ["material", "material_spec"]),
            "revision": pick_first(row, ["revision", "rev"]),
            "supplier": pick_first(row, ["supplier", "vendor"]),
            "process": pick_first(row, ["process", "operation", "routing_step"]),
            "notes": pick_first(row, ["notes", "comment", "remarks"]),
            "source_row": index,
        })

        if not description:
            warnings.append(f"BOM row {index} missing description")

    return entries, warnings
