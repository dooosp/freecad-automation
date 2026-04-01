from linkage.match_utils import dedupe


def _average(values, default=0.0):
    if not values:
        return default
    return sum(values) / len(values)


def _inspection_signal(record):
    if (record.get("status") or "").lower() != "out_of_tolerance":
        return 0.0
    deviation = abs(record.get("deviation") or 0.0)
    return min(1.5, 0.25 + deviation)


def _quality_signal(record):
    return min(2.0, (record.get("severity_score") or 0.0) * max(record.get("confidence") or 0.0, 0.35))


def _data_quality_penalty(inspection_records, quality_records):
    penalty = 0.0
    for record in inspection_records:
        if not record.get("feature_hint"):
            penalty += 0.05
        if not record.get("location_hint"):
            penalty += 0.05
    for record in quality_records:
        if not record.get("likely_feature_class") or record.get("likely_feature_class") == "unknown":
            penalty += 0.05
        if not record.get("process_step"):
            penalty += 0.05
    return round(min(0.6, penalty), 3)


def _ambiguity_penalty(inspection_records, quality_records):
    ambiguous = sum(1 for record in inspection_records if (record.get("ambiguity") or {}).get("is_ambiguous"))
    ambiguous += sum(1 for record in quality_records if (record.get("ambiguity") or {}).get("is_ambiguous"))
    return round(min(0.6, ambiguous * 0.12), 3)


def score_review_risks(hotspots, inspection_linkage, inspection_outliers, quality_linkage, quality_hotspots):
    inspection_records = (inspection_linkage or {}).get("records") or []
    quality_records = (quality_linkage or {}).get("records") or []
    inspection_outlier_records = (
        (inspection_outliers or {}).get("records") or []
        if isinstance(inspection_outliers, dict)
        else (inspection_outliers or [])
    )
    quality_hotspot_records = {
        item.get("hotspot_id"): item
        for item in ((quality_hotspots or {}).get("records") or [])
    }
    outlier_ids = {item.get("record_id") for item in inspection_outlier_records}

    scored = []
    for hotspot in hotspots or []:
        hotspot_id = hotspot.get("hotspot_id")
        related_inspection = [
            record for record in inspection_records
            if hotspot_id in (record.get("linked_hotspot_ids") or [])
        ]
        related_quality = [
            record for record in quality_records
            if hotspot_id in (record.get("linked_hotspot_ids") or [])
        ]

        geometry_evidence_score = round(hotspot.get("score", 0.0), 3)
        inspection_anomaly_score = round(sum(
            _inspection_signal(record)
            for record in related_inspection
            if record.get("record_id") in outlier_ids or (record.get("status") or "").lower() == "out_of_tolerance"
        ), 3)
        quality_recurrence_score = round(sum(_quality_signal(record) for record in related_quality), 3)
        process_sensitivity_score = round(sum(
            match.get("component_scores", {}).get("process_step_match", 0.0)
            for record in related_quality
            for match in (record.get("matched_hotspots") or [])
            if match.get("hotspot_id") == hotspot_id
        ), 3)
        if hotspot_id in quality_hotspot_records:
            process_sensitivity_score = round(max(
                process_sensitivity_score,
                min(1.0, (quality_hotspot_records[hotspot_id].get("occurrence_count") or 0) * 0.15),
            ), 3)

        data_quality_penalty = _data_quality_penalty(related_inspection, related_quality)
        ambiguity_penalty = _ambiguity_penalty(related_inspection, related_quality)
        total_score = round(max(
            0.0,
            geometry_evidence_score
            + inspection_anomaly_score
            + quality_recurrence_score
            + process_sensitivity_score
            - data_quality_penalty
            - ambiguity_penalty,
        ), 3)

        evidence_refs = dedupe(
            [{"source_type": "geometry_hotspot", "source_id": hotspot_id}]
            + [
                ref
                for record in (related_inspection + related_quality)
                for ref in (record.get("evidence_refs") or [])
            ]
        )
        confidence = round(max(
            0.2,
            min(
                0.99,
                (hotspot.get("score", 0.0) * 0.35)
                + (_average([record.get("confidence", 0.0) for record in related_inspection + related_quality], default=0.25) * 0.65)
                - (ambiguity_penalty * 0.2),
            ),
        ), 3)

        scored.append({
            "hotspot_id": hotspot_id,
            "category": hotspot.get("category"),
            "title": hotspot.get("title"),
            "severity": hotspot.get("severity"),
            "score": total_score,
            "score_breakdown": {
                "geometry_evidence_score": geometry_evidence_score,
                "inspection_anomaly_score": inspection_anomaly_score,
                "quality_recurrence_score": quality_recurrence_score,
                "process_sensitivity_score": process_sensitivity_score,
                "data_quality_penalty": data_quality_penalty,
                "ambiguity_penalty": ambiguity_penalty,
            },
            "linked_inspection_records": [record.get("record_id") for record in related_inspection],
            "linked_quality_issues": [record.get("issue_id") for record in related_quality],
            "evidence_refs": evidence_refs,
            "confidence": confidence,
            "ambiguity": {
                "inspection_records": sum(1 for record in related_inspection if (record.get("ambiguity") or {}).get("is_ambiguous")),
                "quality_records": sum(1 for record in related_quality if (record.get("ambiguity") or {}).get("is_ambiguous")),
            },
            "why": (
                f"{hotspot.get('title')} carries geometry evidence plus "
                f"{len(related_inspection)} inspection and {len(related_quality)} quality link(s)."
            ),
        })

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored
