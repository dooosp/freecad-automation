"""
Mate constraint solver for FreeCAD assemblies.
Resolves coaxial, coincident, and distance constraints via BFS traversal.

Algorithm:
  1. Register anchor parts (those with explicit position)
  2. BFS: find unplaced parts connected to placed parts via mates
  3. For each unplaced part, apply constraints in order: coaxial → coincident → distance
  4. After placement, re-select faces on the transformed shape for subsequent mates
"""

import math
from collections import defaultdict, deque

import FreeCAD
from FreeCAD import Vector, Rotation, Placement

from _bootstrap import log
from _face_selector import select_face


def _center_of_mass(shape):
    """Get center of mass, falling back to BoundBox center for Compounds."""
    try:
        return shape.CenterOfMass
    except AttributeError:
        bb = shape.BoundBox
        return Vector(bb.Center.x, bb.Center.y, bb.Center.z)


def _rotation_align(vec_from, vec_to):
    """
    Compute a FreeCAD Rotation that aligns vec_from to vec_to.
    Both vectors should be unit vectors.
    """
    cross = vec_from.cross(vec_to)
    dot = vec_from.dot(vec_to)

    # Already aligned
    if cross.Length < 1e-9:
        if dot > 0:
            return Rotation()
        # 180-degree flip: pick any perpendicular axis
        perp = Vector(1, 0, 0) if abs(vec_from.x) < 0.9 else Vector(0, 1, 0)
        flip_axis = vec_from.cross(perp).normalize()
        return Rotation(flip_axis, 180)

    angle_rad = math.atan2(cross.Length, dot)
    axis = cross.normalize()
    return Rotation(axis, math.degrees(angle_rad))


def _apply_rotation(shape, rotation, center):
    """Apply a FreeCAD Rotation to a shape around a center point."""
    if rotation.isIdentity():
        return
    # Use Placement to rotate around center
    p = Placement(Vector(0, 0, 0), rotation, center)
    shape.transformShape(p.toMatrix())


def _apply_coaxial(moving_shape, fixed_info, moving_info):
    """
    Apply coaxial constraint: align cylinder axes and centers.

    Steps:
      1. Rotate moving shape so its cyl axis aligns with fixed cyl axis
      2. Translate so cylinder centers coincide in the plane perpendicular to axis
    """
    fixed_axis = fixed_info["axis"]
    moving_axis = moving_info["axis"]
    fixed_center = fixed_info["center"]

    # Step 1: Align axes
    rot = _rotation_align(moving_axis, fixed_axis)
    moving_com = _center_of_mass(moving_shape)
    _apply_rotation(moving_shape, rot, moving_com)

    # Re-select moving face after rotation to get updated center
    # We approximate by rotating the moving center point
    rot_mat = Placement(Vector(0, 0, 0), rot, moving_com).toMatrix()
    mc_vec = FreeCAD.Vector(moving_info["center"])
    mc_vec = rot_mat.multVec(mc_vec)

    # Step 2: Translate perpendicular to axis to align centers
    diff = fixed_center - mc_vec
    # Project diff onto plane perpendicular to fixed_axis
    along_axis = fixed_axis * diff.dot(fixed_axis)
    perp_offset = diff - along_axis
    if perp_offset.Length > 1e-6:
        moving_shape.translate(perp_offset)

    return perp_offset.Length


def _apply_coincident(moving_shape, fixed_info, moving_info):
    """
    Apply coincident (face-contact) constraint for planar faces.

    Steps:
      1. Rotate moving shape so its face normal opposes fixed face normal
      2. Translate so face planes coincide
    """
    fixed_normal = fixed_info["normal"].normalize()
    moving_normal = moving_info["normal"].normalize()
    fixed_center = fixed_info["center"]

    # Step 1: Align normals (opposing: moving normal should point opposite to fixed)
    target_normal = fixed_normal * -1
    rot = _rotation_align(moving_normal, target_normal)
    moving_com = _center_of_mass(moving_shape)
    _apply_rotation(moving_shape, rot, moving_com)

    # Compute rotated moving face center
    rot_mat = Placement(Vector(0, 0, 0), rot, moving_com).toMatrix()
    mc_vec = FreeCAD.Vector(moving_info["center"])
    mc_vec = rot_mat.multVec(mc_vec)

    # Step 2: Translate along fixed normal so planes coincide
    # Distance from moving face center to fixed face plane
    diff = fixed_center - mc_vec
    along_normal = fixed_normal * diff.dot(fixed_normal)
    if along_normal.Length > 1e-6:
        moving_shape.translate(along_normal)

    return along_normal.Length


def _apply_distance(moving_shape, fixed_info, moving_info, distance):
    """
    Apply distance constraint: coincident + offset along normal.
    """
    _apply_coincident(moving_shape, fixed_info, moving_info)
    # Offset along fixed normal by distance
    offset = fixed_info["normal"].normalize() * distance
    moving_shape.translate(offset)


def _build_adjacency(mates, part_ids):
    """Build adjacency list: part_id → [(mate_index, other_part_id)]."""
    adj = defaultdict(list)
    for i, mate in enumerate(mates):
        p1 = mate["part1"]
        p2 = mate["part2"]
        if p1 in part_ids and p2 in part_ids:
            adj[p1].append((i, p2))
            adj[p2].append((i, p1))
    return adj


def _check_overconstraint(moving_shape, original_com, label):
    """Warn if shape moved very little (possible over-constraint)."""
    new_com = _center_of_mass(moving_shape)
    displacement = (new_com - original_com).Length
    if displacement < 0.001:
        log(f"[MATE] Warning: '{label}' barely moved ({displacement:.4f}mm) — may be over-constrained")


def solve_mates(part_shapes, mates, explicit_placements):
    """
    Solve assembly mate constraints and return placed shapes.

    Args:
        part_shapes: dict[part_id → Part.Shape] (unplaced, as-built)
        mates: list of mate constraint dicts
        explicit_placements: dict[part_id → {position, rotation}] for anchor parts

    Returns:
        dict[part_id → Part.Shape] with all shapes placed/transformed
    """
    if not explicit_placements:
        raise ValueError("No anchor part found: at least one part needs an explicit position")

    placed = {}
    part_ids = set(part_shapes.keys())

    # Phase 1: Place anchors
    for pid, placement in explicit_placements.items():
        if pid not in part_shapes:
            raise ValueError(f"Anchor references unknown part: {pid}")
        shape = part_shapes[pid].copy()
        # Apply explicit placement
        pos = placement.get("position", [0, 0, 0])
        rot = placement.get("rotation")
        if pos != [0, 0, 0]:
            shape.translate(Vector(*pos))
        if rot:
            center = Vector(*pos)
            axis = Vector(rot[0], rot[1], rot[2])
            shape.rotate(center, axis, rot[3])
        placed[pid] = shape
        log(f"[MATE] Anchor '{pid}' placed at {pos}")

    # Phase 2: BFS to place remaining parts
    adj = _build_adjacency(mates, part_ids)
    queue = deque()

    # Seed queue: unplaced parts adjacent to placed parts
    for pid in placed:
        for mate_idx, other_pid in adj[pid]:
            if other_pid not in placed:
                queue.append(other_pid)

    visited_attempts = set()
    max_iterations = len(part_shapes) * len(mates) + 10  # Safety limit

    iteration = 0
    while queue and iteration < max_iterations:
        iteration += 1
        pid = queue.popleft()

        if pid in placed:
            continue

        # Collect mates connecting this part to already-placed parts
        applicable_mates = []
        for mate_idx, other_pid in adj[pid]:
            if other_pid in placed:
                applicable_mates.append((mate_idx, other_pid))

        if not applicable_mates:
            # Re-enqueue if it might become solvable later
            attempt_key = (pid, frozenset(placed.keys()))
            if attempt_key not in visited_attempts:
                visited_attempts.add(attempt_key)
                queue.append(pid)
            continue

        # Place the part: start from unplaced copy
        shape = part_shapes[pid].copy()
        original_com = _center_of_mass(shape)

        # Sort mates: coaxial first, then coincident, then distance
        type_order = {"coaxial": 0, "coincident": 1, "distance": 2}
        applicable_mates.sort(key=lambda m: type_order.get(mates[m[0]]["type"], 9))

        for mate_idx, other_pid in applicable_mates:
            mate = mates[mate_idx]
            mtype = mate["type"]
            fixed_shape = placed[other_pid]

            # Determine which side is fixed vs moving
            if mate["part1"] == other_pid:
                fixed_ref = mate["face1"]
                moving_ref = mate["face2"]
            else:
                fixed_ref = mate["face2"]
                moving_ref = mate["face1"]

            try:
                _, fixed_info = select_face(fixed_shape, fixed_ref)
                _, moving_info = select_face(shape, moving_ref)
            except Exception as e:
                log(f"[MATE] Warning: face selection failed for mate {mate_idx} ({mtype}): {e}")
                continue

            if mtype == "coaxial":
                _apply_coaxial(shape, fixed_info, moving_info)
                log(f"[MATE] Applied coaxial: {other_pid} ↔ {pid}")

            elif mtype == "coincident":
                _apply_coincident(shape, fixed_info, moving_info)
                log(f"[MATE] Applied coincident: {other_pid} ↔ {pid}")

            elif mtype == "distance":
                dist_val = float(mate.get("value", 0))
                _apply_distance(shape, fixed_info, moving_info, dist_val)
                log(f"[MATE] Applied distance({dist_val}): {other_pid} ↔ {pid}")

            else:
                log(f"[MATE] Warning: unknown mate type '{mtype}', skipping")

        _check_overconstraint(shape, original_com, pid)
        placed[pid] = shape
        log(f"[MATE] Placed '{pid}' via mates")

        # Enqueue newly reachable parts
        for mate_idx, other_pid in adj[pid]:
            if other_pid not in placed:
                queue.append(other_pid)

    # Check all mate-referenced parts are placed
    mate_parts = set()
    for m in mates:
        mate_parts.add(m["part1"])
        mate_parts.add(m["part2"])

    unplaced = mate_parts - set(placed.keys())
    if unplaced:
        log(f"[MATE] Warning: could not place parts: {unplaced} (disconnected from anchors)")

    return placed
