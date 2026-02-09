"""
Export FreeCAD shapes to various formats.
Supports: STEP, STL, OBJ, BREP
"""

import os
import FreeCAD
import Part
import Mesh


def export_shape(shape, filepath, fmt=None):
    """
    Export shape to file.
    fmt: 'step', 'stl', 'obj', 'brep' (auto-detected from extension if not given)
    Returns: dict with format, path, size_bytes
    """
    if fmt is None:
        ext = os.path.splitext(filepath)[1].lower()
        fmt = ext.lstrip(".")

    fmt = fmt.lower()

    # Ensure directory exists
    dirpath = os.path.dirname(filepath)
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)

    if fmt in ("step", "stp"):
        Part.export([shape_to_feature(shape)], filepath)
    elif fmt == "stl":
        mesh = Mesh.Mesh(shape.tessellate(0.1))
        mesh.write(filepath)
    elif fmt == "obj":
        mesh = Mesh.Mesh(shape.tessellate(0.1))
        mesh.write(filepath)
    elif fmt in ("brep", "brp"):
        shape.exportBrep(filepath)
    else:
        raise ValueError(f"Unsupported export format: {fmt}")

    size = os.path.getsize(filepath) if os.path.exists(filepath) else 0

    return {
        "format": fmt,
        "path": filepath,
        "size_bytes": size,
    }


def export_multi(shape, name, formats, directory):
    """
    Export shape to multiple formats.
    Returns list of export result dicts.
    """
    results = []
    for fmt in formats:
        ext = fmt if fmt != "step" else "step"
        filepath = os.path.join(directory, f"{name}.{ext}")
        results.append(export_shape(shape, filepath, fmt))
    return results


def shape_to_feature(shape):
    """Wrap a TopoShape in a Part::Feature for export compatibility."""
    doc = FreeCAD.newDocument("ExportTemp")
    feature = doc.addObject("Part::Feature", "ExportShape")
    feature.Shape = shape
    doc.recompute()
    return feature
