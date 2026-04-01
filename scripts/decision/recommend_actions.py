ACTION_RULES = {
    "wall_thickness": {
        "action_type": "process_control_review",
        "owner_role": "manufacturing_engineer",
        "recommended_action": "Review minimum wall thickness, distortion risk, and process controls around the linked wall hotspot.",
        "expected_effect": "Reduces repeat distortion and clarifies whether design or process containment is needed.",
    },
    "stress_or_tooling": {
        "action_type": "tooling_review",
        "owner_role": "manufacturing_engineer",
        "recommended_action": "Review local edge treatment, cutter access, and stress concentration controls at the linked hotspot.",
        "expected_effect": "Reduces tooling risk and clarifies whether geometry changes are needed.",
    },
    "patterning": {
        "action_type": "inspection_containment",
        "owner_role": "quality_engineer",
        "recommended_action": "Recheck datum strategy, hole pattern inspection method, and drilling controls for the linked hotspot.",
        "expected_effect": "Improves pattern capability and reduces repeat feature mismatch escapes.",
    },
    "complexity": {
        "action_type": "design_review",
        "owner_role": "design_engineer",
        "recommended_action": "Prioritize a manufacturability review for the linked high-complexity hotspot before the next release.",
        "expected_effect": "Reduces avoidable downstream review churn and setup risk.",
    },
    "tool_access": {
        "action_type": "tooling_review",
        "owner_role": "manufacturing_engineer",
        "recommended_action": "Review tool access, cleanup strategy, and machining approach for the linked deep-feature hotspot.",
        "expected_effect": "Improves access planning and reduces tool reach problems.",
    },
    "slenderness": {
        "action_type": "fixture_review",
        "owner_role": "manufacturing_engineer",
        "recommended_action": "Review handling, fixturing, and stiffness controls for the linked slender hotspot.",
        "expected_effect": "Reduces handling-induced variation and fixture instability.",
    },
}


def recommend_actions(review_priorities):
    actions = []
    for item in review_priorities[:3]:
        category = item.get("category")
        rule = ACTION_RULES.get(category, {
            "action_type": "engineering_review",
            "owner_role": "engineering_lead",
            "recommended_action": "Review the linked evidence and confirm the next engineering action for the hotspot.",
            "expected_effect": "Provides a documented disposition for the linked hotspot risk.",
        })
        actions.append({
            "action_id": f"action-{item.get('hotspot_id') or category or 'review'}",
            "action_type": rule.get("action_type"),
            "priority_rank": item.get("priority_rank"),
            "target_hotspot_id": item.get("hotspot_id"),
            "category": category,
            "based_on": category or item.get("hotspot_id"),
            "owner_role": rule.get("owner_role"),
            "recommended_action": rule.get("recommended_action"),
            "why": item.get("rationale"),
            "evidence_refs": item.get("evidence_refs") or [],
            "confidence": item.get("confidence"),
            "expected_effect": rule.get("expected_effect"),
        })
    return actions
