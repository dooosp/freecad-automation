"""
FEM structural analysis pipeline.
Pipeline: shapes → boolean ops → FEM setup → Gmsh mesh → CalculiX solve → results
"""

import sys
import os
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

try:
    config = read_input()
    model_name = config.get("name", "unnamed")
    log(f"FEM Analysis: {model_name}")

    FreeCAD = init_freecad()
    import Part
    import ObjectsFem
    from _shapes import make_shape, boolean_op, apply_fillet, apply_chamfer, get_metadata
    from _export import export_multi
    from _fem import (
        wrap_shape_as_feature, setup_material, setup_mesh,
        add_constraint, setup_solver, run_solver, extract_results,
    )

    # Phase 1: Create shapes (reuse Phase 1 logic)
    shapes = {}
    for spec in config.get("shapes", []):
        sid = spec["id"]
        shapes[sid] = make_shape(spec)
        log(f"  Shape '{sid}' ({spec['type']})")

    # Phase 2: Boolean operations
    for op_spec in config.get("operations", []):
        op = op_spec["op"]
        if op in ("fuse", "cut", "common"):
            base = shapes[op_spec["base"]]
            tool_ref = op_spec["tool"]
            tool = shapes[tool_ref] if isinstance(tool_ref, str) else make_shape(tool_ref)
            result = boolean_op(op, base, tool)
            result_id = op_spec.get("result", op_spec["base"])
            shapes[result_id] = result
            log(f"  Boolean '{op}' -> '{result_id}'")
        elif op == "fillet":
            target = shapes[op_spec["target"]]
            shapes[op_spec.get("result", op_spec["target"])] = apply_fillet(
                target, op_spec["radius"], op_spec.get("edges")
            )
        elif op == "chamfer":
            target = shapes[op_spec["target"]]
            shapes[op_spec.get("result", op_spec["target"])] = apply_chamfer(
                target, op_spec["size"], op_spec.get("edges")
            )

    # Get final shape
    final_name = config.get("final", list(shapes.keys())[-1])
    final_shape = shapes[final_name]
    model_meta = get_metadata(final_shape)
    model_meta["name"] = model_name

    # Phase 3: FEM Analysis
    fem_config = config.get("fem", {})
    if not fem_config:
        respond_error("No [fem] section in config")

    # Create a new document and save it (solver needs working directory)
    doc = FreeCAD.newDocument("FEMAnalysis")

    # Wrap shape as Part::Feature for FEM references
    geom_obj = wrap_shape_as_feature(doc, final_shape, "Body")

    # Create analysis container
    analysis = ObjectsFem.makeAnalysis(doc, "Analysis")

    # Material
    material_config = fem_config.get("material", {"preset": "steel"})
    mat_obj, yield_strength = setup_material(doc, analysis, material_config)

    # Save document (solver needs a file path for working directory)
    export_config = config.get("export", {})
    export_dir = export_config.get("directory", ".")
    os.makedirs(export_dir, exist_ok=True)
    fcstd_path = os.path.join(export_dir, f"{model_name}.FCStd")
    doc.saveAs(fcstd_path)
    log(f"  Saved: {fcstd_path}")

    # Mesh
    mesh_config = fem_config.get("mesh", {})
    mesh_obj = setup_mesh(doc, analysis, geom_obj, mesh_config)

    # Constraints
    for con_config in fem_config.get("constraints", []):
        add_constraint(doc, analysis, geom_obj, con_config)

    # Solver
    solver_config = {
        "analysis_type": fem_config.get("analysis_type", "static"),
    }
    if "num_modes" in fem_config:
        solver_config["num_modes"] = fem_config["num_modes"]
    solver = setup_solver(doc, analysis, solver_config)

    # Run solver
    doc.recompute()
    doc.save()
    run_solver(doc, analysis, solver)

    # Extract results
    results = extract_results(analysis, yield_strength)

    # Save document with results
    doc.save()

    # Phase 4: Export geometry (optional)
    exports = []
    if export_config:
        formats = export_config.get("formats", [])
        if formats:
            directory = export_config.get("directory", ".")
            exports = export_multi(final_shape, model_name, formats, directory)
            log(f"  Exported {len(exports)} format(s)")

    # Build material info for response
    mat_data = mat_obj.Material
    mat_info = {
        "name": mat_data.get("Name", "Unknown"),
        "youngs_modulus": float(mat_data.get("YoungsModulus", "0 MPa").split()[0]),
        "yield_strength": yield_strength,
    }

    respond({
        "success": True,
        "model": model_meta,
        "fem": {
            "analysis_type": fem_config.get("analysis_type", "static"),
            "material": mat_info,
            "mesh": {
                "nodes": mesh_obj.FemMesh.NodeCount,
                "elements": mesh_obj.FemMesh.VolumeCount,
                "element_type": "Tet10" if mesh_obj.ElementOrder == "2nd" else "Tet4",
            },
            "results": results,
        },
        "exports": exports,
    })

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
