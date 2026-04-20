"""
Inspect a model file (.FCStd, .step, .stl, .brep) and extract metadata.
Input via stdin: { "file": "path/to/model.step" }
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

try:
    config = read_input()
    filepath = config["file"]

    if not os.path.exists(filepath):
        respond_error(f"File not found: {filepath}")

    log(f"Inspecting: {filepath}")
    FreeCAD = init_freecad()
    import Part
    from _shapes import get_metadata

    ext = os.path.splitext(filepath)[1].lower()

    if ext in (".step", ".stp"):
        shape = Part.read(filepath)
    elif ext in (".brep", ".brp"):
        shape = Part.read(filepath)
    elif ext == ".fcstd":
        doc = FreeCAD.openDocument(filepath)
        # Find first Part::Feature object
        shape = None
        for obj in doc.Objects:
            if hasattr(obj, "Shape") and obj.Shape.Volume > 0:
                shape = obj.Shape
                break
        if shape is None:
            respond_error("No solid shape found in .FCStd file")
        FreeCAD.closeDocument(doc.Name)
    elif ext == ".stl":
        import Mesh
        mesh = Mesh.Mesh(filepath)
        watertight = mesh.isSolid() if hasattr(mesh, "isSolid") else None
        has_non_manifolds = mesh.hasNonManifolds() if hasattr(mesh, "hasNonManifolds") else None
        non_uniform_oriented = mesh.countNonUniformOrientedFacets() if hasattr(mesh, "countNonUniformOrientedFacets") else None
        corrupted_facets = mesh.hasCorruptedFacets() if hasattr(mesh, "hasCorruptedFacets") else None
        invalid_points = mesh.hasInvalidPoints() if hasattr(mesh, "hasInvalidPoints") else None
        invalid_neighbourhood = mesh.hasInvalidNeighbourhood() if hasattr(mesh, "hasInvalidNeighbourhood") else None
        bbox = {
            "min": [
                round(mesh.BoundBox.XMin, 2),
                round(mesh.BoundBox.YMin, 2),
                round(mesh.BoundBox.ZMin, 2),
            ],
            "max": [
                round(mesh.BoundBox.XMax, 2),
                round(mesh.BoundBox.YMax, 2),
                round(mesh.BoundBox.ZMax, 2),
            ],
            "size": [
                round(mesh.BoundBox.XLength, 2),
                round(mesh.BoundBox.YLength, 2),
                round(mesh.BoundBox.ZLength, 2),
            ],
        }
        respond({
            "success": True,
            "file": filepath,
            "format": "stl",
            "model": {
                "points": mesh.CountPoints,
                "facets": mesh.CountFacets,
                "triangle_count": mesh.CountFacets,
                "volume": round(mesh.Volume, 2),
                "area": round(mesh.Area, 2),
                "watertight_or_closed": bool(watertight) if watertight is not None else None,
                "non_manifold_count": None,
                "has_non_manifolds": bool(has_non_manifolds) if has_non_manifolds is not None else None,
                "non_uniform_oriented_facet_count": non_uniform_oriented,
                "corrupted_facets": bool(corrupted_facets) if corrupted_facets is not None else None,
                "invalid_points": bool(invalid_points) if invalid_points is not None else None,
                "invalid_neighbourhood": bool(invalid_neighbourhood) if invalid_neighbourhood is not None else None,
                "bbox": bbox,
                "bounding_box": bbox,
            },
        })
    else:
        respond_error(f"Unsupported file format: {ext}")

    # For non-STL shapes
    if ext != ".stl":
        metadata = get_metadata(shape)
        metadata["file"] = filepath
        metadata["format"] = ext.lstrip(".")

        respond({
            "success": True,
            "file": filepath,
            "format": ext.lstrip("."),
            "model": metadata,
        })

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
