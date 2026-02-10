"""
Face selector for mate constraints.
Selects faces from a shape by geometry type, axis, and selector.

Face reference format: "<geometry>:<axis>:<selector>"
  geometry: plane | cyl
  axis: +x,-x,+y,-y,+z,-z,x,y,z
  selector: min|max|near:<val>|<index>  (optional)
    - plane default: max along axis
    - cyl default: largest radius
"""

import math
import FreeCAD
import Part
from FreeCAD import Vector


# Axis direction lookup
_AXIS_MAP = {
    "+x": Vector(1, 0, 0),  "-x": Vector(-1, 0, 0),  "x": Vector(1, 0, 0),
    "+y": Vector(0, 1, 0),  "-y": Vector(0, -1, 0),  "y": Vector(0, 1, 0),
    "+z": Vector(0, 0, 1),  "-z": Vector(0, 0, -1),  "z": Vector(0, 0, 1),
}

# Tolerance for direction comparison (cosine of max angle)
_DIR_TOL = math.cos(math.radians(15))


def _parse_face_ref(face_ref):
    """Parse face reference string into (geometry, axis_vec, axis_key, selector)."""
    parts = face_ref.split(":")
    if len(parts) < 2:
        raise ValueError(f"Invalid face ref '{face_ref}': need at least <geometry>:<axis>")

    geometry = parts[0].lower()
    axis_key = parts[1].lower()
    selector = parts[2] if len(parts) > 2 else None

    if geometry not in ("plane", "cyl"):
        raise ValueError(f"Unknown geometry type '{geometry}' in face ref '{face_ref}'")

    if axis_key not in _AXIS_MAP:
        raise ValueError(f"Unknown axis '{axis_key}' in face ref '{face_ref}'")

    axis_vec = _AXIS_MAP[axis_key]
    return geometry, axis_vec, axis_key, selector


def _face_center_along_axis(face, axis_vec):
    """Project face center-of-mass onto axis direction."""
    com = face.CenterOfMass
    return com.dot(axis_vec)


def _is_planar_face(face):
    """Check if a face is planar (flat)."""
    try:
        surf = face.Surface
        return isinstance(surf, Part.Plane)
    except Exception:
        return False


def _is_cylindrical_face(face):
    """Check if a face is cylindrical."""
    try:
        surf = face.Surface
        return isinstance(surf, Part.Cylinder)
    except Exception:
        return False


def _plane_normal(face):
    """Get the outward normal of a planar face."""
    try:
        uv = face.Surface.parameter(face.CenterOfMass)
        return face.normalAt(uv[0], uv[1])
    except Exception:
        # Fallback: average normal from sample points
        try:
            return face.normalAt(0.5, 0.5)
        except Exception:
            return Vector(0, 0, 0)


def _cyl_axis(face):
    """Get the axis direction of a cylindrical face."""
    return Vector(face.Surface.Axis)


def _cyl_radius(face):
    """Get the radius of a cylindrical face."""
    return face.Surface.Radius


def _cyl_center(face):
    """Get the center point on the axis of a cylindrical face."""
    return Vector(face.Surface.Center)


def _select_plane_faces(shape, axis_vec):
    """Find all planar faces whose normal is parallel to axis_vec (either direction)."""
    matches = []
    for face in shape.Faces:
        if not _is_planar_face(face):
            continue
        normal = _plane_normal(face)
        if normal.Length < 1e-9:
            continue
        n_norm = normal.normalize()
        dot = abs(n_norm.dot(axis_vec))
        if dot > _DIR_TOL:
            matches.append(face)
    return matches


def _select_cyl_faces(shape, axis_vec):
    """Find all cylindrical faces whose axis is parallel to axis_vec."""
    matches = []
    for face in shape.Faces:
        if not _is_cylindrical_face(face):
            continue
        cax = _cyl_axis(face)
        if cax.Length < 1e-9:
            continue
        c_norm = cax.normalize()
        dot = abs(c_norm.dot(axis_vec))
        if dot > _DIR_TOL:
            matches.append(face)
    return matches


def _apply_selector_plane(faces, axis_vec, axis_key, selector):
    """
    From candidate plane faces, pick one based on selector.
    Default: max along axis (or min for negative axis without explicit selector).
    """
    if not faces:
        raise ValueError("No matching plane faces found")

    if selector is None:
        # Default: max for +axis, min for -axis
        selector = "min" if axis_key.startswith("-") else "max"

    if selector == "max":
        return max(faces, key=lambda f: _face_center_along_axis(f, axis_vec))
    elif selector == "min":
        return min(faces, key=lambda f: _face_center_along_axis(f, axis_vec))
    elif selector.startswith("near:"):
        val = float(selector.split(":")[1])
        return min(faces, key=lambda f: abs(_face_center_along_axis(f, axis_vec) - val))
    else:
        # Numeric index
        try:
            idx = int(selector)
            sorted_faces = sorted(faces, key=lambda f: _face_center_along_axis(f, axis_vec))
            return sorted_faces[idx]
        except (ValueError, IndexError):
            raise ValueError(f"Invalid plane selector: {selector}")


def _apply_selector_cyl(faces, axis_vec, selector):
    """
    From candidate cylindrical faces, pick one based on selector.
    Default: largest radius.
    """
    if not faces:
        raise ValueError("No matching cylindrical faces found")

    if selector is None:
        return max(faces, key=lambda f: _cyl_radius(f))

    if selector == "max":
        return max(faces, key=lambda f: _cyl_radius(f))
    elif selector == "min":
        return min(faces, key=lambda f: _cyl_radius(f))
    elif selector.startswith("near:"):
        val = float(selector.split(":")[1])
        return min(faces, key=lambda f: abs(_cyl_radius(f) - val))
    else:
        try:
            idx = int(selector)
            sorted_faces = sorted(faces, key=lambda f: _cyl_radius(f))
            return sorted_faces[idx]
        except (ValueError, IndexError):
            raise ValueError(f"Invalid cyl selector: {selector}")


def select_face(shape, face_ref):
    """
    Select a face from a shape based on a face reference string.

    Args:
        shape: Part.Shape to select from
        face_ref: "<geometry>:<axis>:<selector>" string

    Returns:
        (face, info) where info is a dict with geometry-specific data:
          - plane: {type, normal, center, position_along_axis}
          - cyl: {type, axis, center, radius}
    """
    geometry, axis_vec, axis_key, selector = _parse_face_ref(face_ref)

    if geometry == "plane":
        candidates = _select_plane_faces(shape, axis_vec)
        face = _apply_selector_plane(candidates, axis_vec, axis_key, selector)
        normal = _plane_normal(face)
        return face, {
            "type": "plane",
            "normal": normal,
            "center": face.CenterOfMass,
            "position_along_axis": _face_center_along_axis(face, axis_vec),
        }

    elif geometry == "cyl":
        candidates = _select_cyl_faces(shape, axis_vec)
        face = _apply_selector_cyl(candidates, axis_vec, selector)
        return face, {
            "type": "cyl",
            "axis": _cyl_axis(face).normalize(),
            "center": _cyl_center(face),
            "radius": _cyl_radius(face),
        }

    else:
        raise ValueError(f"Unknown geometry type: {geometry}")
