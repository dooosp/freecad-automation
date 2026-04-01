import hashlib

from adapters.common import slugify, unique_list
from adapters.id_resolver import canonical_ref


def _to_float(value):
    if value in (None, "", "null", "None"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _float_token(value, digits=3):
    number = _to_float(value)
    if number is None:
        return None
    text = f"{round(number, digits):.{digits}f}".rstrip("0").rstrip(".")
    return text.replace("-", "neg").replace(".", "p")


def _point_token(values, limit=3):
    coords = list(values or [])[:limit]
    if not coords:
        return None
    tokens = [_float_token(value, digits=2) or "0" for value in coords]
    return "_".join(tokens)


def _axis_token(axis):
    if not axis:
        return None
    normalized = [abs(_to_float(value) or 0.0) for value in list(axis)[:3]]
    return _point_token(normalized, limit=3)


def stable_ref(namespace, label, *parts):
    basis_parts = [str(part) for part in parts if part not in (None, "", [], {}, ())]
    basis = "|".join(basis_parts) if basis_parts else str(label or namespace)
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:10]
    slug = slugify(label) or namespace
    return f"{namespace}:{slug}:{digest}"


def _entity_ref(entity_type, signature, sequence):
    return canonical_ref("entity", f"{entity_type}-{signature}-n{sequence:02d}")


def _region_ref(value):
    return canonical_ref("region", value) or "region:global"


def _sort_key(record):
    item = record["item"]
    return (
        record["signature"],
        _point_token(item.get("center"), limit=3) or "",
        _axis_token(item.get("axis")) or "",
        _to_float(item.get("diameter")) or _to_float(item.get("radius")) or 0.0,
        _to_float(item.get("pcd")) or 0.0,
        _to_float(item.get("count")) or 0.0,
        record["source_index"],
    )


def _index_records(entity_type, items, signature_builder, value_builder):
    records = []
    for source_index, item in enumerate(items or []):
        signature = slugify(signature_builder(item) or entity_type) or entity_type
        records.append({
            "item": dict(item or {}),
            "signature": signature,
            "source_index": source_index,
        })

    records.sort(key=_sort_key)

    counts = {}
    indexed = []
    for record in records:
        signature = record["signature"]
        counts[signature] = counts.get(signature, 0) + 1
        sequence = counts[signature]
        base = value_builder(record["item"])
        indexed.append({
            "entity_ref": _entity_ref(entity_type, signature, sequence),
            "entity_type": entity_type,
            "signature": signature,
            "sequence": sequence,
            "source_index": record["source_index"],
            **base,
        })
    return indexed


def _cylinder_signature(item):
    kind = "hole" if item.get("is_hole") else "boss"
    parts = [
        kind,
        f"d{_float_token(item.get('diameter') or ((_to_float(item.get('radius')) or 0) * 2)) or 'na'}",
        f"a{_axis_token(item.get('axis')) or 'na'}",
    ]
    center_token = _point_token(item.get("center"), limit=3)
    if center_token:
        parts.append(f"c{center_token}")
    return "-".join(parts)


def _bolt_circle_signature(item):
    parts = [
        f"count{int(_to_float(item.get('count')) or 0)}",
        f"d{_float_token(item.get('hole_diameter') or item.get('hole_radius')) or 'na'}",
        f"pcd{_float_token(item.get('pcd')) or 'na'}",
    ]
    center_token = _point_token(item.get("center"), limit=2)
    if center_token:
        parts.append(f"c{center_token}")
    return "-".join(parts)


def _edge_feature_signature(item, key):
    return f"{key}-{_float_token(item.get(key)) or 'na'}"


def _collect_regions(context):
    regions = [{
        "region_ref": "region:global",
        "label": "global",
        "source": "default",
    }]
    seen = {"region:global"}

    for collection_key, label in (("inspection_results", "inspection"), ("quality_issues", "quality")):
        for record in (context or {}).get(collection_key) or []:
            location_value = record.get("normalized_location_ref") or record.get("location_hint")
            region_ref = _region_ref(location_value)
            if region_ref in seen:
                continue
            seen.add(region_ref)
            regions.append({
                "region_ref": region_ref,
                "label": location_value or region_ref,
                "source": label,
            })

    return regions


def build_entity_index(feature_hints, context=None):
    hints = feature_hints or {}
    cylinders = _index_records(
        "cylinder",
        hints.get("cylinders") or [],
        _cylinder_signature,
        lambda item: {
            "is_hole": bool(item.get("is_hole")),
            "diameter_mm": _to_float(item.get("diameter") or ((_to_float(item.get("radius")) or 0) * 2)),
            "radius_mm": _to_float(item.get("radius")),
            "height_mm": _to_float(item.get("height")),
            "center": list(item.get("center") or []),
            "axis": list(item.get("axis") or []),
        },
    )

    bolt_circles = _index_records(
        "bolt_circle",
        hints.get("bolt_circles") or [],
        _bolt_circle_signature,
        lambda item: {
            "hole_count": int(_to_float(item.get("count")) or 0),
            "hole_diameter_mm": _to_float(item.get("hole_diameter") or item.get("hole_radius")),
            "pcd_mm": _to_float(item.get("pcd")),
            "center": list(item.get("center") or []),
        },
    )

    fillets = _index_records(
        "fillet",
        hints.get("fillets") or [],
        lambda item: _edge_feature_signature(item, "radius"),
        lambda item: {"radius_mm": _to_float(item.get("radius"))},
    )
    chamfers = _index_records(
        "chamfer",
        hints.get("chamfers") or [],
        lambda item: _edge_feature_signature(item, "size"),
        lambda item: {"size_mm": _to_float(item.get("size"))},
    )

    entity_lookup = {}
    for record in cylinders + bolt_circles + fillets + chamfers:
        entity_lookup[record["entity_ref"]] = record

    return {
        "regions": _collect_regions(context),
        "cylinders": cylinders,
        "bolt_circles": bolt_circles,
        "fillets": fillets,
        "chamfers": chamfers,
        "entity_lookup": entity_lookup,
        "entity_refs": unique_list(list(entity_lookup.keys())),
    }
