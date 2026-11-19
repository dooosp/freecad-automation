"""Compare required samples with supplier measurements using purchaser limits."""

import re
from collections import defaultdict
from decimal import Context, Decimal, InvalidOperation, localcontext


FACTORS_MM = {"mm": Decimal("1"), "inch": Decimal("25.4"), "in": Decimal("25.4")}
SUPPLIER_OUTCOMES = {
    "pass": "in_tolerance",
    "ok": "in_tolerance",
    "합격": "in_tolerance",
    "fail": "out_of_tolerance",
    "ng": "out_of_tolerance",
    "불합격": "out_of_tolerance",
}

DECIMAL_TEXT = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
MAX_DECIMAL_POSITIONS = 128
EXACT_CONTEXT = Context(prec=2 * MAX_DECIMAL_POSITIONS + 5)


def _decimal(value):
    if value is None:
        return None
    text = str(value).strip()
    if len(text) > 2 * MAX_DECIMAL_POSITIONS or not DECIMAL_TEXT.fullmatch(text):
        return None
    try:
        number = Decimal(text)
    except InvalidOperation:
        return None
    # Bound the digits on each side of the decimal point so conversion,
    # subtraction, and fixed-point formatting stay exact and bounded in size.
    if not number.is_finite() or number.as_tuple().exponent < -MAX_DECIMAL_POSITIONS:
        return None
    if number.adjusted() >= MAX_DECIMAL_POSITIONS:
        return None
    return number


def _factor(unit):
    return FACTORS_MM.get(unit.strip().casefold()) if isinstance(unit, str) else None


def _text(number):
    if number is None:
        return None
    if number == 0:
        return "0"
    text = format(number, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _requirements_in_mm(characteristic):
    lower = _decimal(characteristic["lower"])
    upper = _decimal(characteristic["upper"])
    factor = _factor(characteristic["unit"])
    reasons = []
    if factor is None:
        reasons.append("invalid_requirement_unit")
    if lower is None or upper is None or lower > upper:
        reasons.append("invalid_limits")
    if reasons:
        return None, None, reasons
    return lower * factor, upper * factor, reasons


def _consider_row(row, lower, upper, result):
    reasons = result["reasons"]
    supplier_result = row["supplier_result"]
    if supplier_result and supplier_result.strip():
        result["supplier_result"] = supplier_result
    result["measured_value"] = row["value"]
    result["measured_unit"] = row["unit"]

    value = _decimal(row["value"])
    if value is None:
        reasons.append("invalid_measurement")
    factor = _factor(row["unit"])
    if factor is None:
        reasons.append("invalid_measurement_unit")
    if value is not None and factor is not None:
        value *= factor
        result["measured_mm"] = _text(value)

    if reasons:
        return
    if value < lower:
        reasons.append("below_lower_limit")
        result["deviation_mm"] = _text(lower - value)
        outcome = "out_of_tolerance"
    elif value > upper:
        reasons.append("above_upper_limit")
        result["deviation_mm"] = _text(value - upper)
        outcome = "out_of_tolerance"
    else:
        outcome = "in_tolerance"
    result["computed_result"] = outcome

    declared_outcome = SUPPLIER_OUTCOMES.get((supplier_result or "").strip().casefold())
    if declared_outcome is not None and declared_outcome != outcome:
        reasons.append("supplier_result_mismatch")


def _evaluate_characteristic(characteristic, paired_rows):
    lower, upper, limit_reasons = _requirements_in_mm(characteristic)
    for sample in characteristic["samples"]:
        sample_rows = paired_rows.get((characteristic["id"], sample), [])
        result = {
            "characteristic": characteristic["id"],
            "sample": sample,
            "drawing_ref": characteristic["drawing_ref"],
            "unit": characteristic["unit"],
            "lower": characteristic["lower"],
            "upper": characteristic["upper"],
            "measured_value": None,
            "measured_unit": None,
            "measured_mm": None,
            "deviation_mm": None,
            "supplier_result": None,
            "computed_result": "cannot_evaluate",
            "reasons": limit_reasons.copy(),
            "source_rows": [row["row"] for row in sample_rows],
        }
        if not sample_rows:
            result["computed_result"] = "missing"
            result["reasons"].append("missing_measurement")
        elif len(sample_rows) > 1:
            result["reasons"].append("duplicate_measurement")
        else:
            _consider_row(sample_rows[0], lower, upper, result)
        yield result


def evaluate(requirements: dict, rows: list[dict], *, supplier: str, lot: str) -> dict:
    """Return one result per required pair and diagnostics for unpaired rows."""
    required_samples = {
        item["id"]: set(item["samples"]) for item in requirements["characteristics"]
    }
    identities = {
        "part": requirements["part"],
        "revision": requirements["revision"],
        "lot": lot,
        "supplier": supplier,
    }
    paired_rows = defaultdict(list)
    unmatched_rows = []
    for row in rows:
        sample = row["sample"]
        characteristic = row["characteristic"]
        reasons = [
            f"{key}_mismatch" for key, expected in identities.items()
            if row[key] != expected and (key != "supplier" or row[key] is not None)
        ]
        if characteristic not in required_samples:
            reasons.append("unknown_characteristic")
        elif sample not in required_samples[characteristic]:
            reasons.append("unexpected_sample")

        if reasons:
            unmatched_rows.append({
                "row": row["row"],
                "characteristic": characteristic,
                "sample": sample,
                "reasons": reasons,
            })
        else:
            paired_rows[characteristic, sample].append(row)

    with localcontext(EXACT_CONTEXT):
        results = [
            result for characteristic in requirements["characteristics"]
            for result in _evaluate_characteristic(characteristic, paired_rows)
        ]
    return {"results": results, "unmatched_rows": unmatched_rows}
