def build_review_priorities(ranked_scores, inspection_linkage, quality_linkage):
    priorities = []
    inspection_records = (inspection_linkage or {}).get("records") or []
    quality_records = (quality_linkage or {}).get("records") or []

    for index, item in enumerate(ranked_scores[:5], start=1):
        category = item.get("category")
        related_inspection = [record for record in inspection_records if category in (record.get("matched_categories") or [])]
        related_quality = [record for record in quality_records if record.get("linked_hotspot_category") == category]
        priorities.append({
            "priority_rank": index,
            "category": category,
            "score": item.get("score"),
            "title": f"Review {category.replace('_', ' ')}",
            "evidence_count": len(item.get("evidence") or []),
            "related_inspection_records": [record.get("record_id") for record in related_inspection[:5]],
            "related_quality_issues": [record.get("issue_id") for record in related_quality[:5]],
            "rationale": f"Combined geometry, inspection, and quality evidence elevated {category}.",
        })
    return priorities
