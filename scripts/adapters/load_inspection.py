from adapters.column_mapper import ColumnMapper
from adapters.common import build_identifier, coerce_int, read_records
from adapters.evidence_refs import build_evidence_refs, warning_messages
from adapters.id_resolver import normalize_characteristic_ref, normalize_feature_ref
from adapters.location_normalizer import normalize_location_ref
from adapters.process_normalizer import normalize_inspection_status, normalize_process_ref, normalize_process_step
from adapters.unit_normalizer import normalize_length_fields


def _normalized_status(explicit_value, deviation, tol_plus, tol_minus):
    explicit = normalize_inspection_status(explicit_value)
    if explicit:
        return explicit
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
    diagnostics = []

    for index, row in enumerate(rows, start=1):
        mapper = ColumnMapper(row, index)
        row_unit = mapper.pick("units", ["units", "unit"], "mm")
        numeric_fields = normalize_length_fields({
            "nominal": mapper.pick("nominal", ["nominal", "target", "spec_nominal"]),
            "actual": mapper.pick("actual", ["actual", "measured", "measurement", "value"]),
            "tolerance_plus": mapper.pick("tolerance_plus", ["tolerance_plus", "upper_tol", "tol_plus", "usl"]),
            "tolerance_minus": mapper.pick("tolerance_minus", ["tolerance_minus", "lower_tol", "tol_minus", "lsl"]),
            "deviation": mapper.pick("deviation", ["deviation", "delta"]),
        }, row_unit=row_unit, row_index=index)
        numeric_values = numeric_fields["values"]
        nominal = numeric_values["nominal"]
        actual = numeric_values["actual"]
        tol_plus = numeric_values["tolerance_plus"]
        tol_minus = numeric_values["tolerance_minus"]
        deviation = numeric_values["deviation"]
        if deviation is None and nominal is not None and actual is not None:
            deviation = round(actual - nominal, 6)

        dimension_name = mapper.pick(
            "dimension_name",
            ["dimension_name", "characteristic", "feature", "measurement_name", "ctq"],
            f"inspection-{index:03d}",
        )
        record_id = build_identifier("insp", mapper.pick("record_id", ["record_id", "id", "measurement_id"]), index)
        characteristic_id = mapper.pick("characteristic_id", ["characteristic_id", "feature_id", "dimension_id"])
        feature_hint = mapper.pick("feature_hint", ["feature_hint", "feature_class", "region", "geometry_hint"])
        location_hint = mapper.pick("location_hint", ["location_hint", "location", "zone"])
        process_step = mapper.pick("process_step", ["process_step", "operation", "process"])
        explicit_status = mapper.pick("status", ["status", "result", "disposition"])

        record_diagnostics = list(mapper.diagnostics)
        record_diagnostics.extend(numeric_fields["diagnostics"])
        if actual is None and nominal is None:
            record_diagnostics.append({
                "code": "missing_numeric_values",
                "message": f"Inspection row {index} missing numeric values.",
                "severity": "warning",
                "row": index,
            })
        if not feature_hint:
            record_diagnostics.append({
                "code": "missing_feature_hint",
                "message": f"Inspection row {index} missing feature_hint.",
                "severity": "warning",
                "row": index,
                "field": "feature_hint",
            })
        if not location_hint:
            record_diagnostics.append({
                "code": "missing_location_hint",
                "message": f"Inspection row {index} missing location_hint.",
                "severity": "warning",
                "row": index,
                "field": "location_hint",
            })

        result = {
            "record_id": record_id,
            "characteristic_id": characteristic_id,
            "normalized_characteristic_ref": normalize_characteristic_ref(characteristic_id),
            "dimension_name": str(dimension_name),
            "nominal": nominal,
            "actual": actual,
            "tolerance_plus": tol_plus,
            "tolerance_minus": tol_minus,
            "deviation": deviation,
            "status": _normalized_status(explicit_status, deviation, tol_plus, tol_minus),
            "units": numeric_fields["canonical_unit"],
            "source_units": numeric_fields["source_units"],
            "feature_hint": feature_hint,
            "normalized_feature_ref": normalize_feature_ref(feature_hint),
            "location_hint": location_hint,
            "normalized_location_ref": normalize_location_ref(location_hint),
            "process_step": normalize_process_step(process_step) if process_step else None,
            "normalized_process_ref": normalize_process_ref(process_step),
            "sample_size": coerce_int(mapper.pick("sample_size", ["sample_size", "samples", "n"])),
            "source_row": index,
        }
        result.update(build_evidence_refs(
            path,
            index,
            row,
            mapper.field_map,
            record_diagnostics,
            [record_id, dimension_name, characteristic_id, feature_hint, location_hint, process_step, explicit_status],
        ))
        results.append(result)
        warnings.extend(warning_messages(record_diagnostics))
        diagnostics.extend(record_diagnostics)

    return results, warnings, diagnostics
