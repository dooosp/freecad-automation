#!/usr/bin/env python3

from _bootstrap import read_input, respond, respond_error
from d_artifact_contract import build_confidence, build_contract_fields, build_coverage, summarize_part
from geometry.feature_extract import extract_geometry_features
from geometry.hotspot_detector import detect_hotspots
from geometry.shape_metrics import compute_shape_metrics


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
        model_metadata = _resolve_model_metadata(payload)
        if not model_metadata:
            raise ValueError("model_metadata is required for analyze_part.py")

        feature_hints = _resolve_feature_hints(payload)
        metrics = compute_shape_metrics(model_metadata)
        features = extract_geometry_features(model_metadata, feature_hints, metrics)
        hotspots = detect_hotspots(metrics, features)
        part = summarize_part(_resolve_part(payload))
        metadata = ((payload.get("context") or {}).get("metadata") or {})
        generated_at = payload.get("generated_at")
        source_refs = payload.get("source_artifact_refs") or []

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
                    "heuristic",
                    0.66,
                    "Derived from model metadata and feature hints without exact CAD feature interrogation.",
                ),
                source_artifact_refs=source_refs,
                generated_at=generated_at,
            ),
            "part": part,
            "geometry_source": (payload.get("context") or {}).get("geometry_source") or payload.get("geometry_source") or {},
            "metrics": metrics,
            "features": features,
            "analysis_confidence": "heuristic",
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
                        "heuristic",
                        0.62,
                        "Hotspot scores are rule-based derivatives of geometry metrics and inferred features.",
                    ),
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
