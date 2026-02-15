"""
TechDraw API headless feasibility test.
Probes what TechDraw features work without GUI.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad


def run(config):
    """Run headless TechDraw capability probe and return summary payload."""
    FreeCAD = init_freecad()
    import Part

    # Build bracket model
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

    if not shapes:
        raise ValueError("No shapes configured for TechDraw test")

    final_name = config.get("final", list(shapes.keys())[-1])
    final_shape = shapes[final_name]
    log(
        f"Bracket built: {final_shape.ShapeType}, "
        f"{len(final_shape.Faces)} faces, {len(final_shape.Edges)} edges"
    )

    doc = FreeCAD.newDocument("TechDrawTest")
    feature = doc.addObject("Part::Feature", "Bracket")
    feature.Shape = final_shape
    doc.recompute()

    tests = []
    state = {}

    def run_test(name, fn):
        try:
            val = fn()
            tests.append({"name": name, "pass": True, "detail": val})
            log(f"  PASS: {name}")
        except Exception as e:
            tests.append({"name": name, "pass": False, "error": str(e)})
            log(f"  FAIL: {name} -> {e}")

    # Test 1: DrawPage creation
    def t1():
        state["page"] = doc.addObject("TechDraw::DrawPage", "Page")
        return f"type={state['page'].TypeId}"

    run_test("DrawPage creation", t1)

    # Test 2: SVG Template
    def t2():
        resource_dir = FreeCAD.getResourceDir()
        tpl_dir = os.path.join(resource_dir, "Mod", "TechDraw", "Templates")
        files = os.listdir(tpl_dir) if os.path.isdir(tpl_dir) else []
        a3 = [f for f in files if "A3" in f]
        landscape = [f for f in a3 if "Landscape" in f or "landscape" in f]
        target = landscape[0] if landscape else (a3[0] if a3 else None)
        if target:
            tpl = doc.addObject("TechDraw::DrawSVGTemplate", "Template")
            tpl.Template = os.path.join(tpl_dir, target)
            state["page"].Template = tpl
            doc.recompute()
            return f"Template: {target}"
        return f"No A3 template. Available ({len(files)}): {files[:8]}"

    run_test("SVG Template", t2)

    # Test 3: DrawViewPart (front view with HLR)
    def t3():
        v = doc.addObject("TechDraw::DrawViewPart", "FrontView")
        state["page"].addView(v)
        v.Source = [feature]
        v.Direction = FreeCAD.Vector(0, -1, 0)
        v.Scale = 1.0
        v.X = 150
        v.Y = 150
        doc.recompute()
        state["view_front"] = v
        return f"Direction={v.Direction}, Scale={v.Scale}"

    run_test("DrawViewPart (front)", t3)

    # Test 4: Inspect view properties (edge/geometry related)
    def t4():
        v = state["view_front"]
        edge_attrs = sorted(
            [
                a
                for a in dir(v)
                if any(
                    k in a.lower()
                    for k in [
                        "edge",
                        "visible",
                        "hidden",
                        "svg",
                        "geom",
                        "cosmetic",
                        "center",
                        "vertex",
                        "format",
                    ]
                )
            ]
        )
        all_props = v.PropertiesList
        interesting = [
            p
            for p in all_props
            if any(
                k in p.lower()
                for k in [
                    "edge",
                    "visible",
                    "hidden",
                    "hard",
                    "smooth",
                    "seam",
                    "iso",
                    "cosmetic",
                    "center",
                    "line",
                ]
            )
        ]
        return {"methods": edge_attrs, "properties": interesting}

    run_test("View edge/geometry attributes", t4)

    # Test 5: Try to get visible/hidden edges
    def t5():
        v = state["view_front"]
        info = {}

        for method in [
            "getVisibleEdges",
            "getHiddenEdges",
            "getEdges",
            "getVisibleLines",
            "getHiddenLines",
            "makeSvg",
            "getSVG",
            "getSvg",
        ]:
            if hasattr(v, method) and callable(getattr(v, method)):
                try:
                    result = getattr(v, method)()
                    info[method] = (
                        f"returned {type(result).__name__}, "
                        f"len={len(result) if hasattr(result, '__len__') else '?'}"
                    )
                except Exception as e:
                    info[method] = f"callable but error: {e}"
            elif hasattr(v, method):
                info[method] = f"property (not callable)"

        for prop in [
            "HardHidden",
            "SmoothVisible",
            "SeamVisible",
            "IsoVisible",
            "HardVisible",
            "SmoothHidden",
            "SeamHidden",
            "IsoHidden",
            "CoarseView",
        ]:
            if hasattr(v, prop):
                info[f"prop_{prop}"] = getattr(v, prop)

        return info

    run_test("Edge extraction methods", t5)

    # Test 6: DrawProjGroup
    def t6():
        pg = doc.addObject("TechDraw::DrawProjGroup", "ProjGroup")
        state["page"].addView(pg)
        pg.Source = [feature]
        pg.ScaleType = 0
        pg.X = 200
        pg.Y = 150
        pg.addProjection("Front")
        pg.addProjection("Top")
        pg.addProjection("Right")
        doc.recompute()
        state["proj_group"] = pg
        views_info = []
        if hasattr(pg, "Views"):
            for v in pg.Views:
                views_info.append(f"{v.Name}:{v.TypeId}")
        return f"{len(views_info)} views: {views_info}"

    run_test("DrawProjGroup (3-view)", t6)

    # Test 7: DrawViewDimension
    def t7():
        dim = doc.addObject("TechDraw::DrawViewDimension", "TestDim")
        state["page"].addView(dim)
        props = sorted(
            [
                p
                for p in dim.PropertiesList
                if any(
                    k in p.lower()
                    for k in ["type", "reference", "format", "value", "measure", "arbitrary", "over", "under"]
                )
            ]
        )
        return f"props: {props}"

    run_test("DrawViewDimension", t7)

    # Test 8: DrawViewSection
    def t8():
        sec = doc.addObject("TechDraw::DrawViewSection", "SectionA")
        state["page"].addView(sec)
        sec.BaseView = state["view_front"]
        sec.Source = [feature]
        sec.SectionOrigin = FreeCAD.Vector(50, 0, 15)
        sec.SectionNormal = FreeCAD.Vector(1, 0, 0)
        sec.X = 300
        sec.Y = 150
        doc.recompute()
        return f"type={sec.TypeId}, hasHatch={hasattr(sec, 'HatchPattern')}"

    run_test("DrawViewSection", t8)

    # Test 9: ViewObject availability
    def t9():
        try:
            vo = state["page"].ViewObject
            if vo is not None:
                return "ViewObject EXISTS (has GUI)"
            return "ViewObject is None (headless confirmed)"
        except Exception as e:
            return f"ViewObject access error: {e} (headless confirmed)"

    run_test("ViewObject check (headless?)", t9)

    # Test 10: Save FCStd + extract SVG
    def t10():
        export_dir = config.get("export", {}).get("directory", ".")
        os.makedirs(export_dir, exist_ok=True)
        fcstd_path = os.path.join(export_dir, "techdraw_test.FCStd")
        doc.saveAs(fcstd_path)
        size = os.path.getsize(fcstd_path)

        import zipfile

        info = {"fcstd_bytes": size}
        with zipfile.ZipFile(fcstd_path, "r") as z:
            names = z.namelist()
            info["files_in_zip"] = names
            svg_files = [f for f in names if f.endswith(".svg")]
            info["svg_count"] = len(svg_files)
            for sf in svg_files:
                raw = z.read(sf)
                content = raw.decode("utf-8", errors="replace")
                has_path = "<path" in content
                has_line = "<line" in content
                has_circle = "<circle" in content
                info[sf] = {
                    "bytes": len(raw),
                    "has_path": has_path,
                    "has_line": has_line,
                    "has_circle": has_circle,
                    "has_drawing_content": has_path or has_line or has_circle,
                }
                out_name = sf.replace("/", "_")
                out_path = os.path.join(export_dir, f"extracted_{out_name}")
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(content)
                info[sf]["extracted_to"] = out_path
        return info

    run_test("FCStd save + SVG extract", t10)

    # Test 11: Baseline comparison
    def t11():
        import TechDraw
        from FreeCAD import Vector

        old = TechDraw.projectToSVG(final_shape, Vector(0, -1, 0))
        return f"projectToSVG: {len(old)} chars"

    run_test("projectToSVG baseline", t11)

    passed = sum(1 for t in tests if t["pass"])
    total = len(tests)
    summary = f"{passed}/{total} passed"
    log(f"\n=== {summary} ===")

    return {"success": True, "summary": summary, "tests": tests}


def main():
    try:
        config = read_input()
        respond(run(config))
    except Exception as e:
        import traceback

        respond_error(str(e), traceback.format_exc())


if __name__ == "__main__":
    main()
