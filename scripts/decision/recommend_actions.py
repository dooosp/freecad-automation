ACTION_RULES = {
    "wall_thickness": "Review minimum wall thickness, process capability, and distortion controls.",
    "stress_or_tooling": "Review internal transitions, edge treatment, and local process strategy.",
    "patterning": "Recheck datum strategy, feature spacing, and inspection method around repeated patterns.",
    "inspection_variation": "Confirm measurement method, fixture repeatability, and tolerance allocation.",
    "complexity": "Prioritize manufacturability review before releasing the next revision.",
    "tool_access": "Review tool access, cleanup strategy, and machining approach for deep features.",
}


def recommend_actions(review_priorities):
    actions = []
    for item in review_priorities[:3]:
        category = item.get("category")
        actions.append({
            "category": category,
            "priority_rank": item.get("priority_rank"),
            "recommended_action": ACTION_RULES.get(category, "Review the linked evidence and confirm next engineering action."),
            "based_on": item.get("title"),
        })
    return actions
