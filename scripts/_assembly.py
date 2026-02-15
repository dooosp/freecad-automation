"""
Assembly pipeline for FreeCAD automation.
Builds multi-part assemblies from TOML config with per-part shapes/operations
and assembly-level placement (position + rotation).
"""

import math
import FreeCAD
import Part
from FreeCAD import Vector

from _shapes import make_shape, boolean_op, apply_fillet, apply_chamfer, circular_pattern, get_metadata


def _build_single_part(part_config):
    """
    Build one part from its shapes + operations config.
    Returns the final Part.Shape.
    Reuses the same pipeline as create_model.py Phase 1+2.
    """
    shapes = {}

    for i, spec in enumerate(part_config.get("shapes", [])):
        sid = spec.get("id", f"shape_{i}")
        spec["id"] = sid  # ensure id exists for downstream
        shapes[sid] = make_shape(spec)

    for op_spec in part_config.get("operations", []):
        op = op_spec["op"]

        if op in ("fuse", "cut", "common"):
            base = shapes[op_spec["base"]]
            tool_ref = op_spec["tool"]
            if isinstance(tool_ref, str):
                tool = shapes[tool_ref]
            elif isinstance(tool_ref, dict):
                tool = make_shape(tool_ref)
            else:
                raise ValueError(f"Invalid tool reference: {tool_ref}")
            result = boolean_op(op, base, tool)
            result_id = op_spec.get("result", op_spec["base"])
            shapes[result_id] = result

        elif op == "fillet":
            target = shapes[op_spec["target"]]
            result = apply_fillet(target, op_spec["radius"], op_spec.get("edges"))
            shapes[op_spec.get("result", op_spec["target"])] = result

        elif op == "chamfer":
            target = shapes[op_spec["target"]]
            result = apply_chamfer(target, op_spec["size"], op_spec.get("edges"))
            shapes[op_spec.get("result", op_spec["target"])] = result

        elif op == "circular_pattern":
            target = shapes[op_spec["target"]]
            result = circular_pattern(
                target,
                op_spec.get("axis", [0, 0, 1]),
                op_spec.get("center", [0, 0, 0]),
                op_spec["count"],
                op_spec.get("angle", 360),
                op_spec.get("include_original", True),
            )
            shapes[op_spec.get("result", op_spec["target"])] = result

        else:
            raise ValueError(f"Unknown operation: {op}")

    if not shapes:
        raise ValueError(
            f"Part '{part_config.get('id', 'unknown')}' has no shapes defined"
        )

    # Determine final shape
    final_name = part_config.get("final", list(shapes.keys())[-1])
    return shapes[final_name]


def _apply_placement(shape, placement):
    """Apply position and rotation to a shape (in-place mutation)."""
    pos = placement.get("position", [0, 0, 0])
    rot = placement.get("rotation")

    if pos != [0, 0, 0]:
        shape.translate(Vector(*pos))

    if rot:
        center = Vector(*pos)
        if len(rot) >= 4:
            # [axis_x, axis_y, axis_z, angle_degrees]
            axis = Vector(rot[0], rot[1], rot[2])
            angle = rot[3]
            if axis.Length > 1e-9 and abs(angle) > 1e-9:
                shape.rotate(center, axis, angle)
        elif len(rot) == 3:
            # Euler angles [rx, ry, rz] in degrees
            if abs(rot[0]) > 1e-9:
                shape.rotate(center, Vector(1, 0, 0), rot[0])
            if abs(rot[1]) > 1e-9:
                shape.rotate(center, Vector(0, 1, 0), rot[1])
            if abs(rot[2]) > 1e-9:
                shape.rotate(center, Vector(0, 0, 1), rot[2])

    return shape


def build_assembly(config, doc):
    """
    Build a multi-part assembly.

    Config structure:
        parts: list of part definitions (each with id, shapes, operations)
        assembly.parts: list of {ref, position, rotation} placements

    Returns dict with:
        features: list of Part::Feature objects in the document
        compound: Part.Shape compound of all parts
        parts_metadata: dict of part_id → metadata
    """
    import sys

    # Phase 1: Build each part independently
    part_shapes = {}
    for part_def in config.get("parts", []):
        pid = part_def["id"]
        shape = _build_single_part(part_def)
        part_shapes[pid] = shape
        print(f"[freecad]   Part '{pid}' built", file=sys.stderr, flush=True)

    # Phase 1.5: Solve mate constraints (if any)
    assembly_config = config.get("assembly", {})
    mates = assembly_config.get("mates", [])
    solved_shapes = None

    if mates:
        from _mate_solver import solve_mates

        # Collect explicit placements (parts with position in assembly.parts)
        explicit_placements = {}
        for entry in assembly_config.get("parts", []):
            ref = entry["ref"]
            if "position" in entry:
                explicit_placements[ref] = entry

        solved_shapes = solve_mates(part_shapes, mates, explicit_placements)
        print(f"[freecad]   Solved {len(mates)} mate(s) for {len(solved_shapes)} part(s)", file=sys.stderr, flush=True)

    # Phase 2: Apply assembly placements
    placed_shapes = []
    features = []
    parts_metadata = {}

    for entry in assembly_config.get("parts", []):
        ref = entry["ref"]
        if ref not in part_shapes:
            raise ValueError(f"Assembly references unknown part: {ref}")

        if solved_shapes and ref in solved_shapes:
            # Already transformed by mate solver
            shape = solved_shapes[ref]
        else:
            shape = part_shapes[ref].copy()
            _apply_placement(shape, entry)

        # Add as Part::Feature to doc (preserves name in STEP)
        label = entry.get("label", ref)
        feat = doc.addObject("Part::Feature", label)
        feat.Shape = shape
        features.append(feat)
        placed_shapes.append(shape)

        parts_metadata[label] = get_metadata(shape)
        print(f"[freecad]   Placed '{label}'", file=sys.stderr, flush=True)

    # Include mate-solved parts not listed in assembly.parts
    if solved_shapes:
        listed_refs = {entry["ref"] for entry in assembly_config.get("parts", [])}
        for pid, shape in solved_shapes.items():
            if pid not in listed_refs:
                feat = doc.addObject("Part::Feature", pid)
                feat.Shape = shape
                features.append(feat)
                placed_shapes.append(shape)
                parts_metadata[pid] = get_metadata(shape)
                print(f"[freecad]   Placed '{pid}' (mate-only)", file=sys.stderr, flush=True)

    doc.recompute()

    # Phase 3: Create compound for export
    compound = Part.makeCompound(placed_shapes) if placed_shapes else Part.Shape()

    result = {
        "features": features,
        "compound": compound,
        "parts_metadata": parts_metadata,
    }

    # Phase 4: Kinematic motion (if joints + motion defined)
    motion_config = assembly_config.get("motion")
    joints = assembly_config.get("joints", [])
    if motion_config and joints:
        from _kinematics import solve_kinematics
        # Build placed_shapes dict from ACTUALLY PLACED shapes (not originals)
        # so anchors computed from CenterOfMass reflect assembly positions
        placed_dict = {}
        for feat in features:
            placed_dict[feat.Label] = feat.Shape
        motion_data = solve_kinematics(assembly_config, placed_dict)
        if motion_data:
            result["motion_data"] = motion_data

    return result
