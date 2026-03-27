import math


def _safe_ratio(a, b):
    if not b:
        return None
    return round(a / b, 4)


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
