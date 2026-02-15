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
    model_name = config.get("name", "unnamed")
    log(f"Creating model: {model_name}")

    FreeCAD = init_freecad()
    import Part
    from _shapes import make_shape, boolean_op, apply_fillet, apply_chamfer, apply_shell, circular_pattern, get_metadata
    from _export import export_multi, export_assembly, export_assembly_parts

    # Detect assembly mode: "parts" key + "assembly" key present
    is_assembly = "parts" in config and "assembly" in config

    if is_assembly:
        # ── Assembly mode ──
        from _assembly import build_assembly

        log("Assembly mode detected")
        doc = FreeCAD.newDocument("Assembly")

        assembly_result = build_assembly(config, doc)
        features = assembly_result["features"]
        compound = assembly_result["compound"]
        parts_metadata = assembly_result["parts_metadata"]

        # Export
        exports = []
        part_files = []
        export_config = config.get("export", {})
        if export_config:
            formats = export_config.get("formats", ["step"])
            directory = export_config.get("directory", ".")
            exports = export_assembly(features, compound, model_name, formats, directory)
            log(f"  Exported {len(exports)} format(s) to {directory}")

            # Per-part STL export for viewer
            if export_config.get("per_part_stl"):
                part_files = export_assembly_parts(features, model_name, directory)
                # Inject material from parts config into part_files for viewer PBR
                parts_config = {p["id"]: p for p in config.get("parts", [])}
                for pf in part_files:
                    pid = pf["id"]
                    if pid in parts_config:
                        shapes = parts_config[pid].get("shapes", [])
                        pf["material"] = shapes[0].get("material") if shapes else None
                log(f"  Exported {len(part_files)} per-part STL(s)")

        # Build response
        compound_meta = get_metadata(compound)
        compound_meta["name"] = model_name

        response = {
            "success": True,
            "model": compound_meta,
            "assembly": {
                "part_count": len(features),
                "parts": parts_metadata,
            },
            "exports": exports,
        }
        if part_files:
            response["assembly"]["part_files"] = part_files

        if assembly_result.get("motion_data"):
            response["motion_data"] = assembly_result["motion_data"]

        respond(response)

    else:
        # ── Legacy single-part mode ──
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
                edges = op_spec.get("edges")
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

            elif op == "shell":
                target = shapes[op_spec["target"]]
                thickness = op_spec["thickness"]
                face_indices = op_spec.get("faces")
                result = apply_shell(target, thickness, face_indices)
                result_id = op_spec.get("result", op_spec["target"])
                shapes[result_id] = result
                log(f"  Shell t={thickness} → '{result_id}'")

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

        if not shapes:
            raise ValueError("No shapes defined for single-part model")

        # Get final shape (last result or explicitly named)
        final_name = config.get("final", list(shapes.keys())[-1])
        final_shape = shapes[final_name]

        # Phase 3: Export
        exports = []
        export_config = config.get("export", {})
        if export_config:
            formats = export_config.get("formats", ["step"])
            directory = export_config.get("directory", ".")
            exports = export_multi(final_shape, model_name, formats, directory)
            log(f"  Exported {len(exports)} format(s) to {directory}")

        # Phase 4: Build response
        metadata = get_metadata(final_shape)
        metadata["name"] = model_name

        respond({
            "success": True,
            "model": metadata,
            "exports": exports,
        })

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
