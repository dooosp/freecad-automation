from collections import defaultdict

from linkage.feature_matcher import infer_feature_refs, match_feature_refs
from linkage.hotspot_catalog import build_evidence_ref
from linkage.location_matcher import match_location
from linkage.match_utils import dedupe, lexical_match, select_top_matches, summarize_match_type
from linkage.process_matcher import match_process
from linkage.quality_patterns import infer_quality_pattern


def _score_hotspot_match(issue, pattern, hotspot, default_process):
    lexical = lexical_match(
        [
            issue.get("description"),
            issue.get("defect_code"),
            issue.get("defect_class"),
            issue.get("feature_hint"),
            issue.get("location_hint"),
        ],
        hotspot,
    )
    if pattern.get("category") and pattern.get("category") == hotspot.get("category"):
        lexical["score"] = max(lexical.get("score", 0.0), 0.9)
        lexical["matched_tokens"] = dedupe((lexical.get("matched_tokens") or []) + [pattern.get("category")])

    feature_refs = infer_feature_refs(
        issue.get("feature_hint"),
        pattern.get("feature_class"),
        issue.get("description"),
    )
    feature = match_feature_refs(feature_refs, hotspot)
    location = match_location(issue.get("location_hint"), hotspot)
    process = match_process(issue.get("process_step"), hotspot, default_process=default_process)

    total_score = (
        (lexical.get("score", 0) * 0.35)
        + (feature.get("score", 0) * 0.25)
        + (location.get("score", 0) * 0.15)
        + (process.get("score", 0) * 0.25)
    )
    reason_codes = []
    if lexical.get("matched_tokens"):
        reason_codes.append("lexical_match")
    if feature.get("matched_feature_refs"):
        reason_codes.append("feature_class_match")
    if location.get("matched_tokens"):
        reason_codes.append("location_match")
    if process.get("matched_process_steps"):
        reason_codes.append("process_step_match")

    return {
        "hotspot_id": hotspot.get("hotspot_id"),
        "category": hotspot.get("category"),
        "title": hotspot.get("title"),
        "total_score": round(total_score, 3),
        "reason_codes": reason_codes,
        "matched_feature_refs": feature.get("matched_feature_refs") or [],
        "matched_process_steps": process.get("matched_process_steps") or [],
        "component_scores": {
            "lexical_match": lexical.get("score", 0.0),
            "feature_class_match": feature.get("score", 0.0),
            "location_match": location.get("score", 0.0),
            "process_step_match": process.get("score", 0.0),
        },
    }


def map_quality_issues(context, hotspots):
    issues = (context or {}).get("quality_issues") or []
    default_process = (
        ((context or {}).get("part") or {}).get("process")
        or ((context or {}).get("manufacturing_context") or {}).get("process_family")
    )

    linkage_records = []
    hotspot_scores = defaultdict(lambda: {
        "hotspot_id": None,
        "category": None,
        "title": None,
        "score": 0.0,
        "issue_count": 0,
        "occurrence_count": 0,
        "confidence": [],
        "evidence_refs": [],
    })

    for issue in issues:
        pattern = infer_quality_pattern(issue)
        candidate_matches = [
            _score_hotspot_match(issue, pattern, hotspot, default_process)
            for hotspot in hotspots or []
        ]
        selected, ambiguity = select_top_matches(candidate_matches, threshold=0.40, ambiguity_delta=0.08)
        linked_hotspot_ids = [match.get("hotspot_id") for match in selected]
        linked_feature_refs = dedupe([
            ref
            for match in selected
            for ref in (match.get("matched_feature_refs") or [])
        ])
        reason_codes = dedupe([
            code
            for match in selected
            for code in (match.get("reason_codes") or [])
        ])
        top_score = selected[0].get("total_score", 0.0) if selected else 0.0
        confidence = max(0.15, top_score - (0.08 * max(len(selected) - 1, 0))) if selected else 0.15
        recurrence_score = pattern.get("severity_score", 0.35) * max(issue.get("occurrence_count") or 1, 1)
        evidence_ref = build_evidence_ref("quality_issue", issue, "issue_id")

        for match in selected:
            aggregate = hotspot_scores[match.get("hotspot_id")]
            aggregate["hotspot_id"] = match.get("hotspot_id")
            aggregate["category"] = match.get("category")
            aggregate["title"] = match.get("title")
            aggregate["score"] += recurrence_score * max(match.get("total_score", 0.0), 0.35)
            aggregate["issue_count"] += 1
            aggregate["occurrence_count"] += max(issue.get("occurrence_count") or 1, 1)
            aggregate["confidence"].append(confidence)
            aggregate["evidence_refs"].append(evidence_ref)

        linkage_records.append({
            "issue_id": issue.get("issue_id"),
            "description": issue.get("description"),
            "defect_code": issue.get("defect_code"),
            "likely_feature_class": pattern.get("feature_class"),
            "linked_hotspot_category": selected[0].get("category") if selected else pattern.get("category"),
            "linked_to_geometry": bool(selected),
            "linked_hotspot_ids": linked_hotspot_ids,
            "linked_feature_refs": linked_feature_refs,
            "match_type": summarize_match_type(reason_codes),
            "occurrence_count": issue.get("occurrence_count"),
            "severity_score": round(recurrence_score, 3),
            "confidence": round(confidence, 3),
            "reason_codes": reason_codes,
            "ambiguity": ambiguity,
            "evidence_refs": [evidence_ref],
            "process_step": issue.get("process_step"),
            "matched_hotspots": [
                {
                    "hotspot_id": match.get("hotspot_id"),
                    "category": match.get("category"),
                    "title": match.get("title"),
                    "score": match.get("total_score"),
                    "component_scores": match.get("component_scores"),
                }
                for match in selected
            ],
            "rationale": (
                f"Matched quality token '{pattern.get('matched_token')}' across lexical, feature, location, or process dimensions."
                if selected and pattern.get("matched_token")
                else "No hotspot cleared the quality linkage threshold."
            ),
        })

    ranked_hotspots = [
        {
            "hotspot_id": hotspot_id,
            "category": payload.get("category"),
            "title": payload.get("title"),
            "score": round(payload.get("score", 0.0), 3),
            "issue_count": payload.get("issue_count"),
            "occurrence_count": payload.get("occurrence_count"),
            "confidence": round(sum(payload.get("confidence") or [0.0]) / max(len(payload.get("confidence") or []), 1), 3),
            "evidence_refs": dedupe(payload.get("evidence_refs") or []),
        }
        for hotspot_id, payload in hotspot_scores.items()
        if hotspot_id
    ]
    ranked_hotspots.sort(key=lambda item: item["score"], reverse=True)

    matched_count = sum(1 for record in linkage_records if record.get("linked_hotspot_ids"))
    ambiguous_count = sum(1 for record in linkage_records if (record.get("ambiguity") or {}).get("is_ambiguous"))

    return {
        "summary": {
            "issue_count": len(issues),
            "matched_categories": len(ranked_hotspots),
            "matched_issue_count": matched_count,
            "ambiguous_issue_count": ambiguous_count,
        },
        "records": linkage_records,
    }, {
        "summary": {
            "matched_hotspot_count": len(ranked_hotspots),
        },
        "records": ranked_hotspots,
    }
