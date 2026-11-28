"""X-side corner relief for a rectangular through slot and its final-solid evidence."""

import math


RADIUS_FIELD = "side_relief_radius_mm"
GEOMETRY_EPS = 1e-6


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _same(a, b):
    return math.isclose(a, b, rel_tol=0, abs_tol=GEOMETRY_EPS)


def declared_slots(config):
    return [shape for shape in config.get("shapes", []) if RADIUS_FIELD in shape]


def relief_parameters(spec):
    """Return the nominal box and the radius of four outward semicircles."""
    position = spec.get("position", [0, 0, 0])
    length, width, height, radius = (spec.get(key) for key in ("length", "width", "height", RADIUS_FIELD))
    if (spec.get("type") != "box" or "rotation" in spec
            or not isinstance(position, (list, tuple)) or len(position) != 3
            or not all(_finite(v) for v in [*position, length, width, height, radius])
            or min(length, height, radius) <= 0 or 4 * radius >= width):
        raise ValueError(f"{RADIUS_FIELD} requires an unrotated box and 0 < 4R < width")
    return (*position, length, width, height, radius)


def relief_centers(x, y, length, width, radius):
    return [(x_end, y_end) for x_end in (x, x + length)
            for y_end in (y + radius, y + width - radius)]


def _plate_for_relief(config, operations, final_id, slot):
    """Limit this proof to one plate, raised cylinders, and disjoint through cuts."""
    specs = {spec.get("id"): spec for spec in config.get("shapes", [])}
    if not operations or len(specs) != len(config.get("shapes", [])):
        return None
    plate_id = operations[0].get("base")
    plate = specs.get(plate_id, {})
    if plate.get("type") != "box" or RADIUS_FIELD in plate or "rotation" in plate:
        return None
    x0, y0, z0 = plate.get("position", [0, 0, 0])
    length, width, height = (plate.get(k) for k in ("length", "width", "height"))
    if not all(_finite(v) for v in (x0, y0, z0, length, width, height)) or min(length, width, height) <= 0:
        return None
    x1, y1, z1 = x0 + length, y0 + width, z0 + height
    sx, sy, sz, sl, sw, sh, r = relief_parameters(slot)
    left, right, front, back = sx - r, sx + sl + r, sy, sy + sw
    if not (x0 < left < right < x1 and y0 < front < back < y1 and sz <= z0 and sz + sh >= z1):
        return None

    current, disks, used_slot = plate_id, [], False
    for op in operations:
        kind, tool_id = op.get("op"), op.get("tool")
        if op.get("base") != current or kind not in ("cut", "fuse") or not isinstance(tool_id, str):
            return None
        if tool_id == slot["id"]:
            if kind != "cut" or used_slot:
                return None
            used_slot = True
        else:
            tool = specs.get(tool_id, {})
            if (tool.get("type") != "cylinder" or "rotation" in tool
                    or tool.get("direction", [0, 0, 1]) != [0, 0, 1]):
                return None
            x, y, z = tool.get("position", [0, 0, 0])
            radius, depth = tool.get("radius"), tool.get("height")
            if not all(_finite(v) for v in (x, y, z, radius, depth)) or min(radius, depth) <= 0:
                return None
            if not (x0 < x - radius and x + radius < x1 and y0 < y - radius and y + radius < y1):
                return None
            fits_z = z <= z0 and z + depth >= z1 if kind == "cut" else _same(z, z1)
            if not fits_z:
                return None
            gap = math.hypot(max(left - x, 0, x - right), max(front - y, 0, y - back))
            if gap <= radius or any(math.hypot(x - px, y - py) <= radius + pr for px, py, pr in disks):
                return None
            disks.append((x, y, radius))
        current = op.get("result", current)
        if current in specs and current != plate_id:
            return None
    return (z0, z1) if used_slot and current == final_id else None


def inspect_slot_relief(config, operations, final_id, shape, slot):
    """Identify four inward, full-thickness semicylinders on the selected solid."""
    evidence = {"measurement": "slot_side_relief", "final_shape_id": final_id,
                "geometry_verification": "not_performed"}
    if not any(op.get("op") == "cut" and op.get("tool") == slot.get("id") for op in operations):
        return {**evidence, "reason_code": "slot_relief_not_in_final"}
    levels = _plate_for_relief(config, operations, final_id, slot)
    if levels is None:
        return {**evidence, "reason_code": "slot_relief_scope_unverified"}
    if shape is None:
        return {**evidence, "reason_code": "slot_relief_geometry_unavailable"}

    evidence.update(basis="freecad_runtime_geometry", geometry_verification="failed",
                    reason_code="slot_relief_geometry_mismatch")
    if not shape.isValid() or len(shape.Solids) != 1:
        return evidence
    import Part
    from FreeCAD import Vector

    x, y, _, length, width, _, radius = relief_parameters(slot)
    z0, z1 = levels
    thickness = z1 - z0
    corners = []
    for cx, cy in relief_centers(x, y, length, width, radius):
        xmin, xmax = (cx - radius, cx) if cx == x else (cx, cx + radius)
        expected = [xmin, cy - radius, z0, xmax, cy + radius, z1]
        matches = []
        for index, face in enumerate(shape.Faces, 1):
            surface = face.Surface
            if type(surface).__name__ != "Cylinder" or not _same(surface.Radius, radius):
                continue
            center, axis = surface.Center, surface.Axis
            if not (_same(center.x, cx) and _same(center.y, cy)
                    and _same(math.hypot(axis.x, axis.y), 0) and _same(abs(axis.z), 1)):
                continue
            bb = face.BoundBox
            bounds = [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax]
            if not all(_same(a, b) for a, b in zip(bounds, expected)):
                continue
            if not _same(face.Area, math.pi * surface.Radius * thickness):
                continue
            u0, u1, v0, v1 = face.ParameterRange
            u, v = (u0 + u1) / 2, (v0 + v1) / 2
            point, normal = face.valueAt(u, v), face.normalAt(u, v)
            if not _same(((point.x - cx) * normal.x + (point.y - cy) * normal.y) / surface.Radius, -1):
                continue
            matches.append({"face_ref": f"{final_id}:Face{index}", "center_xy_mm": [center.x, center.y],
                            "radius_mm": surface.Radius, "bounds_mm": bounds})
        if len(matches) != 1:
            return evidence
        corners.append(matches[0])

    clearance = Part.makeBox(length, width, thickness, Vector(x, y, z0))
    residual = shape.common(clearance)
    if not residual.isNull() and residual.Volume > GEOMETRY_EPS:
        return evidence
    return {
        **evidence, "geometry_verification": "measured", "corners": corners,
        "clearance_bounds_mm": [x, y, z0, x + length, y + width, z1],
        "opening_bounds_mm": [min(c["bounds_mm"][0] for c in corners),
                              min(c["bounds_mm"][1] for c in corners), z0,
                              max(c["bounds_mm"][3] for c in corners),
                              max(c["bounds_mm"][4] for c in corners), z1],
    }
