"""
Create a parametric model from JSON config received via stdin.
Pipeline: shapes → boolean operations → modifications → export → metadata
"""

import sys
import os

# Add scripts dir to path for local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

try:
    config = read_input()
    log(f"Creating model: {config.get('name', 'unnamed')}")

    FreeCAD = init_freecad()
    from _shapes import make_shape, boolean_op, apply_fillet, apply_chamfer, circular_pattern, get_metadata
    from _export import export_multi

    # Phase 1: Create all named shapes
    shapes = {}
    for spec in config.get("shapes", []):
        sid = spec["id"]
        shapes[sid] = make_shape(spec)
        log(f"  Shape '{sid}' created ({spec['type']})")

    # Phase 2: Apply operations
    for op_spec in config.get("operations", []):
        op = op_spec["op"]

        if op in ("fuse", "cut", "common"):
            base = shapes[op_spec["base"]]
            # Tool can be a shape reference or inline spec
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
            log(f"  Boolean '{op}' → '{result_id}'")

        elif op == "fillet":
            target = shapes[op_spec["target"]]
            radius = op_spec["radius"]
            edges = op_spec.get("edges")  # Optional: list of edge indices
            result = apply_fillet(target, radius, edges)
            result_id = op_spec.get("result", op_spec["target"])
            shapes[result_id] = result
            log(f"  Fillet r={radius} → '{result_id}'")

        elif op == "chamfer":
            target = shapes[op_spec["target"]]
            size = op_spec["size"]
            edges = op_spec.get("edges")
            result = apply_chamfer(target, size, edges)
            result_id = op_spec.get("result", op_spec["target"])
            shapes[result_id] = result
            log(f"  Chamfer s={size} → '{result_id}'")

        elif op == "circular_pattern":
            target = shapes[op_spec["target"]]
            axis = op_spec.get("axis", [0, 0, 1])
            center = op_spec.get("center", [0, 0, 0])
            count = op_spec["count"]
            angle = op_spec.get("angle", 360)
            incl = op_spec.get("include_original", True)
            result = circular_pattern(target, axis, center, count, angle, incl)
            result_id = op_spec.get("result", op_spec["target"])
            shapes[result_id] = result
            log(f"  CircularPattern x{count} → '{result_id}'")

        else:
            raise ValueError(f"Unknown operation: {op}")

    # Get final shape (last result or explicitly named)
    final_name = config.get("final", list(shapes.keys())[-1])
    final_shape = shapes[final_name]

    # Phase 3: Export
    exports = []
    export_config = config.get("export", {})
    if export_config:
        formats = export_config.get("formats", ["step"])
        directory = export_config.get("directory", ".")
        model_name = config.get("name", "model")
        exports = export_multi(final_shape, model_name, formats, directory)
        log(f"  Exported {len(exports)} format(s) to {directory}")

    # Phase 4: Build response
    metadata = get_metadata(final_shape)
    metadata["name"] = config.get("name", "unnamed")

    respond({
        "success": True,
        "model": metadata,
        "exports": exports,
    })

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
