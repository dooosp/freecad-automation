import re

from adapters.common import coerce_float


LENGTH_UNIT_ALIASES = {
    "mm": "mm",
    "millimeter": "mm",
    "millimeters": "mm",
    "millimetre": "mm",
    "millimetres": "mm",
    "in": "inch",
    "inch": "inch",
    "inches": "inch",
    '"': "inch",
}


def canonical_length_unit(value):
    text = str(value or "").strip().lower().rstrip(".")
    if not text:
        return None
    return LENGTH_UNIT_ALIASES.get(text)


def _parse_numeric_value(value):
    if value in (None, "", "null", "None", "-"):
        return None
    if isinstance(value, (int, float)):
        return {
            "number": float(value),
            "unit": None,
            "had_unit_token": False,
            "raw_unit": None,
            "raw_text": str(value),
        }

    text = str(value).strip()
    if not text:
        return None

    sanitized = text.replace(",", "")
    match = re.match(r'^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*([A-Za-z"]+)?$', sanitized)
    if match:
        raw_unit = match.group(2)
        return {
            "number": float(match.group(1)),
            "unit": canonical_length_unit(raw_unit),
            "had_unit_token": bool(raw_unit),
            "raw_unit": raw_unit,
            "raw_text": text,
        }

    number = coerce_float(sanitized)
    if number is not None:
        return {
            "number": number,
            "unit": None,
            "had_unit_token": False,
            "raw_unit": None,
            "raw_text": text,
        }

    return {
        "number": None,
        "unit": None,
        "had_unit_token": False,
        "raw_unit": None,
        "raw_text": text,
    }


def _to_mm(number, unit):
    if number is None:
        return None
    if unit == "inch":
        return round(number * 25.4, 6)
    return round(number, 6)


def normalize_length_fields(field_values, row_unit=None, row_index=None):
    diagnostics = []
    normalized = {}
    source_units = {}

    row_unit_text = str(row_unit or "").strip()
    canonical_row_unit = canonical_length_unit(row_unit_text)
    if row_unit_text:
        source_units["row"] = row_unit_text
    if row_unit_text and canonical_row_unit is None:
        diagnostics.append({
            "code": "unsupported_unit",
            "message": f"Row {row_index} uses unsupported unit '{row_unit_text}'.",
            "severity": "warning",
            "row": row_index,
            "field": "units",
            "raw_unit": row_unit_text,
        })

    for field_name, raw_value in (field_values or {}).items():
        parsed = _parse_numeric_value(raw_value)
        if parsed is None:
            normalized[field_name] = None
            continue

        if parsed["number"] is None:
            normalized[field_name] = None
            diagnostics.append({
                "code": "invalid_numeric",
                "message": f"Row {row_index} has a non-numeric value for {field_name}: {parsed['raw_text']}.",
                "severity": "warning",
                "row": row_index,
                "field": field_name,
                "raw_value": parsed["raw_text"],
            })
            continue

        if parsed["had_unit_token"] and parsed["unit"] is None:
            normalized[field_name] = None
            diagnostics.append({
                "code": "unsupported_unit",
                "message": f"Row {row_index} uses unsupported unit '{parsed['raw_unit']}' for {field_name}.",
                "severity": "warning",
                "row": row_index,
                "field": field_name,
                "raw_unit": parsed["raw_unit"],
            })
            continue

        effective_unit = parsed["unit"] or canonical_row_unit or "mm"
        if parsed["unit"] and canonical_row_unit and parsed["unit"] != canonical_row_unit:
            diagnostics.append({
                "code": "unit_conflict",
                "message": f"Row {row_index} mixes inline unit '{parsed['raw_unit']}' with row unit '{row_unit_text}' for {field_name}.",
                "severity": "warning",
                "row": row_index,
                "field": field_name,
                "inline_unit": parsed["unit"],
                "row_unit": canonical_row_unit,
            })

        source_units[field_name] = parsed["raw_unit"] or row_unit_text or effective_unit
        normalized[field_name] = _to_mm(parsed["number"], effective_unit)

    return {
        "values": normalized,
        "canonical_unit": "mm",
        "source_units": source_units,
        "diagnostics": diagnostics,
    }
