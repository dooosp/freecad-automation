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

    for spec in part_config.get("shapes", []):
        sid = spec["id"]
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
        # rotation: [axis_x, axis_y, axis_z, angle_degrees]
        center = Vector(*pos)
        axis = Vector(rot[0], rot[1], rot[2])
        angle = rot[3]
        shape.rotate(center, axis, angle)

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

    # Phase 2: Apply assembly placements
    assembly_config = config.get("assembly", {})
    placed_shapes = []
    features = []
    parts_metadata = {}

    for entry in assembly_config.get("parts", []):
        ref = entry["ref"]
        if ref not in part_shapes:
            raise ValueError(f"Assembly references unknown part: {ref}")

        shape = part_shapes[ref].copy()
        _apply_placement(shape, entry)

        # Add as Part::Feature to doc (preserves name in STEP)
        label = entry.get("label", ref)
        feat = doc.addObject("Part::Feature", label)
        feat.Shape = shape
        features.append(feat)
        placed_shapes.append(shape)

        parts_metadata[label] = get_metadata(shape)
        print(f"[freecad]   Placed '{label}' at {entry.get('position', [0,0,0])}", file=sys.stderr, flush=True)

    doc.recompute()

    # Phase 3: Create compound for export
    compound = Part.makeCompound(placed_shapes) if placed_shapes else Part.Shape()

    return {
        "features": features,
        "compound": compound,
        "parts_metadata": parts_metadata,
    }
