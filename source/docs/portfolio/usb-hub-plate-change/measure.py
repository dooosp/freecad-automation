"""Fixed-case measurement of saved STEP and SVG; no project geometry modules.

Run through reproduce.mjs, which supplies {"root": "..."} on stdin. These
nominal CAD measurements are not physical inspection or manufacturing evidence.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import FreeCAD as App
import Part

LINEAR_TOL_MM = 0.00001
SVG_ROUNDING_TOL_MM = 0.03
root = Path(json.load(sys.stdin)["root"])
results = {
    "kind": "synthetic CAD measurement; not physical inspection",
    "linear_tolerance_mm": LINEAR_TOL_MM,
    "svg_rounding_tolerance_mm": SVG_ROUNDING_TOL_MM,
    "tolerance_note": "Software numeric comparison limits; not manufacturing tolerances.",
    "independence_limit": "Separate reference construction; same FreeCAD/OCC kernel as generation.",
    "freecad_version": App.Version(),
    "revisions": {},
}

for rev, hx in [("A", 130), ("B", 120)]:
    folder = root / ("rev-" + rev.lower())
    stem = "usb_hub_surrogate_" + rev
    step_path = folder / (stem + ".step")
    shape = Part.read(str(step_path))
    box = shape.BoundBox
    expected = [(12, 12), (12, 62), (hx, 12), (hx, 62)]
    holes = []
    for face in shape.Faces:
        surface = face.Surface
        if isinstance(surface, Part.Cylinder):
            holes.append({"x": surface.Center.x, "y": surface.Center.y,
                          "diameter": 2 * surface.Radius, "axis": list(surface.Axis),
                          "z_min": face.BoundBox.ZMin, "z_max": face.BoundBox.ZMax})
    holes.sort(key=lambda h: (h["x"], h["y"]))
    reference = Part.makeBox(142, 74, 4)
    for x, y in expected:
        reference = reference.cut(Part.makeCylinder(2.6, 6, App.Vector(x, y, -1)))
    difference = shape.cut(reference).Volume + reference.cut(shape).Volume
    step_checks = {
        "valid": shape.isValid(), "one_solid": len(shape.Solids) == 1,
        "bbox": all(abs(a - b) <= LINEAR_TOL_MM for a, b in zip(
            [box.XMin, box.YMin, box.ZMin, box.XLength, box.YLength, box.ZLength],
            [0, 0, 0, 142, 74, 4])),
        "holes": len(holes) == 4 and all(
            abs(h["x"] - x) <= LINEAR_TOL_MM and abs(h["y"] - y) <= LINEAR_TOL_MM
            and abs(h["diameter"] - 5.2) <= LINEAR_TOL_MM
            and abs(h["z_min"]) <= LINEAR_TOL_MM and abs(h["z_max"] - 4) <= LINEAR_TOL_MM
            and abs(abs(h["axis"][2]) - 1) <= 1e-5
            for h, (x, y) in zip(holes, expected)),
        "reference_symmetric_difference_zero": difference == 0,
    }

    svg_path = folder / (stem + "_drawing.svg")
    doc = ET.parse(svg_path).getroot()
    parents = {child: parent for parent in doc.iter() for child in parent}
    top = doc.find(".//*[@id='drawing-view-top']")
    visible = next(g for g in top if g.get("class") == "hard_visible")
    # This helper supports the current, untransformed mm drawing only. A new
    # viewport or transform must fail, rather than pass on raw local coordinates.
    coordinate_nodes = {doc, top, visible, *list(visible)}
    for element in list(coordinate_nodes):
        while element in parents:
            element = parents[element]
            coordinate_nodes.add(element)
    untransformed = all(not n.get("transform", "").strip() and not n.get("style", "").strip()
                        for n in coordinate_nodes)
    untransformed = untransformed and not any(n.tag.endswith("style") for n in doc.iter())
    view_box = [float(v) for v in doc.get("viewBox", "").split()]
    page_mm = []
    for key in ["width", "height"]:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)mm", doc.get(key, ""))
        page_mm.append(float(match.group(1)) if match else None)
    page_mapping = (len(view_box) == 4 and view_box[:2] == [0, 0]
                    and all(v is not None for v in page_mm)
                    and all(abs(a - b) <= 1e-5 and b > 0 for a, b in zip(page_mm, view_box[2:])))
    pairs, circles = [], []
    for element in visible:
        if element.tag.endswith("path"):
            path = element.get("d")
            # This fixed plate's perimeter uses line segments. Do not silently
            # treat new curved geometry as if it had the same coordinate format.
            if any(letter not in "MLZmlz" for letter in re.findall(r"[A-Za-z]", path)):
                raise ValueError("Unsupported top-view path in fixed-case measurement")
            values = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", path)]
            pairs.extend(zip(values[::2], values[1::2]))
        elif element.tag.endswith("circle"):
            circles.append([float(element.get(k)) for k in ["cx", "cy", "r"]])
    xmin, xmax = min(x for x, y in pairs), max(x for x, y in pairs)
    ymin, ymax = min(y for x, y in pairs), max(y for x, y in pairs)
    sx, sy = (xmax - xmin) / 142, (ymax - ymin) / 74
    actual = sorted([[(x - xmin) / sx, (ymax - y) / sy, 2 * radius / sx]
                     for x, y, radius in circles])
    texts = ["".join(t.itertext()) for t in doc.iter() if t.tag.endswith("text")]
    table = doc.find(".//*[@class='revision-table']")
    table_text = [] if table is None else [t for t in table.iter() if t.tag.endswith("text")]
    rev_headers = [t for t in table_text if "".join(t.itertext()) == "REV"]
    rev_values = [] if len(rev_headers) != 1 else [
        "".join(t.itertext()) for t in table_text
        if t is not rev_headers[0] and t.get("x") == rev_headers[0].get("x")]
    svg_checks = {
        "page_mm_mapping": page_mapping,
        "geometry_untransformed": untransformed,
        "scale_1_1": page_mapping and untransformed and abs(sx - 1) <= 1e-5 and abs(sy - 1) <= 1e-5,
        "holes": len(actual) == 4 and all(abs(a - b) <= SVG_ROUNDING_TOL_MM
            for h, (x, y) in zip(actual, expected) for a, b in zip(h, [x, y, 5.2])),
        "revision_table": rev_values == [rev],
        "drawing_number": "USB-SIM-" + rev in texts,
        "synthetic_notice": any("SIMULATED - NOT FOR FABRICATION" in t for t in texts),
        "center_spacing_text": str(hx - 12) in texts,
        "right_edge_to_center_text": str(142 - hx) in texts,
    }
    results["revisions"][rev] = {
        "step": str(step_path.relative_to(root)), "svg": str(svg_path.relative_to(root)),
        "bbox_mm": [box.XLength, box.YLength, box.ZLength], "solid_count": len(shape.Solids),
        "holes": holes, "volume_mm3": shape.Volume, "symmetric_difference_mm3": difference,
        "step_checks": step_checks, "svg_scale_xy": [sx, sy], "svg_holes_mm": actual,
        "svg_checks": svg_checks, "pass": all(step_checks.values()) and all(svg_checks.values()),
    }

results["pass"] = all(r["pass"] for r in results["revisions"].values())
with (root / "measurements.json").open("x", encoding="utf-8") as stream:
    json.dump(results, stream, ensure_ascii=False, indent=2)
    stream.write("\n")
print(json.dumps({"pass": results["pass"], "measurement_file": "measurements.json"}))
if not results["pass"]:
    raise RuntimeError("Saved STEP/SVG measurements failed")
