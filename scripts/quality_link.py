#!/usr/bin/env python3

from _bootstrap import read_input, respond, respond_error
from d_artifact_contract import build_confidence, build_contract_fields, build_coverage, summarize_part
from decision.recommend_actions import recommend_actions
from decision.review_prioritizer import build_review_priorities
from decision.risk_scorer import score_review_risks
from linkage.hotspot_catalog import build_hotspot_catalog
from linkage.map_inspection import map_inspection_results
from linkage.map_quality import map_quality_issues


def main():
    try:
        payload = read_input()
        context = payload.get("context") or {}
        geometry_intelligence = payload.get("geometry_intelligence") or {}
        hotspot_payload = payload.get("manufacturing_hotspots") or {}
        hotspots = build_hotspot_catalog(hotspot_payload, context=context)

        inspection_linkage, inspection_outliers = map_inspection_results(context, geometry_intelligence, hotspots)
        quality_linkage, quality_hotspots = map_quality_issues(context, hotspots)
        ranked_scores = score_review_risks(
            hotspots,
            inspection_linkage,
            inspection_outliers,
            quality_linkage,
            quality_hotspots,
        )
        review_priorities = build_review_priorities(ranked_scores, inspection_linkage, quality_linkage)
        actions = recommend_actions(review_priorities)
        part = summarize_part((context or {}).get("part") or {})
        metadata = (context or {}).get("metadata") or {}
        generated_at = payload.get("generated_at")
        source_refs = payload.get("source_artifact_refs") or []

        respond({
            "success": True,
            "inspection_linkage": {
                **build_contract_fields(
                    payload,
                    "inspection_linkage",
                    part=part,
                    coverage=build_coverage(
                        source_artifact_count=len(source_refs),
                        source_file_count=len(metadata.get("source_files") or []),
                        hotspot_count=len(hotspots),
                        inspection_record_count=len(inspection_linkage.get("records") or []),
                        inspection_outlier_count=len(inspection_outliers),
                    ),
                    confidence=build_confidence(
                        "heuristic",
                        0.68,
                        "Inspection linkage uses deterministic token matching against geometry-derived categories.",
                    ),
                    source_artifact_refs=source_refs,
                    generated_at=generated_at,
                ),
                **inspection_linkage,
            },
            "inspection_outliers": {
                "records": inspection_outliers,
            },
            "quality_linkage": {
                **build_contract_fields(
                    payload,
                    "quality_linkage",
                    part=part,
                    coverage=build_coverage(
                        source_artifact_count=len(source_refs),
                        source_file_count=len(metadata.get("source_files") or []),
                        hotspot_count=len(hotspots),
                        quality_issue_count=len(quality_linkage.get("records") or []),
                        quality_hotspot_count=len((quality_hotspots.get("records") or [])),
                    ),
                    confidence=build_confidence(
                        "heuristic",
                        0.7,
                        "Quality linkage maps recurring issue patterns to hotspot categories using explicit rules.",
                    ),
                    source_artifact_refs=source_refs,
                    generated_at=generated_at,
                ),
                **quality_linkage,
            },
            "quality_hotspots": quality_hotspots,
            "review_priorities": {
                **build_contract_fields(
                    payload,
                    "review_priorities",
                    part=part,
                    coverage=build_coverage(
                        source_artifact_count=len(source_refs),
                        source_file_count=len(metadata.get("source_files") or []),
                        hotspot_count=len(hotspots),
                        inspection_record_count=len(inspection_linkage.get("records") or []),
                        quality_issue_count=len(quality_linkage.get("records") or []),
                        review_priority_count=len(review_priorities),
                    ),
                    confidence=build_confidence(
                        "heuristic",
                        0.72,
                        "Priority ranking combines geometry, inspection, and quality evidence through auditable scoring rules.",
                    ),
                    source_artifact_refs=source_refs,
                    generated_at=generated_at,
                ),
                "records": review_priorities,
                "recommended_actions": actions,
            },
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
