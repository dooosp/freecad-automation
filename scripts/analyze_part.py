#!/usr/bin/env python3

from _bootstrap import read_input, respond, respond_error
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


def main():
    try:
        payload = read_input()
        context = payload.get("context") or {}
        model_metadata = _resolve_model_metadata(payload)
        if not model_metadata:
            raise ValueError("model_metadata is required for analyze_part.py")

        feature_hints = _resolve_feature_hints(payload)
        metrics = compute_shape_metrics(model_metadata)
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
        part = _resolve_part(payload)

        geometry_intelligence = {
            "part": part,
            "geometry_source": context.get("geometry_source") or payload.get("geometry_source") or {},
            "metrics": metrics,
            "features": features,
            "geometry_facts": geometry_facts,
            "derived_features": features.get("records") or [],
            "entity_index": entity_index,
            "analysis_confidence": "heuristic",
        }

        respond({
            "success": True,
            "geometry_intelligence": geometry_intelligence,
            "manufacturing_hotspots": {
                "part": part,
                "hotspots": hotspots,
            },
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
