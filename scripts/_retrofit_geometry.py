"""FreeCAD geometry used by the retrofit check in the pre-oriented XY frame."""

import hashlib
import math
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from tempfile import TemporaryDirectory

import Part
from FreeCAD import Vector

from _shapes import boolean_op, import_shape, make_shape
from step_feature_detector import extract_cylinders_from_step


TOLERANCES = {
    "linear_mm": 1e-6,
    "contact_area_mm2": 1e-6,
    "intersection_volume_mm3": 1e-6,
    "parallel_axis_sine": 1e-7,
}
LINEAR = TOLERANCES["linear_mm"]
VOLUME = TOLERANCES["intersection_volume_mm3"]
HOLE_HINT_TOLERANCE = 0.10
BORE_PROBE_INSET = 1e-5


@dataclass
class MountFace:
    z: float
    normal: list
    faces: list

    def moved(self, delta):
        return MountFace(self.z + delta[2], self.normal, [moved(face, delta) for face in self.faces])


def read_solid(path):
    try:
        if path.suffix.lower() not in {".step", ".stp"}:
            raise ValueError("expected a .step or .stp file")
        digest = hashlib.sha256()
        with TemporaryDirectory() as directory:
            snapshot = Path(directory) / "input.step"
            with path.open("rb") as source, snapshot.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
                    digest.update(chunk)
            shape = import_shape({"file": str(snapshot)})
        if shape.isNull() or not shape.isValid():
            raise ValueError("FreeCAD returned a null or invalid shape")
    except Exception as error:
        raise ValueError(f"Failed to read STEP {path}: {error}") from error

    while shape.ShapeType == "Compound":
        children = shape.childShapes()
        if len(children) != 1:
            break
        shape = children[0]
    return digest.hexdigest(), shape if shape.ShapeType == "Solid" and shape.Volume > VOLUME else None


def parallel_z(axis):
    return math.hypot(axis[0], axis[1]) <= TOLERANCES["parallel_axis_sine"]


def horizontal_normal(face):
    if not isinstance(face.Surface, Part.Plane):
        return None
    normal = list(face.normalAt(0, 0))
    return normal if parallel_z(normal) else None


def find_mount_face(shape, z, side):
    faces = []
    for face in shape.Faces:
        if abs(face.CenterOfMass.z - z) > LINEAR:
            continue
        normal = horizontal_normal(face)
        if normal is not None and side * normal[2] > 0:
            faces.append(face)
    if not faces:
        return None
    return MountFace(faces[0].CenterOfMass.z, horizontal_normal(faces[0]), faces)


def cylinder_faces(shape):
    faces = shape.Faces
    return [
        faces[record["index"]]
        for record in extract_cylinders_from_step(shape, cylinders_only=True)
        if record["is_hole"]
    ]


def axis_at_z(surface, z):
    center, axis = surface.Center, surface.Axis
    return list(center + axis * ((z - center.z) / axis.z))


def box_shape(bounds):
    lower, upper = bounds["min_mm"], bounds["max_mm"]
    x, y, z = (end - start for start, end in zip(lower, upper))
    return make_shape({"type": "box", "position": lower, "length": x, "width": y, "height": z})


def bore_shape(x, y, radius, bottom, top):
    return make_shape({
        "type": "cylinder", "position": [x, y, bottom - 1],
        "radius": radius, "height": top - bottom + 2,
    })


def moved(shape, delta):
    copy = shape.copy()
    copy.translate(Vector(*delta))
    return copy


def common(left, right):
    result = boolean_op("common", left, right)
    # The kernel represents an empty intersection as a valid empty compound.
    if result.isNull() or not result.isValid():
        raise RuntimeError("FreeCAD returned an invalid boolean intersection")
    return result


def intersection_volume(left, right):
    return common(left, right).Volume


def through_bore(shape, cylinder, mount, center):
    rings = [edge for edge in cylinder.Edges if isinstance(edge.Curve, Part.Circle) and edge.isClosed()]
    if len(rings) != 2:
        return False
    mount_edges = [edge for face in mount.faces for edge in face.Edges]
    on_mount = [ring for ring in rings if any(ring.isSame(edge) for edge in mount_edges)]
    if len(on_mount) != 1:
        return False
    exit_ring = next(ring for ring in rings if not ring.isSame(on_mount[0]))
    exit_faces = [
        face for face in shape.Faces if any(exit_ring.isSame(edge) for edge in face.Edges)
    ]
    normals = [horizontal_normal(face) for face in exit_faces]
    if not any(normal and normal[2] * mount.normal[2] < 0 for normal in normals):
        return False

    # Confirm a full round passage through the solid, including any material past the two rings.
    radius = cylinder.Surface.Radius - BORE_PROBE_INSET
    if radius <= LINEAR:
        return False
    bbox = shape.BoundBox
    probe = bore_shape(center[0], center[1], radius, bbox.ZMin, bbox.ZMax)
    return intersection_volume(shape, probe) <= VOLUME


def find_holes(shape, cylinders, mount, hint):
    matched = []
    for face in cylinders:
        surface = face.Surface
        if not parallel_z(list(surface.Axis)):
            continue
        center = axis_at_z(surface, mount.z)
        if math.dist(center[:2], hint["center_mm"][:2]) > HOLE_HINT_TOLERANCE:
            continue
        if through_bore(shape, face, mount, center):
            matched.append({
                "id": hint["id"],
                "center_mm": center,
                "axis": list(surface.Axis),
                "diameter_mm": 2 * surface.Radius,
            })
    return matched


def move_hole(hole, delta):
    return {**hole, "center_mm": [a + b for a, b in zip(hole["center_mm"], delta)]}


def mount_interface(lower, upper, interface):
    gap = upper.z - lower.z
    result = {"interface": interface, "plane_gap_mm": gap, "contact_area_mm2": 0.0}
    if abs(gap) <= LINEAR:
        # Snap the faces to their common plane only for contact-area measurement.
        surfaces = [moved(face, [0, 0, -gap]) for face in upper.faces] if gap else upper.faces
        result["contact_area_mm2"] = sum(common(a, b).Area for a in lower.faces for b in surfaces)
    return result


def clearance(shape, obstacle):
    volume = intersection_volume(shape, obstacle)
    distance = 0.0 if volume > 0 else shape.distToShape(obstacle)[0]
    if not math.isfinite(distance) or distance < 0:
        raise RuntimeError("FreeCAD did not return a valid connector distance")
    return distance, volume


def adapter_webs(bounds, holes):
    lower, upper = bounds["min_mm"], bounds["max_mm"]
    circles = [(h["center_mm"][:2], h["diameter_mm"] / 2) for h in holes]
    hole_web = min(
        math.dist(a, b) - r1 - r2 for (a, r1), (b, r2) in combinations(circles, 2)
    )
    edge_web = min(
        min(x - lower[0], upper[0] - x, y - lower[1], upper[1] - y) - radius
        for (x, y), radius in circles
    )
    return hole_web, edge_web


def build_adapter(bounds, holes):
    lower, upper = bounds["min_mm"], bounds["max_mm"]
    plate = box_shape(bounds)
    for hole in holes:
        x, y, _ = hole["center_mm"]
        tool = bore_shape(x, y, hole["diameter_mm"] / 2, lower[2], upper[2])
        cut = boolean_op("cut", plate, tool)
        if cut.isNull() or len(cut.Solids) != 1 or not cut.isValid() or cut.Volume >= plate.Volume:
            raise RuntimeError(f"FreeCAD could not drill adapter hole {hole['id']}")
        plate = cut.Solids[0]
    return plate


def export_review_step(plate, path):
    """Re-import the staged export before its report can publish the STEP digest."""
    plate.exportStep(str(path))
    digest, imported = read_solid(path)
    if imported is None or not math.isclose(imported.Volume, plate.Volume, rel_tol=1e-9, abs_tol=VOLUME):
        raise ValueError("Exported STEP does not reproduce the evaluated adapter volume")
    expected, actual = plate.BoundBox, imported.BoundBox
    for bound in ("XMin", "YMin", "ZMin", "XMax", "YMax", "ZMax"):
        if abs(getattr(expected, bound) - getattr(actual, bound)) > LINEAR:
            raise ValueError("Exported STEP does not reproduce the evaluated adapter placement")
    return digest
