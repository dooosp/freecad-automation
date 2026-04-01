#!/usr/bin/env python3

from _bootstrap import read_input, respond, respond_error
from d_artifact_contract import build_confidence, build_contract_fields, build_coverage, summarize_part
from geometry.entity_index import build_entity_index
from geometry.feature_extract import extract_geometry_features
from geometry.hotspot_detector import detect_hotspots
from geometry.shape_metrics import build_geometry_facts, compute_shape_metrics


def _resolve_part(payload):
    context = payload.get("context") or {}
    return context.get("part") or payload.get("part") or {"name": "unknown_part"}


def _resolve_model_metadata(payload):
    context = payload.get("context") or {}
    geometry_source = context.get("geometry_source") or {}
    return (
        payload.get("model_metadata")
        or geometry_source.get("model_metadata")
        or {}
    )


def _resolve_feature_hints(payload):
    context = payload.get("context") or {}
    geometry_source = context.get("geometry_source") or {}
    return (
        payload.get("feature_hints")
        or geometry_source.get("feature_hints")
        or {}
    )


def _normalize_vector(values, fallback=None):
    fallback = list(fallback or [0, 0, 0])
    items = list(values or [])
    while len(items) < 3:
        items.append(fallback[len(items)])
    return [float(items[index] or 0) for index in range(3)]


def _build_metadata_only_fallback(payload):
    fallback = payload.get("fallback_model_metadata") or {}
    bbox = fallback.get("bounding_box") or {}
    size = _normalize_vector(bbox.get("size"))
    bbox_min = _normalize_vector(bbox.get("min"))
    bbox_max = _normalize_vector(bbox.get("max"), fallback=size)
    return {
        "volume": float(fallback.get("volume") or 0),
        "area": float(fallback.get("area") or 0),
        "faces": int(fallback.get("faces") or 0),
        "edges": int(fallback.get("edges") or 0),
        "vertices": int(fallback.get("vertices") or 0),
        "bounding_box": {
            "min": bbox_min,
            "max": bbox_max,
            "size": size,
        },
    }


def _resolve_warnings(payload):
    context = payload.get("context") or {}
    metadata = context.get("metadata") or {}
    warnings = list(metadata.get("warnings") or [])
    warnings.extend(payload.get("warnings") or [])

    seen = set()
    result = []
    for warning in warnings:
        if not isinstance(warning, str):
            continue
        text = warning.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def main():
    try:
        payload = read_input()
        context = payload.get("context") or {}
        model_metadata = _resolve_model_metadata(payload)
        warnings = _resolve_warnings(payload)
        runtime_diagnostics = payload.get("runtime_diagnostics") or []
        used_metadata_only_fallback = bool(payload.get("used_metadata_only_fallback"))

        if not model_metadata and payload.get("allow_metadata_only_fallback"):
            model_metadata = _build_metadata_only_fallback(payload)
            used_metadata_only_fallback = True

        if used_metadata_only_fallback:
            warnings.append("Shape-derived metrics were unavailable; geometry analysis used metadata-only fallback values.")

        if not model_metadata:
            raise ValueError("model_metadata is required for analyze_part.py")

        feature_hints = _resolve_feature_hints(payload)
        metrics = compute_shape_metrics(model_metadata)
        metadata = ((payload.get("context") or {}).get("metadata") or {})
        generated_at = payload.get("generated_at")
        source_refs = payload.get("source_artifact_refs") or []
        incoming_geometry_source = context.get("geometry_source") or payload.get("geometry_source") or {}
        analysis_mode = (
            "metadata_only_fallback"
            if used_metadata_only_fallback
            else incoming_geometry_source.get("analysis_mode") or "model_metadata"
        )
        entity_index = build_entity_index(feature_hints, context)
        geometry_facts = build_geometry_facts(model_metadata, feature_hints, context)
        features = extract_geometry_features(
            model_metadata,
            feature_hints,
            metrics,
            geometry_facts=geometry_facts,
            entity_index=entity_index,
            context=context,
        )
        hotspots = detect_hotspots(metrics, features, geometry_facts=geometry_facts)
        part = summarize_part(_resolve_part(payload))

        geometry_intelligence = {
            **build_contract_fields(
                payload,
                "geometry_intelligence",
                part=part,
                coverage=build_coverage(
                    source_artifact_count=len(source_refs),
                    source_file_count=len(metadata.get("source_files") or []),
                ),
                confidence=build_confidence(
                    "low" if used_metadata_only_fallback else "heuristic",
                    0.28 if used_metadata_only_fallback else 0.66,
                    "Derived from metadata-only fallback values after runtime-backed shape inspection could not produce usable geometry metrics."
                    if used_metadata_only_fallback
                    else "Derived from model metadata and feature hints without exact CAD feature interrogation.",
                ),
                warnings=warnings,
                source_artifact_refs=source_refs,
                generated_at=generated_at,
            ),
            "part": part,
            "geometry_source": {
                **incoming_geometry_source,
                "model_metadata": model_metadata,
                "feature_hints": feature_hints,
                "runtime_diagnostics": runtime_diagnostics,
                "analysis_mode": analysis_mode,
            },
            "metrics": metrics,
            "features": features,
            "geometry_facts": geometry_facts,
            "derived_features": features.get("records") or [],
            "entity_index": entity_index,
            "analysis_confidence": "low" if used_metadata_only_fallback else "heuristic",
        }

        respond({
            "success": True,
            "geometry_intelligence": geometry_intelligence,
            "manufacturing_hotspots": {
                **build_contract_fields(
                    payload,
                    "manufacturing_hotspots",
                    part=part,
                    coverage=build_coverage(
                        source_artifact_count=len(source_refs),
                        source_file_count=len(metadata.get("source_files") or []),
                        hotspot_count=len(hotspots),
                    ),
                    confidence=build_confidence(
                        "low" if used_metadata_only_fallback else "heuristic",
                        0.24 if used_metadata_only_fallback else 0.62,
                        "Hotspot scores are bounded by metadata-only fallback geometry and should be treated as coarse review guidance."
                        if used_metadata_only_fallback
                        else "Hotspot scores are rule-based derivatives of geometry metrics and inferred features.",
                    ),
                    warnings=warnings,
                    source_artifact_refs=source_refs,
                    generated_at=generated_at,
                ),
                "part": part,
                "hotspots": hotspots,
            },
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
