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
        respond({
            "success": True,
            "file": filepath,
            "format": "stl",
            "model": {
                "points": mesh.CountPoints,
                "facets": mesh.CountFacets,
                "volume": round(mesh.Volume, 2),
                "area": round(mesh.Area, 2),
                "bounding_box": {
                    "min": list(mesh.BoundBox.getMin()),
                    "max": list(mesh.BoundBox.getMax()),
                },
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
