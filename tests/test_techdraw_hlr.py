"""
TechDraw HLR force-trigger test.
Try various methods to force Hidden Line Removal computation in headless mode.
"""

import sys
import os
import time

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(THIS_DIR)
sys.path.insert(0, THIS_DIR)
sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))

from _bootstrap import log, read_input, respond, respond_error, init_freecad


def run(config):
    """Run headless TechDraw HLR probing strategies and return result payload."""
    FreeCAD = init_freecad()
    import Part

    # Build bracket
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
        raise ValueError("No shapes configured for TechDraw HLR test")

    final_shape = shapes[list(shapes.keys())[-1]]
    log(f"Bracket: {len(final_shape.Faces)} faces, {len(final_shape.Edges)} edges")

    doc = FreeCAD.newDocument("HLRTest")
    feature = doc.addObject("Part::Feature", "Bracket")
    feature.Shape = final_shape
    doc.recompute()

    tests = []

    def run_test(name, fn):
        try:
            val = fn()
            tests.append({"name": name, "pass": True, "detail": val})
            log(f"  PASS: {name}")
        except Exception as e:
            tests.append({"name": name, "pass": False, "error": str(e)})
            log(f"  FAIL: {name} -> {e}")

    # Helper: create a fresh view and try to get edges
    def make_view_and_count(label, pre_fn=None, post_fn=None):
        page = doc.addObject("TechDraw::DrawPage", f"Page_{label}")
        tpl = doc.addObject("TechDraw::DrawSVGTemplate", f"Tpl_{label}")
        resource_dir = FreeCAD.getResourceDir()
        tpl_dir = os.path.join(resource_dir, "Mod", "TechDraw", "Templates")
        tpl_files = [f for f in os.listdir(tpl_dir) if "A3" in f and "blank" in f.lower()]
        if tpl_files:
            tpl.Template = os.path.join(tpl_dir, tpl_files[0])
        page.Template = tpl

        view = doc.addObject("TechDraw::DrawViewPart", f"View_{label}")
        page.addView(view)
        view.Source = [feature]
        view.Direction = FreeCAD.Vector(0, -1, 0)
        view.Scale = 1.0
        view.X = 150
        view.Y = 150
        # Enable hidden lines
        view.HardHidden = True
        view.SmoothHidden = True

        if pre_fn:
            pre_fn(doc, page, view, feature)

        doc.recompute()

        if post_fn:
            post_fn(doc, page, view, feature)

        vis = view.getVisibleEdges()
        hid = view.getHiddenEdges()
        vis_vtx = view.getVisibleVertexes()

        return {
            "visible_edges": len(vis),
            "hidden_edges": len(hid),
            "visible_vertices": len(vis_vtx),
        }

    # Strategy 1: Basic (baseline)
    def s1():
        return make_view_and_count("basic")

    run_test("S1: Basic recompute", s1)

    # Strategy 2: Multiple recomputes
    def s2():
        def post(doc, page, view, feat):
            doc.recompute()
            doc.recompute()
            doc.recompute()

        return make_view_and_count("multi_recompute", post_fn=post)

    run_test("S2: Triple recompute", s2)

    # Strategy 3: Touch + recompute
    def s3():
        def post(doc, page, view, feat):
            feat.touch()
            doc.recompute()
            view.touch()
            doc.recompute()

        return make_view_and_count("touch", post_fn=post)

    run_test("S3: Touch + recompute", s3)

    # Strategy 4: purgeTouched
    def s4():
        def post(doc, page, view, feat):
            doc.recompute()
            view.purgeTouched()
            doc.recompute()

        return make_view_and_count("purge", post_fn=post)

    run_test("S4: purgeTouched", s4)

    # Strategy 5: Check execute() method
    def s5():
        def post(doc, page, view, feat):
            if hasattr(view, "execute"):
                view.execute()
            if hasattr(view, "recompute"):
                view.recompute()
            doc.recompute()

        return make_view_and_count("execute", post_fn=post)

    run_test("S5: view.execute()", s5)

    # Strategy 6: CoarseView mode
    def s6():
        def pre(doc, page, view, feat):
            view.CoarseView = True

        return make_view_and_count("coarse", pre_fn=pre)

    run_test("S6: CoarseView=True", s6)

    # Strategy 7: Sleep then recompute
    def s7():
        def post(doc, page, view, feat):
            time.sleep(2)
            doc.recompute()

        return make_view_and_count("sleep", post_fn=post)

    run_test("S7: Sleep 2s + recompute", s7)

    # Strategy 8: Check getEdgeByIndex
    def s8():
        page = doc.addObject("TechDraw::DrawPage", "Page_idx")
        view = doc.addObject("TechDraw::DrawViewPart", "View_idx")
        page.addView(view)
        view.Source = [feature]
        view.Direction = FreeCAD.Vector(0, -1, 0)
        view.Scale = 1.0
        view.HardHidden = True
        doc.recompute()

        info = {}
        for i in range(5):
            try:
                edge = view.getEdgeByIndex(i)
                info[f"edge_{i}"] = f"{type(edge).__name__}: {edge}"
            except Exception as e:
                info[f"edge_{i}"] = f"error: {e}"
                break
        return info

    run_test("S8: getEdgeByIndex()", s8)

    # Strategy 9: Inspect view internal state
    def s9():
        page = doc.addObject("TechDraw::DrawPage", "Page_state")
        view = doc.addObject("TechDraw::DrawViewPart", "View_state")
        page.addView(view)
        view.Source = [feature]
        view.Direction = FreeCAD.Vector(0, -1, 0)
        view.Scale = 1.0
        doc.recompute()

        info = {
            "State": view.State,
            "StatusTip": getattr(view, "StatusTip", "N/A"),
            "Label": view.Label,
            "isValid": view.isValid() if hasattr(view, "isValid") else "N/A",
        }

        for prop in sorted(view.PropertiesList):
            try:
                val = getattr(view, prop)
                if isinstance(val, (str, int, float, bool)):
                    info[f"prop_{prop}"] = val
                elif isinstance(val, (list, tuple)):
                    info[f"prop_{prop}"] = f"list({len(val)})"
                else:
                    info[f"prop_{prop}"] = type(val).__name__
            except Exception:
                pass

        return info

    run_test("S9: View internal state", s9)

    # Strategy 10: Direct TechDraw projection as alternative
    def s10():
        import TechDraw
        from FreeCAD import Vector

        front = TechDraw.projectToSVG(final_shape, Vector(0, -1, 0))

        info = {"projectToSVG_len": len(front)}
        if hasattr(TechDraw, "projectEx"):
            try:
                result = TechDraw.projectEx(final_shape, Vector(0, -1, 0))
                info["projectEx_result"] = (
                    f"tuple of {len(result)}: {[type(r).__name__ for r in result]}"
                )
                for i, r in enumerate(result):
                    if hasattr(r, "Edges"):
                        info[f"projectEx[{i}]_edges"] = len(r.Edges)
                    elif isinstance(r, str):
                        info[f"projectEx[{i}]_str_len"] = len(r)
                    else:
                        info[f"projectEx[{i}]_type"] = type(r).__name__
            except Exception as e:
                info["projectEx_error"] = str(e)

        if hasattr(TechDraw, "project"):
            try:
                result = TechDraw.project(final_shape, Vector(0, -1, 0))
                info["project_result"] = f"type={type(result).__name__}"
            except Exception as e:
                info["project_error"] = str(e)

        td_fns = [a for a in dir(TechDraw) if not a.startswith("_")]
        info["TechDraw_functions"] = td_fns

        return info

    run_test("S10: TechDraw module functions", s10)

    passed = sum(1 for t in tests if t["pass"])
    summary = f"{passed}/{len(tests)} passed"
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
