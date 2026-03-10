#!/usr/bin/env python3

from _bootstrap import read_input, respond, respond_error
from decision.recommend_actions import recommend_actions
from decision.review_prioritizer import build_review_priorities
from decision.risk_scorer import score_review_risks
from linkage.map_inspection import map_inspection_results
from linkage.map_quality import map_quality_issues


def main():
    try:
        payload = read_input()
        context = payload.get("context") or {}
        geometry_intelligence = payload.get("geometry_intelligence") or {}
        hotspot_payload = payload.get("manufacturing_hotspots") or {}

        inspection_linkage, inspection_outliers = map_inspection_results(context, geometry_intelligence, hotspot_payload)
        quality_linkage, quality_hotspots = map_quality_issues(context, hotspot_payload)
        ranked_scores = score_review_risks(
            hotspot_payload.get("hotspots") or [],
            inspection_outliers,
            quality_hotspots,
        )
        review_priorities = build_review_priorities(ranked_scores, inspection_linkage, quality_linkage)
        actions = recommend_actions(review_priorities)

        respond({
            "success": True,
            "inspection_linkage": inspection_linkage,
            "inspection_outliers": {
                "records": inspection_outliers,
            },
            "quality_linkage": quality_linkage,
            "quality_hotspots": {
                "records": quality_hotspots,
            },
            "review_priorities": {
                "records": review_priorities,
                "recommended_actions": actions,
            },
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
