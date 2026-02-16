"""
FEM (Finite Element Method) helper library for FreeCAD automation.
Handles: material presets, Gmsh meshing, constraints, CalculiX solver, result extraction.
"""

import sys
import FreeCAD
import Part
import ObjectsFem
from _bootstrap import log

# --- Material Presets ---

MATERIALS = {
    "steel": {
        "Name": "Steel",
        "YoungsModulus": "210000 MPa",
        "PoissonRatio": "0.30",
        "Density": "7850 kg/m^3",
        "YieldStrength": 235,
    },
    "aluminum": {
        "Name": "Aluminum",
        "YoungsModulus": "70000 MPa",
        "PoissonRatio": "0.33",
        "Density": "2700 kg/m^3",
        "YieldStrength": 270,
    },
    "titanium": {
        "Name": "Titanium",
        "YoungsModulus": "110000 MPa",
        "PoissonRatio": "0.34",
        "Density": "4500 kg/m^3",
        "YieldStrength": 880,
    },
    "copper": {
        "Name": "Copper",
        "YoungsModulus": "120000 MPa",
        "PoissonRatio": "0.34",
        "Density": "8900 kg/m^3",
        "YieldStrength": 70,
    },
}


def wrap_shape_as_feature(doc, shape, name="Body"):
    """Wrap a TopoShape into a Part::Feature so FEM can reference its faces."""
    feat = doc.addObject("Part::Feature", name)
    feat.Shape = shape
    doc.recompute()
    return feat


def setup_material(doc, analysis, material_config):
    """
    Create material object from preset name or custom dict.
    material_config: {"preset": "steel"} or {"Name": "Custom", "YoungsModulus": "200000 MPa", ...}
    Returns (material_obj, yield_strength).
    """
    mat = ObjectsFem.makeMaterialSolid(doc, "Material")
    analysis.addObject(mat)

    if "preset" in material_config:
        preset_name = material_config["preset"].lower()
        if preset_name not in MATERIALS:
            raise ValueError(f"Unknown material preset: {preset_name}. Available: {list(MATERIALS.keys())}")
        preset = MATERIALS[preset_name]
        mat.Material = {
            "Name": preset["Name"],
            "YoungsModulus": preset["YoungsModulus"],
            "PoissonRatio": preset["PoissonRatio"],
            "Density": preset["Density"],
        }
        yield_strength = preset["YieldStrength"]
        log(f"[FEM] Material: {preset['Name']} (preset)")
    else:
        mat.Material = {
            "Name": material_config.get("Name", "Custom"),
            "YoungsModulus": material_config.get("YoungsModulus", "210000 MPa"),
            "PoissonRatio": material_config.get("PoissonRatio", "0.30"),
            "Density": material_config.get("Density", "7850 kg/m^3"),
        }
        yield_strength = material_config.get("YieldStrength", 235)
        log(f"[FEM] Material: {material_config.get('Name', 'Custom')} (custom)")

    return mat, yield_strength


def setup_mesh(doc, analysis, geom_obj, mesh_config):
    """
    Create Gmsh mesh on geometry object.
    mesh_config: {"max_element_size": 10.0, "min_element_size": 2.0, "element_order": "2nd"}
    """
    mesh_obj = ObjectsFem.makeMeshGmsh(doc, "FEMMesh")
    analysis.addObject(mesh_obj)

    mesh_obj.Shape = geom_obj
    mesh_obj.CharacteristicLengthMax = mesh_config.get("max_element_size", 10.0)
    mesh_obj.CharacteristicLengthMin = mesh_config.get("min_element_size", 2.0)

    order = mesh_config.get("element_order", "2nd")
    if order == "1st":
        mesh_obj.ElementOrder = "1st"
    else:
        mesh_obj.ElementOrder = "2nd"

    doc.recompute()

    # Run Gmsh mesher
    from femmesh.gmshtools import GmshTools
    gmsh_tools = GmshTools(mesh_obj)
    error = gmsh_tools.create_mesh()
    if error:
        raise RuntimeError(f"Gmsh meshing failed: {error}")

    doc.recompute()

    nodes = mesh_obj.FemMesh.NodeCount
    elements = mesh_obj.FemMesh.VolumeCount
    log(f"[FEM] Mesh: {nodes} nodes, {elements} elements ({mesh_obj.ElementOrder} order)")

    return mesh_obj


def add_constraint(doc, analysis, geom_obj, constraint_config):
    """
    Add a single constraint to the analysis.
    constraint_config: {"type": "fixed"|"force"|"pressure"|"displacement", "faces": ["Face1"], ...}
    """
    ctype = constraint_config["type"].lower()
    faces = constraint_config.get("faces", [])
    refs = [(geom_obj, face) for face in faces]

    if ctype == "fixed":
        con = ObjectsFem.makeConstraintFixed(doc, "Fixed")
        con.References = refs
        analysis.addObject(con)
        log(f"[FEM] Constraint: Fixed on {faces}")

    elif ctype == "force":
        con = ObjectsFem.makeConstraintForce(doc, "Force")
        con.References = refs
        con.Force = constraint_config.get("magnitude", 1000.0)
        direction = constraint_config.get("direction", [0, 0, -1])
        # Force direction via a reference edge/face or direct setting
        con.Direction = (geom_obj, [])
        con.Reversed = False
        # Set direction components
        con.DirectionVector = FreeCAD.Vector(*direction)
        # Reverse if needed (FreeCAD uses reference direction, flip if opposite)
        analysis.addObject(con)
        log(f"[FEM] Constraint: Force {con.Force}N dir={direction} on {faces}")

    elif ctype == "pressure":
        con = ObjectsFem.makeConstraintPressure(doc, "Pressure")
        con.References = refs
        con.Pressure = constraint_config.get("magnitude", 1.0)  # MPa
        con.Reversed = constraint_config.get("reversed", False)
        analysis.addObject(con)
        log(f"[FEM] Constraint: Pressure {con.Pressure} MPa on {faces}")

    elif ctype == "displacement":
        con = ObjectsFem.makeConstraintDisplacement(doc, "Displacement")
        con.References = refs
        for axis in ("xDisplacement", "yDisplacement", "zDisplacement"):
            if axis in constraint_config:
                setattr(con, axis, constraint_config[axis])
                setattr(con, axis.replace("Displacement", "Free"), False)
        analysis.addObject(con)
        log(f"[FEM] Constraint: Displacement on {faces}")

    else:
        raise ValueError(f"Unknown constraint type: {ctype}")

    return con


def setup_solver(doc, analysis, solver_config):
    """
    Create and configure CalculiX solver.
    solver_config: {"analysis_type": "static"|"frequency", "num_modes": 10}
    """
    solver = ObjectsFem.makeSolverCalculiXCcxTools(doc, "Solver")
    analysis.addObject(solver)

    analysis_type = solver_config.get("analysis_type", "static")
    if analysis_type == "static":
        solver.AnalysisType = "static"
    elif analysis_type == "frequency":
        solver.AnalysisType = "frequency"
        solver.EigenmodesCount = solver_config.get("num_modes", 10)
    else:
        raise ValueError(f"Unknown analysis type: {analysis_type}")

    solver.GeometricalNonlinearity = "linear"
    solver.IterationsControlParameterTimeUse = False

    doc.recompute()
    log(f"[FEM] Solver: CalculiX ({analysis_type})")
    return solver


def run_solver(doc, analysis, solver):
    """Execute the CalculiX solver. Blocks until completion."""
    import io
    from femtools import ccxtools

    doc.recompute()

    # ccxtools prints debug info to stdout which pollutes JSON protocol.
    # Redirect stdout to stderr during solver operations.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        fea = ccxtools.FemToolsCcx(analysis=analysis, solver=solver)
        fea.update_objects()
        fea.setup_working_dir()
        fea.setup_ccx()

        log("[FEM] Writing input file...")
        message = fea.write_inp_file()
        if message:
            log(f"[FEM] Input file note: {message}")

        log("[FEM] Running CalculiX solver...")
        fea.ccx_run()
        log("[FEM] Solver finished, loading results...")
        fea.load_results()
    finally:
        sys.stdout = real_stdout

    doc.recompute()
    return True


def extract_results(analysis, yield_strength=235):
    """
    Extract FEM results from analysis.
    Returns dict with displacement and von Mises stress statistics.
    """
    result_obj = None
    for obj in analysis.Group:
        if obj.isDerivedFrom("Fem::FemResultObject"):
            result_obj = obj
            break

    if result_obj is None:
        raise RuntimeError("No FEM result object found in analysis")

    # Von Mises stress
    von_mises = result_obj.vonMises
    max_vm = max(von_mises) if von_mises else 0.0
    min_vm = min(von_mises) if von_mises else 0.0
    max_vm_node = von_mises.index(max_vm) + 1 if von_mises else 0

    # Displacement magnitudes
    disp = result_obj.DisplacementLengths
    max_disp = max(disp) if disp else 0.0
    min_disp = min(disp) if disp else 0.0
    max_disp_node = disp.index(max_disp) + 1 if disp else 0

    # Safety factor (yield / max von Mises)
    safety_factor = round(yield_strength / max_vm, 2) if max_vm > 0 else float('inf')

    log(f"[FEM] Results: max disp={max_disp:.4f}mm, max VM={max_vm:.2f}MPa, SF={safety_factor}")

    return {
        "displacement": {
            "max": round(max_disp, 6),
            "min": round(min_disp, 6),
            "max_node": max_disp_node,
        },
        "von_mises": {
            "max": round(max_vm, 4),
            "min": round(min_vm, 4),
            "max_node": max_vm_node,
        },
        "safety_factor": safety_factor,
        "node_count": len(von_mises) if von_mises else 0,
    }
