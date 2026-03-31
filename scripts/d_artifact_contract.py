from datetime import datetime, timezone


D_SCHEMA_VERSION = "1.0"
D_ANALYSIS_VERSION = "d1"


def now_iso(explicit_value=None):
    if isinstance(explicit_value, str) and explicit_value.strip():
        return explicit_value.strip()
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def unique_strings(values):
    seen = set()
    results = []
    for value in values or []:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        results.append(text)
    return results


def _coerce_non_negative_int(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return max(number, 0)


def build_coverage(**kwargs):
    coverage = {}
    for key, value in kwargs.items():
        number = _coerce_non_negative_int(value)
        if number is not None:
            coverage[key] = number
    return coverage


def build_confidence(level, score=None, rationale=None):
    return {
        "level": level,
        "score": score,
        "rationale": rationale,
    }


def summarize_part(part):
    part = part or {}
    return {
        "part_id": part.get("part_id"),
        "name": part.get("name") or "unknown_part",
        "description": part.get("description"),
        "revision": part.get("revision"),
        "material": part.get("material"),
        "process": part.get("process"),
    }


def _dedupe_source_refs(values):
    refs = []
    seen = set()

    for value in values or []:
        if not isinstance(value, dict):
            continue
        artifact_type = str(value.get("artifact_type") or "").strip()
        role = str(value.get("role") or "").strip()
        if not artifact_type or not role:
            continue

        ref = {
            "artifact_type": artifact_type,
            "path": value.get("path"),
            "role": role,
            "label": value.get("label"),
        }
        dedupe_key = (
            ref["artifact_type"],
            ref["path"],
            ref["role"],
            ref["label"],
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        refs.append(ref)

    return refs


def derive_source_artifact_refs(context=None, explicit_refs=None):
    context = context or {}
    metadata = context.get("metadata") or {}
    geometry_source = context.get("geometry_source") or {}

    refs = list(explicit_refs or [])
    if geometry_source.get("path"):
        refs.append({
            "artifact_type": "cad_model",
            "path": geometry_source.get("path"),
            "role": "input",
            "label": "Geometry source",
        })

    for source_file in metadata.get("source_files") or []:
        refs.append({
            "artifact_type": "source_file",
            "path": source_file,
            "role": "evidence",
            "label": "Context source file",
        })

    return _dedupe_source_refs(refs)


def build_contract_fields(
    payload,
    artifact_type,
    part=None,
    coverage=None,
    confidence=None,
    warnings=None,
    source_artifact_refs=None,
    generated_at=None,
):
    context = (payload or {}).get("context") or {}
    metadata = context.get("metadata") or {}
    part_summary = summarize_part(part or context.get("part") or {})
    resolved_source_refs = derive_source_artifact_refs(context, source_artifact_refs)
    resolved_coverage = dict(coverage or {})
    resolved_coverage["source_artifact_count"] = max(
        _coerce_non_negative_int(resolved_coverage.get("source_artifact_count")) or 0,
        len(resolved_source_refs),
    )
    resolved_coverage["source_file_count"] = max(
        _coerce_non_negative_int(resolved_coverage.get("source_file_count")) or 0,
        len(metadata.get("source_files") or []),
    )

    return {
        "artifact_type": artifact_type,
        "schema_version": D_SCHEMA_VERSION,
        "analysis_version": D_ANALYSIS_VERSION,
        "generated_at": now_iso(generated_at or (payload or {}).get("generated_at")),
        "part_id": part_summary.get("part_id"),
        "revision": part_summary.get("revision"),
        "warnings": unique_strings([*(metadata.get("warnings") or []), *(warnings or [])]),
        "coverage": resolved_coverage,
        "confidence": confidence or build_confidence("medium"),
        "source_artifact_refs": resolved_source_refs,
    }
