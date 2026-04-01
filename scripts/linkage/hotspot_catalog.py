from adapters.common import tokenize
from linkage.feature_matcher import build_hotspot_feature_refs
from linkage.location_matcher import build_hotspot_location_aliases
from linkage.match_utils import dedupe
from linkage.process_matcher import build_hotspot_process_steps


def _flatten_text(value):
    if isinstance(value, dict):
        items = []
        for nested in value.values():
            items.extend(_flatten_text(nested))
        return items
    if isinstance(value, (list, tuple, set)):
        items = []
        for nested in value:
            items.extend(_flatten_text(nested))
        return items
    if value in (None, ""):
        return []
    return [str(value)]


def build_hotspot_catalog(hotspot_payload, context=None):
    hotspots = (hotspot_payload or {}).get("hotspots") or []
    default_process = (
        ((context or {}).get("part") or {}).get("process")
        or ((context or {}).get("manufacturing_context") or {}).get("process_family")
    )
    category_counts = {}
    catalog = []

    for hotspot in hotspots:
        category = hotspot.get("category") or "uncategorized"
        category_counts[category] = category_counts.get(category, 0) + 1
        hotspot_id = hotspot.get("hotspot_id") or f"{category}-{category_counts[category]:03d}"
        evidence = hotspot.get("evidence") or {}
        feature_refs = build_hotspot_feature_refs(hotspot)
        location_aliases = build_hotspot_location_aliases(hotspot)
        process_steps = build_hotspot_process_steps(hotspot, default_process=default_process)

        tokens = []
        for value in [
            hotspot.get("title"),
            hotspot.get("category"),
            hotspot.get("rationale"),
            feature_refs,
            location_aliases,
            process_steps,
            _flatten_text(evidence),
        ]:
            if isinstance(value, list):
                for item in value:
                    tokens.extend(tokenize(item))
            else:
                tokens.extend(tokenize(value))

        catalog.append({
            **hotspot,
            "hotspot_id": hotspot_id,
            "feature_refs": dedupe(feature_refs),
            "location_aliases": dedupe(location_aliases),
            "process_steps": dedupe(process_steps),
            "tokens": dedupe(tokens),
        })

    return catalog


def build_evidence_ref(source_type, record, id_field):
    return {
        "source_type": source_type,
        "source_id": record.get(id_field),
        "source_row": record.get("source_row"),
    }
