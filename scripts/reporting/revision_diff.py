#!/usr/bin/env python3

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SCRIPT_DIR)
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

from _bootstrap import read_input, respond, respond_error


def _safe_list(value):
    return value if isinstance(value, list) else []


def _round_number(value, digits=3):
    if isinstance(value, (int, float)):
        return round(value, digits)
    return value


def _diff_numbers(before, after):
    if not isinstance(before, (int, float)) or not isinstance(after, (int, float)):
        return None
    return {
        "before": before,
        "after": after,
        "delta": _round_number(after - before, 6),
    }


def _extract_report(document):
    summary = document.get("summary") or document
    geometry_summary = (
        summary.get("geometry_summary")
        or document.get("geometry_summary")
        or document.get("metrics")
        or ((document.get("geometry_intelligence") or {}).get("metrics"))
        or (((document.get("geometry_source") or {}).get("model_metadata")) or {})
    )
    prioritized_hotspots = _safe_list(summary.get("prioritized_hotspots")) or _safe_list(summary.get("review_priorities"))
    geometry_hotspots = _safe_list(summary.get("geometry_hotspots")) or _safe_list(((document.get("manufacturing_hotspots") or {}).get("hotspots")))
    quality_hotspots = _safe_list(summary.get("quality_hotspots")) or _safe_list(((document.get("quality_hotspots") or {}).get("records")))
    evidence_ledger = summary.get("evidence_ledger") or document.get("evidence_ledger") or {"records": []}
    actions = _safe_list(summary.get("recommended_actions")) or _safe_list((document.get("review_priorities") or {}).get("recommended_actions"))
    uncertainty = summary.get("uncertainty_coverage_report") or document.get("uncertainty_coverage_report") or {}

    return {
        "part": summary.get("part") or document.get("part") or {},
        "geometry_summary": geometry_summary,
        "prioritized_hotspots": prioritized_hotspots,
        "geometry_hotspots": geometry_hotspots,
        "quality_hotspots": quality_hotspots,
        "evidence_ledger": evidence_ledger,
        "recommended_actions": actions,
        "uncertainty_coverage_report": uncertainty,
        "metadata": summary.get("metadata") or document.get("metadata") or {},
    }


def _hotspot_index(report):
    items = {}

    for priority in report.get("prioritized_hotspots") or []:
        category = priority.get("category")
        if not category:
            continue
        items.setdefault(category, {
            "category": category,
            "title": priority.get("title"),
            "priority_rank": priority.get("priority_rank"),
            "score": priority.get("score"),
            "geometry_hotspot_titles": [],
            "inspection_record_ids": [],
            "quality_issue_ids": [],
            "recommended_action": priority.get("recommended_action"),
        })
        items[category]["geometry_hotspot_titles"] = priority.get("geometry_hotspot_titles") or items[category]["geometry_hotspot_titles"]
        items[category]["inspection_record_ids"] = priority.get("inspection_record_ids") or items[category]["inspection_record_ids"]
        items[category]["quality_issue_ids"] = priority.get("quality_issue_ids") or items[category]["quality_issue_ids"]
        items[category]["recommended_action"] = priority.get("recommended_action") or items[category]["recommended_action"]

    for hotspot in report.get("geometry_hotspots") or []:
        category = hotspot.get("category")
        if not category:
            continue
        items.setdefault(category, {
            "category": category,
            "title": hotspot.get("title"),
            "priority_rank": None,
            "score": hotspot.get("score"),
            "geometry_hotspot_titles": [],
            "inspection_record_ids": [],
            "quality_issue_ids": [],
            "recommended_action": None,
        })
        if hotspot.get("title") and hotspot.get("title") not in items[category]["geometry_hotspot_titles"]:
            items[category]["geometry_hotspot_titles"].append(hotspot.get("title"))
        if items[category].get("score") is None:
            items[category]["score"] = hotspot.get("score")

    for hotspot in report.get("quality_hotspots") or []:
        category = hotspot.get("category")
        if not category:
            continue
        items.setdefault(category, {
            "category": category,
            "title": hotspot.get("category"),
            "priority_rank": None,
            "score": hotspot.get("score"),
            "geometry_hotspot_titles": [],
            "inspection_record_ids": [],
            "quality_issue_ids": [],
            "recommended_action": None,
        })
        if items[category].get("score") is None:
            items[category]["score"] = hotspot.get("score")

    return items


def _evidence_index(report):
    records = _safe_list((report.get("evidence_ledger") or {}).get("records"))
    if records:
        return {
            item.get("evidence_id"): item
            for item in records
            if item.get("evidence_id")
        }

    fallback = {}
    for hotspot in report.get("geometry_hotspots") or []:
        category = hotspot.get("category") or "uncategorized"
        title = hotspot.get("title") or "untitled"
        key = f"geometry:{category}:{title.lower().replace(' ', '_')}"
        fallback[key] = {
            "evidence_id": key,
            "type": "geometry_hotspot",
            "category": category,
            "title": title,
        }
    return fallback


def _action_index(report):
    items = {}
    for action in report.get("recommended_actions") or []:
        category = action.get("category") or action.get("based_on") or action.get("recommended_action")
        if not category:
            continue
        items[category] = action
    return items


def _format_hotspot_snapshot(item):
    return {
        "category": item.get("category"),
        "title": item.get("title"),
        "priority_rank": item.get("priority_rank"),
        "score": item.get("score"),
        "geometry_hotspot_titles": item.get("geometry_hotspot_titles") or [],
        "inspection_record_ids": item.get("inspection_record_ids") or [],
        "quality_issue_ids": item.get("quality_issue_ids") or [],
        "recommended_action": item.get("recommended_action"),
    }


def _compare_hotspots(baseline_index, candidate_index):
    baseline_categories = set(baseline_index.keys())
    candidate_categories = set(candidate_index.keys())

    new_hotspots = [
        {
            **_format_hotspot_snapshot(candidate_index[category]),
            "reason": "Candidate revision introduces this review hotspot category.",
        }
        for category in sorted(candidate_categories - baseline_categories)
    ]
    resolved_hotspots = [
        {
            **_format_hotspot_snapshot(baseline_index[category]),
            "reason": "Baseline hotspot category no longer appears in the candidate review-pack.",
        }
        for category in sorted(baseline_categories - candidate_categories)
    ]

    shifted_hotspots = []
    for category in sorted(baseline_categories & candidate_categories):
        baseline_item = baseline_index[category]
        candidate_item = candidate_index[category]
        reasons = []

        if baseline_item.get("priority_rank") != candidate_item.get("priority_rank"):
            reasons.append(
                f"priority rank changed from {baseline_item.get('priority_rank')} to {candidate_item.get('priority_rank')}"
            )
        if baseline_item.get("score") != candidate_item.get("score"):
            reasons.append(
                f"score changed from {baseline_item.get('score')} to {candidate_item.get('score')}"
            )

        baseline_geometry = set(baseline_item.get("geometry_hotspot_titles") or [])
        candidate_geometry = set(candidate_item.get("geometry_hotspot_titles") or [])
        if baseline_geometry != candidate_geometry:
            reasons.append("supporting geometry hotspot titles changed")

        baseline_inspection = set(baseline_item.get("inspection_record_ids") or [])
        candidate_inspection = set(candidate_item.get("inspection_record_ids") or [])
        if baseline_inspection != candidate_inspection:
            reasons.append("linked inspection evidence changed")

        baseline_quality = set(baseline_item.get("quality_issue_ids") or [])
        candidate_quality = set(candidate_item.get("quality_issue_ids") or [])
        if baseline_quality != candidate_quality:
            reasons.append("linked quality evidence changed")

        if baseline_item.get("recommended_action") != candidate_item.get("recommended_action"):
            reasons.append("recommended action changed")

        if reasons:
            shifted_hotspots.append({
                "category": category,
                "reasons": reasons,
                "baseline": _format_hotspot_snapshot(baseline_item),
                "candidate": _format_hotspot_snapshot(candidate_item),
            })

    return new_hotspots, resolved_hotspots, shifted_hotspots


def _compare_evidence(baseline_index, candidate_index):
    baseline_ids = set(baseline_index.keys())
    candidate_ids = set(candidate_index.keys())
    evidence_added = [candidate_index[key] for key in sorted(candidate_ids - baseline_ids)]
    evidence_removed = [baseline_index[key] for key in sorted(baseline_ids - candidate_ids)]
    return evidence_added, evidence_removed


def _compare_actions(baseline_actions, candidate_actions):
    baseline_categories = set(baseline_actions.keys())
    candidate_categories = set(candidate_actions.keys())

    return {
        "added": [candidate_actions[key] for key in sorted(candidate_categories - baseline_categories)],
        "removed": [baseline_actions[key] for key in sorted(baseline_categories - candidate_categories)],
        "changed": [
            {
                "category": key,
                "baseline": baseline_actions[key],
                "candidate": candidate_actions[key],
            }
            for key in sorted(baseline_categories & candidate_categories)
            if baseline_actions[key].get("recommended_action") != candidate_actions[key].get("recommended_action")
        ],
    }


def _compare_confidence(baseline_report, candidate_report):
    baseline_conf = baseline_report.get("uncertainty_coverage_report") or {}
    candidate_conf = candidate_report.get("uncertainty_coverage_report") or {}
    baseline_score = baseline_conf.get("numeric_score")
    candidate_score = candidate_conf.get("numeric_score")
    reasons = []

    baseline_missing = set(baseline_conf.get("missing_inputs") or [])
    candidate_missing = set(candidate_conf.get("missing_inputs") or [])
    if baseline_missing != candidate_missing:
        reasons.append("missing-input coverage changed")
    if baseline_conf.get("analysis_confidence") != candidate_conf.get("analysis_confidence"):
        reasons.append("analysis confidence label changed")
    if baseline_score != candidate_score:
        reasons.append("numeric confidence score changed")

    return {
        "baseline": {
            "label": baseline_conf.get("analysis_confidence"),
            "numeric_score": baseline_score,
            "missing_inputs": sorted(baseline_missing),
        },
        "candidate": {
            "label": candidate_conf.get("analysis_confidence"),
            "numeric_score": candidate_score,
            "missing_inputs": sorted(candidate_missing),
        },
        "delta": _round_number((candidate_score or 0) - (baseline_score or 0), 3) if isinstance(baseline_score, (int, float)) and isinstance(candidate_score, (int, float)) else None,
        "reasons": reasons,
    }


def main():
    try:
        payload = read_input()
        baseline_document = payload.get("baseline") or {}
        candidate_document = payload.get("candidate") or {}
        baseline_path = payload.get("baseline_path")
        candidate_path = payload.get("candidate_path")

        baseline_report = _extract_report(baseline_document)
        candidate_report = _extract_report(candidate_document)

        baseline_metrics = baseline_report.get("geometry_summary") or {}
        candidate_metrics = candidate_report.get("geometry_summary") or {}
        baseline_hotspots = _hotspot_index(baseline_report)
        candidate_hotspots = _hotspot_index(candidate_report)
        evidence_added, evidence_removed = _compare_evidence(
            _evidence_index(baseline_report),
            _evidence_index(candidate_report),
        )
        action_changes = _compare_actions(
            _action_index(baseline_report),
            _action_index(candidate_report),
        )
        new_hotspots, resolved_hotspots, shifted_hotspots = _compare_hotspots(
            baseline_hotspots,
            candidate_hotspots,
        )
        confidence_changes = _compare_confidence(baseline_report, candidate_report)

        comparison = {
            "baseline": baseline_path,
            "candidate": candidate_path,
            "part": {
                "baseline": baseline_report.get("part", {}).get("name"),
                "candidate": candidate_report.get("part", {}).get("name"),
            },
            "revision": {
                "baseline": baseline_report.get("part", {}).get("revision"),
                "candidate": candidate_report.get("part", {}).get("revision"),
            },
            "comparison_type": "evidence_driven_review_pack_diff",
            "metrics": {
                "volume_mm3": _diff_numbers(
                    baseline_metrics.get("volume_mm3") or baseline_metrics.get("volume"),
                    candidate_metrics.get("volume_mm3") or candidate_metrics.get("volume"),
                ),
                "face_count": _diff_numbers(
                    baseline_metrics.get("face_count") or baseline_metrics.get("faces"),
                    candidate_metrics.get("face_count") or candidate_metrics.get("faces"),
                ),
                "edge_count": _diff_numbers(
                    baseline_metrics.get("edge_count") or baseline_metrics.get("edges"),
                    candidate_metrics.get("edge_count") or candidate_metrics.get("edges"),
                ),
            },
            "new_hotspots": new_hotspots,
            "resolved_hotspots": resolved_hotspots,
            "shifted_hotspots": shifted_hotspots,
            "evidence_added": evidence_added,
            "evidence_removed": evidence_removed,
            "action_changes": action_changes,
            "confidence_changes": confidence_changes,
            "revision_story": [
                f"{len(new_hotspots)} new hotspot categories surfaced in the candidate revision.",
                f"{len(resolved_hotspots)} baseline hotspot categories resolved or disappeared.",
                f"{len(shifted_hotspots)} shared hotspot categories changed supporting evidence or priority.",
            ],
        }

        respond({
            "success": True,
            "comparison": comparison,
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
