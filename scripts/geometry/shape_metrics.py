import math

from adapters.common import unique_list
from adapters.id_resolver import canonical_ref


def _safe_ratio(a, b):
    if not b:
        return 0.0
    return round(a / b, 4)


def _number_summary(values):
    numbers = [float(value) for value in values if value not in (None, "")]
    if not numbers:
        return {"count": 0, "min": None, "max": None, "avg": None}
    return {
        "count": len(numbers),
        "min": round(min(numbers), 3),
        "max": round(max(numbers), 3),
        "avg": round(sum(numbers) / len(numbers), 3),
    }


def _diameter_value(item):
    diameter = item.get("diameter")
    if diameter is not None:
        return float(diameter)
    radius = item.get("radius")
    if radius is not None:
        return float(radius) * 2
    return None


def _location_refs(context):
    refs = []
    for collection_key in ("inspection_results", "quality_issues"):
        for record in (context or {}).get(collection_key) or []:
            location_ref = record.get("normalized_location_ref") or canonical_ref("region", record.get("location_hint"))
            if location_ref:
                refs.append(location_ref)
    return unique_list(refs)


def _feature_refs(context):
    refs = []
    for collection_key in ("inspection_results", "quality_issues"):
        for record in (context or {}).get(collection_key) or []:
            feature_ref = record.get("normalized_feature_ref") or canonical_ref("feature", record.get("feature_hint"))
            if feature_ref:
                refs.append(feature_ref)
    return unique_list(refs)


def compute_shape_metrics(model_metadata):
    bbox = (model_metadata or {}).get("bounding_box", {})
    size = list(bbox.get("size") or [0, 0, 0])
    while len(size) < 3:
        size.append(0)

    dims = [float(value or 0) for value in size]
    ordered = sorted(dims, reverse=True)
    max_dim, mid_dim, min_dim = ordered if len(ordered) == 3 else (0, 0, 0)
    bbox_volume = dims[0] * dims[1] * dims[2]
    volume = float((model_metadata or {}).get("volume") or 0)
    area = float((model_metadata or {}).get("area") or 0)
    faces = int((model_metadata or {}).get("faces") or 0)
    edges = int((model_metadata or {}).get("edges") or 0)

    diagonal = round(math.sqrt(sum(value ** 2 for value in dims)), 3)
    face_density = _safe_ratio(faces, max(bbox_volume, 1))
    edge_density = _safe_ratio(edges, max(bbox_volume, 1))
    compactness = _safe_ratio(volume, bbox_volume)
    surface_to_volume = _safe_ratio(area, max(volume, 1))

    return {
        "bounding_box_mm": {
            "x": dims[0],
            "y": dims[1],
            "z": dims[2],
            "diagonal": diagonal,
        },
        "size_band": "micro" if max_dim < 25 else "small" if max_dim < 150 else "medium" if max_dim < 500 else "large",
        "volume_mm3": volume,
        "surface_area_mm2": area,
        "face_count": faces,
        "edge_count": edges,
        "vertex_count": int((model_metadata or {}).get("vertices") or 0),
        "bbox_volume_mm3": round(bbox_volume, 3),
        "compactness_ratio": compactness,
        "surface_to_volume_ratio": surface_to_volume,
        "max_aspect_ratio": _safe_ratio(max_dim, max(min_dim, 1e-6)),
        "mid_to_min_ratio": _safe_ratio(mid_dim, max(min_dim, 1e-6)),
        "planar_spread_ratio": _safe_ratio(max_dim, max(mid_dim, 1e-6)),
        "thinness_ratio": _safe_ratio(min_dim, max(max_dim, 1e-6)),
        "face_density": face_density,
        "edge_density": edge_density,
    }


def build_geometry_facts(model_metadata, feature_hints=None, context=None):
    metadata = model_metadata or {}
    hints = feature_hints or {}
    metrics = compute_shape_metrics(metadata)

    bbox = metadata.get("bounding_box", {})
    bbox_min = list(bbox.get("min") or [0, 0, 0])
    bbox_max = list(bbox.get("max") or [0, 0, 0])
    while len(bbox_min) < 3:
        bbox_min.append(0)
    while len(bbox_max) < 3:
        bbox_max.append(0)

    cylinders = hints.get("cylinders") or []
    hole_cylinders = [item for item in cylinders if item.get("is_hole")]
    boss_cylinders = [item for item in cylinders if not item.get("is_hole")]
    bolt_circles = hints.get("bolt_circles") or []
    fillets = hints.get("fillets") or []
    chamfers = hints.get("chamfers") or []

    inspection_results = (context or {}).get("inspection_results") or []
    quality_issues = (context or {}).get("quality_issues") or []

    return {
        "bbox": {
            "min_mm": [round(float(value or 0), 3) for value in bbox_min[:3]],
            "max_mm": [round(float(value or 0), 3) for value in bbox_max[:3]],
            "size_mm": dict(metrics.get("bounding_box_mm") or {}),
            "bbox_volume_mm3": metrics.get("bbox_volume_mm3"),
        },
        "mass_properties": {
            "volume_mm3": metrics.get("volume_mm3"),
            "surface_area_mm2": metrics.get("surface_area_mm2"),
            "compactness_ratio": metrics.get("compactness_ratio"),
            "surface_to_volume_ratio": metrics.get("surface_to_volume_ratio"),
        },
        "topology": {
            "face_count": metrics.get("face_count"),
            "edge_count": metrics.get("edge_count"),
            "vertex_count": metrics.get("vertex_count"),
            "face_density": metrics.get("face_density"),
            "edge_density": metrics.get("edge_density"),
        },
        "raw_feature_stats": {
            "cylinder_count": len(cylinders),
            "hole_cylinder_count": len(hole_cylinders),
            "boss_cylinder_count": len(boss_cylinders),
            "bolt_circle_count": len(bolt_circles),
            "fillet_count": len(fillets),
            "chamfer_count": len(chamfers),
        },
        "cylinder_stats": {
            "all_diameters_mm": _number_summary([_diameter_value(item) for item in cylinders]),
            "hole_diameters_mm": _number_summary([_diameter_value(item) for item in hole_cylinders]),
            "boss_diameters_mm": _number_summary([_diameter_value(item) for item in boss_cylinders]),
            "heights_mm": _number_summary([item.get("height") for item in cylinders]),
        },
        "bolt_pattern_stats": {
            "pattern_count": len(bolt_circles),
            "hole_counts": _number_summary([item.get("count") for item in bolt_circles]),
            "hole_diameters_mm": _number_summary([item.get("hole_diameter") or item.get("hole_radius") for item in bolt_circles]),
            "pcd_mm": _number_summary([item.get("pcd") for item in bolt_circles]),
        },
        "detector_facts": {
            "part_type": hints.get("part_type"),
            "central_bore_present": bool(hints.get("central_bore")),
            "central_bore_diameter_mm": _diameter_value(hints.get("central_bore") or {}),
        },
        "inspect_facts": {
            "inspection_record_count": len(inspection_results),
            "inspection_out_of_tolerance_count": sum(
                1 for record in inspection_results if record.get("status") == "out_of_tolerance"
            ),
            "quality_issue_count": len(quality_issues),
            "open_quality_issue_count": sum(1 for issue in quality_issues if issue.get("status") == "open"),
            "location_refs": _location_refs(context),
            "feature_refs": _feature_refs(context),
        },
    }
