def build_review_priorities(ranked_scores, inspection_linkage, quality_linkage):
    priorities = []
    for index, item in enumerate(ranked_scores[:5], start=1):
        priorities.append({
            "priority_rank": index,
            "hotspot_id": item.get("hotspot_id"),
            "category": item.get("category"),
            "hotspot_title": item.get("title"),
            "score": item.get("score"),
            "title": f"Review {item.get('title')}",
            "evidence_count": len(item.get("evidence_refs") or []),
            "score_breakdown": item.get("score_breakdown") or {},
            "confidence": item.get("confidence"),
            "ambiguity": item.get("ambiguity") or {},
            "related_inspection_records": (item.get("linked_inspection_records") or [])[:5],
            "related_quality_issues": (item.get("linked_quality_issues") or [])[:5],
            "evidence_refs": item.get("evidence_refs") or [],
            "rationale": item.get("why") or f"Combined geometry, inspection, and quality evidence elevated {item.get('category')}.",
        })
    return priorities
