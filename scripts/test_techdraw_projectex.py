"""
Deep test of TechDraw.projectEx() and related SVG/DXF export functions.
This is the key to high-quality headless drawing generation.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

try:
    config = read_input()
    FreeCAD = init_freecad()
    import Part
    import TechDraw
    from FreeCAD import Vector

    # --- Build bracket ---
    from _shapes import make_shape, boolean_op, apply_fillet

    shapes = {}
    for spec in config.get("shapes", []):
        shapes[spec["id"]] = make_shape(spec)
    for op_spec in config.get("operations", []):
        op = op_spec["op"]
        if op in ("fuse", "cut", "common"):
            shapes[op_spec.get("result", op_spec["base"])] = boolean_op(
                op, shapes[op_spec["base"]], shapes[op_spec["tool"]]
            )
        elif op == "fillet":
            shapes[op_spec.get("result", op_spec["target"])] = apply_fillet(
                shapes[op_spec["target"]], op_spec["radius"]
            )

    final_shape = shapes[list(shapes.keys())[-1]]
    bbox = final_shape.BoundBox
    log(f"Bracket: {len(final_shape.Faces)}F, {len(final_shape.Edges)}E, "
        f"bbox {bbox.XLength:.0f}x{bbox.YLength:.0f}x{bbox.ZLength:.0f}")

    tests = []
    def run_test(name, fn):
        try:
            val = fn()
            tests.append({"name": name, "pass": True, "detail": val})
            log(f"  PASS: {name}")
        except Exception as e:
            import traceback
            tests.append({"name": name, "pass": False, "error": str(e),
                          "tb": traceback.format_exc()})
            log(f"  FAIL: {name} -> {e}")

    # --- Test 1: projectEx deep inspection ---
    EDGE_GROUPS = [
        "hard_visible", "hard_hidden", "outer_visible", "outer_hidden",
        "unknown_4", "smooth_visible", "smooth_hidden", "unknown_7",
        "iso_visible", "iso_hidden",
    ]

    def t1():
        result = TechDraw.projectEx(final_shape, Vector(0, -1, 0))
        info = {"count": len(result)}
        total_edges = 0
        for i, shape in enumerate(result):
            name = EDGE_GROUPS[i] if i < len(EDGE_GROUPS) else f"group_{i}"
            n = len(shape.Edges) if hasattr(shape, 'Edges') else 0
            total_edges += n
            if n > 0:
                # Inspect first edge geometry
                e = shape.Edges[0]
                curve_type = type(e.Curve).__name__
                info[name] = {"edges": n, "first_curve": curve_type}
                # Get all curve types
                curve_types = set(type(e.Curve).__name__ for e in shape.Edges)
                info[name]["curve_types"] = list(curve_types)
            else:
                info[name] = {"edges": 0}
        info["total_edges"] = total_edges
        return info
    run_test("projectEx deep inspect", t1)

    # --- Test 2: Convert projectEx edges to SVG manually ---
    def t2():
        result = TechDraw.projectEx(final_shape, Vector(0, -1, 0))
        svg_parts = []
        svg_parts.append('<?xml version="1.0" encoding="UTF-8"?>')
        svg_parts.append('<svg xmlns="http://www.w3.org/2000/svg" '
                         'width="200mm" height="150mm" viewBox="-60 -50 120 100">')
        svg_parts.append('<rect x="-60" y="-50" width="120" height="100" fill="white"/>')

        # Line styles per group
        styles = {
            0: 'stroke:#000;stroke-width:0.7;fill:none',            # hard visible
            1: 'stroke:#000;stroke-width:0.35;fill:none;stroke-dasharray:4,2',  # hard hidden
            5: 'stroke:#333;stroke-width:0.35;fill:none',           # smooth visible
            6: 'stroke:#666;stroke-width:0.25;fill:none;stroke-dasharray:2,2',  # smooth hidden
            8: 'stroke:#999;stroke-width:0.18;fill:none',           # iso visible
        }

        edge_counts = {}
        for i, shape in enumerate(result):
            if not hasattr(shape, 'Edges') or len(shape.Edges) == 0:
                continue
            style = styles.get(i, 'stroke:red;stroke-width:0.5;fill:none')
            svg_parts.append(f'  <g id="{EDGE_GROUPS[i]}" style="{style}">')

            count = 0
            for edge in shape.Edges:
                curve = edge.Curve
                ctype = type(curve).__name__

                if ctype == 'Line' or ctype == 'LineSegment':
                    v1 = edge.Vertexes[0].Point
                    v2 = edge.Vertexes[1].Point
                    # Project: X stays, Z becomes -Y (flip for SVG Y-down)
                    svg_parts.append(f'    <line x1="{v1.x:.2f}" y1="{-v1.z:.2f}" '
                                     f'x2="{v2.x:.2f}" y2="{-v2.z:.2f}"/>')
                    count += 1

                elif ctype == 'BSplineCurve' or ctype == 'BezierCurve':
                    # Discretize to polyline
                    points = edge.discretize(20)
                    pts_str = ' '.join(f'{p.x:.2f},{-p.z:.2f}' for p in points)
                    svg_parts.append(f'    <polyline points="{pts_str}"/>')
                    count += 1

                elif ctype == 'Circle':
                    center = curve.Center
                    radius = curve.Radius
                    # Check if full circle or arc
                    if abs(edge.LastParameter - edge.FirstParameter - 2 * 3.14159) < 0.01:
                        svg_parts.append(f'    <circle cx="{center.x:.2f}" cy="{-center.z:.2f}" '
                                         f'r="{radius:.2f}"/>')
                    else:
                        points = edge.discretize(30)
                        pts_str = ' '.join(f'{p.x:.2f},{-p.z:.2f}' for p in points)
                        svg_parts.append(f'    <polyline points="{pts_str}"/>')
                    count += 1

                elif ctype == 'Ellipse':
                    points = edge.discretize(30)
                    pts_str = ' '.join(f'{p.x:.2f},{-p.z:.2f}' for p in points)
                    svg_parts.append(f'    <polyline points="{pts_str}"/>')
                    count += 1

                else:
                    # Generic: discretize any curve
                    try:
                        points = edge.discretize(20)
                        pts_str = ' '.join(f'{p.x:.2f},{-p.z:.2f}' for p in points)
                        svg_parts.append(f'    <polyline points="{pts_str}"/>')
                        count += 1
                    except Exception:
                        pass

            svg_parts.append('  </g>')
            edge_counts[EDGE_GROUPS[i]] = count

        svg_parts.append('</svg>')
        svg_content = '\n'.join(svg_parts)

        # Save
        export_dir = config.get("export", {}).get("directory", ".")
        os.makedirs(export_dir, exist_ok=True)
        svg_path = os.path.join(export_dir, "bracket_projectex_front.svg")
        with open(svg_path, 'w') as f:
            f.write(svg_content)

        return {"svg_path": svg_path, "svg_bytes": len(svg_content),
                "edge_counts": edge_counts}
    run_test("projectEx → SVG (front view)", t2)

    # --- Test 3: All 4 views with projectEx ---
    def t3():
        directions = {
            "front": Vector(0, -1, 0),
            "top":   Vector(0, 0, -1),
            "right": Vector(1, 0, 0),
            "iso":   Vector(1, -1, 1),
        }
        info = {}
        for vname, d in directions.items():
            result = TechDraw.projectEx(final_shape, d)
            total = sum(len(s.Edges) for s in result if hasattr(s, 'Edges'))
            vis = sum(len(result[i].Edges) for i in [0, 5, 8]
                      if i < len(result) and hasattr(result[i], 'Edges'))
            hid = sum(len(result[i].Edges) for i in [1, 6, 9]
                      if i < len(result) and hasattr(result[i], 'Edges'))
            info[vname] = {"total": total, "visible": vis, "hidden": hid}
        return info
    run_test("projectEx all 4 views", t3)

    # --- Test 4: projectToDXF ---
    def t4():
        dxf_result = TechDraw.projectToDXF(final_shape, Vector(0, -1, 0))
        export_dir = config.get("export", {}).get("directory", ".")
        dxf_path = os.path.join(export_dir, "bracket_front.dxf")
        with open(dxf_path, 'w') as f:
            f.write(dxf_result)
        return {"dxf_path": dxf_path, "dxf_bytes": len(dxf_result),
                "first_100_chars": dxf_result[:100]}
    run_test("projectToDXF", t4)

    # --- Test 5: exportSVGEdges ---
    def t5():
        if not hasattr(TechDraw, 'exportSVGEdges'):
            return "exportSVGEdges not found"
        import inspect
        sig = str(inspect.signature(TechDraw.exportSVGEdges)) if hasattr(inspect, 'signature') else "?"
        # Try calling it with a shape
        try:
            svg = TechDraw.exportSVGEdges(final_shape)
            return {"signature": sig, "result_len": len(svg) if svg else 0}
        except Exception as e:
            return {"signature": sig, "error": str(e)}
    run_test("exportSVGEdges", t5)

    # --- Test 6: viewPartAsSvg and viewPartAsDxf ---
    def t6():
        info = {}
        # Create a DrawViewPart with CoarseView for headless
        doc2 = FreeCAD.newDocument("SVGExport")
        feat2 = doc2.addObject("Part::Feature", "B")
        feat2.Shape = final_shape
        page2 = doc2.addObject("TechDraw::DrawPage", "P")
        tpl = doc2.addObject("TechDraw::DrawSVGTemplate", "T")
        resource_dir = FreeCAD.getResourceDir()
        tpl_dir = os.path.join(resource_dir, "Mod", "TechDraw", "Templates")
        tpl_files = [f for f in os.listdir(tpl_dir) if "A3" in f and "blank" in f.lower()]
        if tpl_files:
            tpl.Template = os.path.join(tpl_dir, tpl_files[0])
        page2.Template = tpl

        v = doc2.addObject("TechDraw::DrawViewPart", "V")
        page2.addView(v)
        v.Source = [feat2]
        v.Direction = FreeCAD.Vector(0, -1, 0)
        v.Scale = 1.0
        v.CoarseView = True
        doc2.recompute()

        # Try viewPartAsSvg
        try:
            svg = TechDraw.viewPartAsSvg(v)
            export_dir = config.get("export", {}).get("directory", ".")
            svg_path = os.path.join(export_dir, "bracket_viewPartAsSvg.svg")
            with open(svg_path, 'w') as f:
                f.write(svg)
            info["viewPartAsSvg"] = {"bytes": len(svg), "path": svg_path,
                                      "has_path": '<path' in svg,
                                      "has_line": '<line' in svg}
        except Exception as e:
            info["viewPartAsSvg_error"] = str(e)

        # Try viewPartAsDxf
        try:
            dxf = TechDraw.viewPartAsDxf(v)
            export_dir = config.get("export", {}).get("directory", ".")
            dxf_path = os.path.join(export_dir, "bracket_viewPartAsDxf.dxf")
            with open(dxf_path, 'w') as f:
                f.write(dxf)
            info["viewPartAsDxf"] = {"bytes": len(dxf), "path": dxf_path}
        except Exception as e:
            info["viewPartAsDxf_error"] = str(e)

        return info
    run_test("viewPartAsSvg / viewPartAsDxf", t6)

    # --- Test 7: findShapeOutline ---
    def t7():
        outline = TechDraw.findShapeOutline(final_shape, 1.0, Vector(0, -1, 0))
        return {
            "type": type(outline).__name__,
            "edges": len(outline.Edges) if hasattr(outline, 'Edges') else 0,
            "wires": len(outline.Wires) if hasattr(outline, 'Wires') else 0,
        }
    run_test("findShapeOutline", t7)

    # --- Summary ---
    passed = sum(1 for t in tests if t["pass"])
    summary = f"{passed}/{len(tests)} passed"
    log(f"\n=== {summary} ===")

    respond({"success": True, "summary": summary, "tests": tests})

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
