from adapters.common import build_identifier, coerce_float, coerce_int, pick_first, read_records


def _normalized_status(row, deviation, tol_plus, tol_minus):
    explicit = pick_first(row, ["status", "result", "disposition"])
    if explicit:
        return explicit.lower()
    if deviation is None:
        return "unknown"
    upper = tol_plus if tol_plus is not None else 0.0
    lower = tol_minus if tol_minus is not None else -upper
    if deviation > upper or deviation < lower:
        return "out_of_tolerance"
    return "in_tolerance"


def load_inspection_results(path):
    rows = read_records(path)
    results = []
    warnings = []

    for index, row in enumerate(rows, start=1):
        nominal = coerce_float(pick_first(row, ["nominal", "target", "spec_nominal"]))
        actual = coerce_float(pick_first(row, ["actual", "measured", "measurement", "value"]))
        tol_plus = coerce_float(pick_first(row, ["tolerance_plus", "upper_tol", "tol_plus", "usl"]))
        tol_minus = coerce_float(pick_first(row, ["tolerance_minus", "lower_tol", "tol_minus", "lsl"]))
        deviation = coerce_float(pick_first(row, ["deviation", "delta"]))
        if deviation is None and nominal is not None and actual is not None:
            deviation = round(actual - nominal, 6)

        dimension_name = pick_first(
            row,
            ["dimension_name", "characteristic", "feature", "measurement_name", "ctq"],
            f"inspection-{index:03d}",
        )

        result = {
            "record_id": build_identifier("insp", pick_first(row, ["record_id", "id", "measurement_id"]), index),
            "characteristic_id": pick_first(row, ["characteristic_id", "feature_id", "dimension_id"]),
            "dimension_name": str(dimension_name),
            "nominal": nominal,
            "actual": actual,
            "tolerance_plus": tol_plus,
            "tolerance_minus": tol_minus,
            "deviation": deviation,
            "status": _normalized_status(row, deviation, tol_plus, tol_minus),
            "units": pick_first(row, ["units", "unit"], "mm"),
            "feature_hint": pick_first(row, ["feature_hint", "feature_class", "region", "geometry_hint"]),
            "location_hint": pick_first(row, ["location_hint", "location", "zone"]),
            "sample_size": coerce_int(pick_first(row, ["sample_size", "samples", "n"])),
            "source_row": index,
        }
        if result["actual"] is None and result["nominal"] is None:
            warnings.append(f"Inspection row {index} missing numeric values")
        results.append(result)

    return results, warnings
