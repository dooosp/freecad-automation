"""
STEP Feature Detector for FreeCAD Studio.

Analyzes a STEP file and auto-generates a basic config:
- Detects cylinders (holes, bores, shafts)
- Detects bolt hole patterns
- Estimates part type (flange, shaft, bracket, block)
- Generates suggested TOML config for drawing/DFM/tolerance

Input (JSON via stdin):
{
  "file": "/path/to/model.step"
}

Output (JSON via stdout):
{
  "success": true,
  "part_type": "flange",
  "bounding_box": { "x": 200, "y": 200, "z": 30 },
  "features": {
    "cylinders": [...],
    "bolt_circles": [...],
    "central_bore": {...},
    "fillets": [...],
    "chamfers": [...]
  },
  "suggested_config": { ... }
}
"""

import sys
import json
import math

try:
    import FreeCAD
    import Part
    HAS_FREECAD = True
except ImportError:
    HAS_FREECAD = False


def respond(data):
    print(json.dumps(data, ensure_ascii=False))
    sys.exit(0)


def respond_error(msg, details=""):
    respond({"success": False, "error": msg, "details": details})


def extract_cylinders_from_step(shape):
    """Extract all cylindrical faces from a STEP-loaded shape."""
    cylinders = []
    for i, face in enumerate(shape.Faces):
        surf = face.Surface
        if hasattr(surf, 'Radius'):
            center = surf.Center if hasattr(surf, 'Center') else face.CenterOfMass
            axis = surf.Axis if hasattr(surf, 'Axis') else FreeCAD.Vector(0, 0, 1)

            # Determine if hole or boss
            # A hole typically has the surface normal pointing inward
            is_hole = face.Orientation == 'Reversed'

            # Get height from edge lengths
            height = 0
            for edge in face.Edges:
                if edge.Length > height and not hasattr(edge.Curve, 'Radius'):
                    height = edge.Length

            cylinders.append({
                "index": i,
                "radius": round(surf.Radius, 3),
                "diameter": round(surf.Radius * 2, 3),
                "center": [round(center.x, 3), round(center.y, 3), round(center.z, 3)],
                "axis": [round(axis.x, 3), round(axis.y, 3), round(axis.z, 3)],
                "height": round(height, 3),
                "is_hole": is_hole,
            })

    return cylinders


def detect_bolt_patterns(cylinders):
    """Find bolt hole patterns: same Z, same radius, 3+ holes on a circle."""
    bolt_circles = []

    # Group by axis direction and radius
    groups = {}
    for cyl in cylinders:
        if not cyl["is_hole"]:
            continue
        key = (round(cyl["radius"], 1), round(cyl["axis"][2], 0))
        if key not in groups:
            groups[key] = []
        groups[key].append(cyl)

    for (radius, _), holes in groups.items():
        if len(holes) < 3:
            continue

        # Check if holes are on a circle (same distance from center)
        centers_2d = [(h["center"][0], h["center"][1]) for h in holes]
        # Find center of the pattern
        cx = sum(p[0] for p in centers_2d) / len(centers_2d)
        cy = sum(p[1] for p in centers_2d) / len(centers_2d)

        distances = [math.sqrt((p[0] - cx) ** 2 + (p[1] - cy) ** 2) for p in centers_2d]
        avg_dist = sum(distances) / len(distances)

        if avg_dist < 1:
            continue  # All at center, not a pattern

        # Check uniformity
        max_dev = max(abs(d - avg_dist) for d in distances)
        if max_dev / avg_dist < 0.1:  # Within 10% deviation
            bolt_circles.append({
                "count": len(holes),
                "hole_radius": radius,
                "hole_diameter": round(radius * 2, 3),
                "pcd": round(avg_dist * 2, 3),
                "center": [round(cx, 3), round(cy, 3)],
                "holes": holes,
            })

    return bolt_circles


def find_central_bore(cylinders, bbox):
    """Find the central bore (largest hole near center)."""
    center_x = (bbox.XMin + bbox.XMax) / 2
    center_y = (bbox.YMin + bbox.YMax) / 2

    central_holes = []
    for cyl in cylinders:
        if not cyl["is_hole"]:
            continue
        dist = math.sqrt((cyl["center"][0] - center_x) ** 2 + (cyl["center"][1] - center_y) ** 2)
        if dist < min(bbox.XLength, bbox.YLength) * 0.15:
            central_holes.append(cyl)

    if not central_holes:
        return None

    # Return largest
    central_holes.sort(key=lambda c: c["radius"], reverse=True)
    return central_holes[0]


def detect_fillets_chamfers(shape):
    """Detect fillet and chamfer edges."""
    fillets = []
    chamfers = []

    for i, edge in enumerate(shape.Edges):
        curve = edge.Curve
        if hasattr(curve, 'Radius'):
            # Small radius arcs are likely fillets
            if curve.Radius < 20:
                fillets.append({
                    "index": i,
                    "radius": round(curve.Radius, 3),
                })

    return fillets, chamfers


def estimate_part_type(bbox, central_bore, bolt_circles, cylinders):
    """Estimate part type from geometric features."""
    x, y, z = bbox.XLength, bbox.YLength, bbox.ZLength
    aspect_xy = max(x, y) / max(min(x, y), 1)
    aspect_z = max(x, y) / max(z, 1)

    if central_bore and bolt_circles:
        return "flange"
    if aspect_z > 3 and aspect_xy < 1.5:
        return "shaft"
    if aspect_z > 2 and aspect_xy > 2:
        return "bracket"
    if central_bore:
        return "bushing"
    return "block"


def generate_config(part_type, bbox, features):
    """Generate a suggested TOML config from detected features."""
    config = {
        "name": f"imported_{part_type}",
        "export": {"step": True, "stl": True},
        "drawing": {
            "scale": "auto",
            "title": f"Imported {part_type.title()}",
        },
        "manufacturing": {
            "process": "machining",
        },
    }

    # Add tolerance for bolt patterns
    if features.get("bolt_circles"):
        bc = features["bolt_circles"][0]
        config["tolerance"] = {
            "pairs": [{
                "bore": bc["hole_diameter"],
                "shaft": bc["hole_diameter"],
                "spec": "H7/g6",
            }]
        }

    return config


def analyze_step(filepath):
    """Main analysis pipeline."""
    if not HAS_FREECAD:
        respond_error(
            "FreeCAD not available",
            "step_feature_detector.py requires FreeCAD Python bindings"
        )

    try:
        shape = Part.read(filepath)
    except Exception as e:
        respond_error(f"Failed to read STEP file: {filepath}", str(e))

    bbox = shape.BoundBox

    # Extract features
    cylinders = extract_cylinders_from_step(shape)
    bolt_circles = detect_bolt_patterns(cylinders)
    central_bore = find_central_bore(cylinders, bbox)
    fillets, chamfers = detect_fillets_chamfers(shape)

    # Estimate part type
    part_type = estimate_part_type(bbox, central_bore, bolt_circles, cylinders)

    features = {
        "cylinders": cylinders,
        "bolt_circles": bolt_circles,
        "central_bore": central_bore,
        "fillets": fillets,
        "chamfers": chamfers,
        "face_count": len(shape.Faces),
        "edge_count": len(shape.Edges),
    }

    # Generate suggested config
    suggested_config = generate_config(part_type, bbox, features)

    return {
        "success": True,
        "part_type": part_type,
        "bounding_box": {
            "x": round(bbox.XLength, 2),
            "y": round(bbox.YLength, 2),
            "z": round(bbox.ZLength, 2),
        },
        "volume": round(shape.Volume, 2),
        "area": round(shape.Area, 2),
        "features": features,
        "suggested_config": suggested_config,
    }


def main():
    try:
        raw = sys.stdin.read()
        input_data = json.loads(raw)
    except Exception as e:
        respond_error("Failed to parse input", str(e))

    filepath = input_data.get("file")
    if not filepath:
        respond_error("'file' field required in input")

    result = analyze_step(filepath)
    respond(result)


if __name__ == "__main__":
    main()
