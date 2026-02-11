"""
Generate engineering drawing (4-view orthographic projection) from model config.
Pipeline: stdin JSON -> 3D build -> TechDraw.projectEx -> ISO 128 SVG -> BOM -> stdout JSON

Uses TechDraw.projectEx() for edge classification into visible/hidden/smooth/iso groups
and renders ISO 128 compliant line styles on A3 landscape layout.
"""

import sys
import os
import math
from datetime import date as _date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

# -- A3 Landscape Layout (mm) ------------------------------------------------
PAGE_W, PAGE_H = 420, 297
MARGIN = 15
TITLE_H = 35
DRAW_W = PAGE_W - 2 * MARGIN
DRAW_H = PAGE_H - 2 * MARGIN - TITLE_H
CELL_W, CELL_H = DRAW_W / 2, DRAW_H / 2

# Cell centers for 2x2 view grid (3rd angle projection)
#   [ TOP  ] [ ISO   ]
#   [FRONT ] [ RIGHT ]
VIEW_CELLS = {
    "top":   (MARGIN + CELL_W * 0.5, MARGIN + CELL_H * 0.5),
    "iso":   (MARGIN + CELL_W * 1.5, MARGIN + CELL_H * 0.5),
    "front": (MARGIN + CELL_W * 0.5, MARGIN + CELL_H * 1.5),
    "right": (MARGIN + CELL_W * 1.5, MARGIN + CELL_H * 1.5),
}

VIEW_DIRECTIONS = {
    "front": (0, -1, 0),
    "top":   (0, 0, -1),
    "right": (1, 0, 0),
    "iso":   (1, -1, 1),
}

# -- ISO 128 Line Styles per projectEx group ----------------------------------
# projectEx returns 10 groups: [0]hard_vis [1]hard_hid [2]outer_vis [3]outer_hid
#   [4]- [5]smooth_vis [6]smooth_hid [7]- [8]iso_vis [9]iso_hid
EDGE_NAMES = [
    "hard_visible", "hard_hidden", "outer_visible", "outer_hidden",
    "_4", "smooth_visible", "smooth_hidden", "_7", "iso_visible", "iso_hidden",
]

# group_index -> (stroke-width, color, dash-array|None)
LINE_STYLES = {
    0: ("0.7",  "#000", None),
    1: ("0.35", "#000", "3,1.5"),
    2: ("0.5",  "#000", None),
    3: ("0.25", "#444", "2,1"),
    5: ("0.35", "#000", None),
    6: ("0.25", "#555", "2,1"),
    8: ("0.18", "#888", None),
    9: ("0.13", "#aaa", "1,1"),
}

RENDER_ORDER = [9, 6, 3, 1, 8, 5, 2, 0]


# -- Coordinate Extraction (projectEx returns XY-plane shapes, Z=0 always) ----
# projectEx projects 3D shape onto a 2D plane and returns the result in the XY
# plane with Z=0. The mapping from projection (p.x, p.y) to drawing (u, v) is
# view-specific and was empirically determined by logging actual coordinates.
#
# 3rd angle projection ensures:
#   - Front/Top share the same horizontal axis (model X increasing right)
#   - Front/Right share the same vertical axis (model Z increasing up)
#   - Top vertical: model Y increasing up (away from front view)
#   - Right horizontal: model Y increasing right (front of object at left)

VIEW_UV_MAP = {
    "front": ("y", +1, "x", -1),   # projY=modelX -> u, -projX=modelZ -> v
    "top":   ("x", -1, "y", +1),   # -projX=modelX -> u, projY=modelY -> v
    "right": ("y", -1, "x", +1),   # -projY=modelY -> u, projX=modelZ -> v
}


def _extract_fn(view_name, sample_pts=None):
    """Return fn(FreeCAD.Vector) -> (u, v) for the given view.
    u = horizontal, v = vertical (positive = up in drawing).
    projectEx always returns Z=0; real 2D data is in (p.x, p.y)."""
    if view_name in VIEW_UV_MAP:
        ax1, s1, ax2, s2 = VIEW_UV_MAP[view_name]
        return lambda p, _a1=ax1, _s1=s1, _a2=ax2, _s2=s2: (
            _s1 * getattr(p, _a1), _s2 * getattr(p, _a2))
    # Iso and other views: use projection XY directly (Z is always 0)
    return lambda p: (p.x, p.y)


# -- Edge Projection -----------------------------------------------------------

def project_view(shape, direction, view_name):
    """Project shape with TechDraw.projectEx() and classify edges.
    Returns: (groups, bounds, circle_centers)
      groups: {group_idx: [{"pts": [(u,v),...], "circ": (cu,cv,r)|None}, ...]}
      bounds: (u_min, v_min, u_max, v_max)
      circle_centers: [(u,v), ...]
    """
    import TechDraw
    from FreeCAD import Vector

    result = TechDraw.projectEx(shape, Vector(*direction))

    # Pass 1: collect raw 3D edge data
    raw = []
    all_pts = []

    for gi, grp in enumerate(result):
        if gi not in LINE_STYLES:
            continue
        if not hasattr(grp, 'Edges') or not grp.Edges:
            continue
        for edge in grp.Edges:
            ctype = type(edge.Curve).__name__
            pts = None
            center = None
            is_circ = False
            radius = 0.0

            if ctype in ('Line', 'LineSegment'):
                pts = [edge.Vertexes[0].Point, edge.Vertexes[1].Point]
            elif ctype == 'Circle':
                center = edge.Curve.Center
                radius = edge.Curve.Radius
                is_circ = abs(edge.LastParameter - edge.FirstParameter - 2 * math.pi) < 0.01
                pts = list(edge.discretize(30))
            else:
                try:
                    pts = list(edge.discretize(30))
                except Exception:
                    continue

            if pts:
                all_pts.extend(pts)
                raw.append((gi, pts, center, is_circ, radius))

    if not raw:
        return {}, (0, 0, 1, 1), []

    # Determine 2D extraction
    ext = _extract_fn(view_name, all_pts)

    # Pass 2: convert to 2D
    groups = {}
    all_2d = []
    centers = []

    for gi, pts_3d, center_3d, is_circ, radius in raw:
        pts_2d = [ext(p) for p in pts_3d]
        all_2d.extend(pts_2d)
        entry = {"pts": pts_2d}
        if is_circ and center_3d:
            c = ext(center_3d)
            entry["circ"] = (c[0], c[1], radius)
            centers.append(c)
        groups.setdefault(gi, []).append(entry)

    us, vs = zip(*all_2d)
    bounds = (min(us), min(vs), max(us), max(vs))
    return groups, bounds, centers


# -- SVG Rendering -------------------------------------------------------------

def render_view_svg(vname, groups, bounds, centers, cx, cy, scale):
    """Render one view's edges as SVG, centered at (cx, cy) on the page."""
    out = []
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0 + u1) / 2, (v0 + v1) / 2

    def pg(u, v):
        return cx + (u - bcx) * scale, cy - (v - bcy) * scale

    for gi in RENDER_ORDER:
        if gi not in groups:
            continue
        w, color, dash = LINE_STYLES[gi]
        attr = f'stroke="{color}" stroke-width="{w}" fill="none"'
        if dash:
            attr += f' stroke-dasharray="{dash}"'
        gn = EDGE_NAMES[gi] if gi < len(EDGE_NAMES) else f"g{gi}"
        out.append(f'<g class="{gn}" {attr}>')

        for e in groups[gi]:
            if "circ" in e:
                cu, cv, r = e["circ"]
                px, py = pg(cu, cv)
                out.append(f'  <circle cx="{px:.2f}" cy="{py:.2f}" r="{r*scale:.2f}"/>')
            else:
                pts = e["pts"]
                if len(pts) < 2:
                    continue
                pp = [pg(u, v) for u, v in pts]
                d = f'M{pp[0][0]:.2f},{pp[0][1]:.2f}'
                for x, y in pp[1:]:
                    d += f'L{x:.2f},{y:.2f}'
                out.append(f'  <path d="{d}"/>')

        out.append('</g>')

    # Center lines for circular features
    if centers:
        arm = min(CELL_W, CELL_H) * 0.08
        out.append('<g class="centerlines" stroke="#d00" stroke-width="0.18" '
                   'fill="none" stroke-dasharray="6,2,1,2">')
        for cu, cv in centers:
            px, py = pg(cu, cv)
            out.append(f'  <line x1="{px-arm:.2f}" y1="{py:.2f}" '
                       f'x2="{px+arm:.2f}" y2="{py:.2f}"/>')
            out.append(f'  <line x1="{px:.2f}" y1="{py-arm:.2f}" '
                       f'x2="{px:.2f}" y2="{py+arm:.2f}"/>')
        out.append('</g>')

    # View label
    lx = cx - CELL_W / 2 + 3
    ly = cy - CELL_H / 2 + 10
    out.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-family="monospace" '
               f'font-size="3.5" fill="#666">{vname.upper()}</text>')

    return '\n'.join(out)


# -- A3 Drawing Composition ---------------------------------------------------

def compose_drawing(views_svg, name, bom, scale, bbox, mates=None, tol_specs=None):
    """Assemble full A3 landscape SVG with views, title block, BOM, legend, GD&T."""
    p = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" '
             f'width="{PAGE_W}mm" height="{PAGE_H}mm" viewBox="0 0 {PAGE_W} {PAGE_H}">')
    p.append(f'<rect width="{PAGE_W}" height="{PAGE_H}" fill="white"/>')

    # ISO 5457 double border
    bw, bh = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN
    p.append(f'<rect x="{MARGIN}" y="{MARGIN}" width="{bw}" height="{bh}" '
             f'fill="none" stroke="black" stroke-width="0.7"/>')
    p.append(f'<rect x="{MARGIN+1}" y="{MARGIN+1}" width="{bw-2}" height="{bh-2}" '
             f'fill="none" stroke="black" stroke-width="0.35"/>')

    # Cell dividers
    for _, (ccx, ccy) in VIEW_CELLS.items():
        x0, y0 = ccx - CELL_W / 2, ccy - CELL_H / 2
        p.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{CELL_W:.1f}" '
                 f'height="{CELL_H:.1f}" fill="none" stroke="#ddd" '
                 f'stroke-width="0.2" stroke-dasharray="4,2"/>')

    # View content
    for vn, svg in views_svg.items():
        p.append(f'<!-- {vn.upper()} -->')
        p.append(svg)

    # Title block
    tb_y = PAGE_H - MARGIN - TITLE_H
    p.append(f'<rect x="{MARGIN}" y="{tb_y}" width="{DRAW_W}" height="{TITLE_H}" '
             f'fill="#f8f8f8" stroke="black" stroke-width="0.5"/>')
    mid_x = MARGIN + DRAW_W * 0.55
    p.append(f'<line x1="{mid_x}" y1="{tb_y}" x2="{mid_x}" y2="{PAGE_H - MARGIN}" '
             f'stroke="black" stroke-width="0.3"/>')

    sl = f"1:{round(1/scale)}" if scale < 1 else f"{round(scale)}:1"
    dt = _date.today().isoformat()
    p.append(f'<text x="{MARGIN+5}" y="{tb_y+10}" font-family="sans-serif" '
             f'font-size="6" font-weight="bold">{_escape(name)}</text>')
    p.append(f'<text x="{MARGIN+5}" y="{tb_y+18}" font-family="monospace" '
             f'font-size="3" fill="#444">'
             f'Scale: {sl}  |  A3 Landscape  |  3rd Angle Projection</text>')
    p.append(f'<text x="{MARGIN+5}" y="{tb_y+24}" font-family="monospace" '
             f'font-size="3" fill="#444">'
             f'Date: {dt}  |  '
             f'BBox: {bbox.XLength:.0f} x {bbox.YLength:.0f} x {bbox.ZLength:.0f} mm</text>')

    # Line legend
    leg_y = tb_y + 31
    leg_x = MARGIN + 5
    for label, color, w, dash in [("Visible", "#000", "0.7", None),
                                   ("Hidden", "#000", "0.35", "3,1.5"),
                                   ("Center", "#d00", "0.18", "6,2,1,2")]:
        la = f'stroke="{color}" stroke-width="{w}"'
        if dash:
            la += f' stroke-dasharray="{dash}"'
        p.append(f'<line x1="{leg_x}" y1="{leg_y}" x2="{leg_x+12}" '
                 f'y2="{leg_y}" {la}/>')
        p.append(f'<text x="{leg_x+14}" y="{leg_y+1}" font-family="monospace" '
                 f'font-size="2.2" fill="#666">{label}</text>')
        leg_x += 40

    # BOM (right half of title block)
    if bom:
        bx = mid_x + 5
        by = tb_y + 4
        rh = 4.5
        p.append(f'<text x="{bx}" y="{by+4}" font-family="monospace" '
                 f'font-size="3" font-weight="bold">BOM</text>')
        hy = by + 8
        p.append(f'<text x="{bx}" y="{hy}" font-family="monospace" '
                 f'font-size="2.5" fill="#666">'
                 f'{"#":<3} {"Part":<20} {"Material":<12} {"Qty":<4}</text>')
        for i, item in enumerate(bom[:4]):
            ry = hy + (i + 1) * rh
            p.append(f'<text x="{bx}" y="{ry}" font-family="monospace" '
                     f'font-size="2.5">'
                     f'{i+1:<3} {_escape(item.get("id","?")):<20} '
                     f'{_escape(item.get("material","-")):<12} '
                     f'{item.get("count",1):<4}</text>')
        if len(bom) > 4:
            ry = hy + 5 * rh
            p.append(f'<text x="{bx}" y="{ry}" font-family="monospace" '
                     f'font-size="2.5" fill="#999">... +{len(bom)-4} more</text>')

    # GD&T symbols
    if mates:
        try:
            from _gdt_symbols import generate_gdt_for_mates
            fcx, fcy = VIEW_CELLS["front"]
            gx = fcx + CELL_W / 2 - 35
            gy = fcy - CELL_H / 2 + 20
            frags = generate_gdt_for_mates(
                mates, tolerance_specs=tol_specs or {},
                start_x=gx, start_y=gy, spacing=12)
            if frags:
                p.append('<!-- GD&T -->')
                p.extend(frags)
        except Exception:
            pass

    p.append('</svg>')
    return '\n'.join(p)


# -- Helpers -------------------------------------------------------------------

def tight_bbox(shape):
    """Compute tight bounding box from actual vertices.
    FreeCAD's BoundBox can be wildly wrong after edge-by-edge fillet."""
    import FreeCAD as _FC
    verts = shape.Vertexes
    if not verts:
        return shape.BoundBox
    xs = [v.Point.x for v in verts]
    ys = [v.Point.y for v in verts]
    zs = [v.Point.z for v in verts]
    return _FC.BoundBox(min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def auto_scale(bbox, cell_w, cell_h):
    """Compute scale factor to fit shape in a view cell."""
    max_dim = max(bbox.XLength, bbox.YLength, bbox.ZLength, 1e-6)
    return min(cell_w, cell_h) * 0.85 / max_dim


def nice_scale(raw):
    """Round to nearest standard engineering scale."""
    standards = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
    return min(standards, key=lambda s: abs(s - raw))


def extract_bom(config, parts_metadata):
    """Extract BOM from config parts + assembly joints."""
    bom = []
    parts_config = {p["id"]: p for p in config.get("parts", [])}
    assembly = config.get("assembly", {})
    joints_by_part = {}
    for j in assembly.get("joints", []):
        joints_by_part[j.get("part", "")] = {
            "id": j.get("id"), "type": j.get("type"), "axis": j.get("axis"),
        }
    for entry in assembly.get("parts", []):
        ref = entry["ref"]
        pc = parts_config.get(ref, {})
        shapes = pc.get("shapes", [])
        material = shapes[0].get("material", "-") if shapes else "-"
        dims = "-"
        meta = parts_metadata.get(entry.get("label", ref)) or parts_metadata.get(ref)
        if meta and "bounding_box" in meta:
            s = meta["bounding_box"].get("size", [0, 0, 0])
            dims = f"{s[0]:.0f}x{s[1]:.0f}x{s[2]:.0f}"
        item = {"id": ref, "material": material, "dimensions": dims, "count": 1}
        joint = joints_by_part.get(ref)
        if joint:
            item["joint"] = joint
        bom.append(item)
    return bom


def _escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# -- Main Pipeline -------------------------------------------------------------

try:
    config = read_input()
    model_name = config.get("name", "unnamed")
    drawing_cfg = config.get("drawing", {})
    views_requested = drawing_cfg.get("views", ["front", "top", "right", "iso"])
    scale_hint = drawing_cfg.get("scale")

    log(f"Generating drawing: {model_name}")

    FreeCAD = init_freecad()
    import Part

    # -- Build 3D Model --
    is_assembly = "parts" in config and "assembly" in config

    if is_assembly:
        from _assembly import build_assembly
        doc = FreeCAD.newDocument("DrawingAssembly")
        result = build_assembly(config, doc)
        compound = result["compound"]
        parts_metadata = result["parts_metadata"]
        log(f"  Assembly: {len(result['features'])} parts")
    else:
        from _shapes import (make_shape, boolean_op, apply_fillet,
                             apply_chamfer, apply_shell, circular_pattern,
                             get_metadata)
        doc = FreeCAD.newDocument("DrawingSingle")
        shapes = {}
        for spec in config.get("shapes", []):
            shapes[spec["id"]] = make_shape(spec)
        for op_spec in config.get("operations", []):
            op = op_spec["op"]
            if op in ("fuse", "cut", "common"):
                base = shapes[op_spec["base"]]
                tool_ref = op_spec["tool"]
                tool = (shapes[tool_ref] if isinstance(tool_ref, str)
                        else make_shape(tool_ref))
                shapes[op_spec.get("result", op_spec["base"])] = \
                    boolean_op(op, base, tool)
            elif op == "fillet":
                shapes[op_spec.get("result", op_spec["target"])] = apply_fillet(
                    shapes[op_spec["target"]], op_spec["radius"],
                    op_spec.get("edges"))
            elif op == "chamfer":
                shapes[op_spec.get("result", op_spec["target"])] = apply_chamfer(
                    shapes[op_spec["target"]], op_spec["size"],
                    op_spec.get("edges"))
            elif op == "shell":
                shapes[op_spec.get("result", op_spec["target"])] = apply_shell(
                    shapes[op_spec["target"]], op_spec["thickness"],
                    op_spec.get("faces"))
        final_name = config.get("final", list(shapes.keys())[-1])
        compound = shapes[final_name]
        parts_metadata = {final_name: get_metadata(compound)}
        log(f"  Single part: {final_name}")

    # -- Compute Scale --
    bbox = tight_bbox(compound)
    log(f"  BBox: {bbox.XLength:.1f} x {bbox.YLength:.1f} x {bbox.ZLength:.1f} mm")

    if scale_hint:
        if ":" in str(scale_hint):
            num, den = str(scale_hint).split(":")
            scale = float(num) / float(den)
        else:
            scale = float(scale_hint)
    else:
        raw = auto_scale(bbox, CELL_W, CELL_H)
        scale = nice_scale(raw)

    log(f"  Scale: {scale}")

    # -- Project Views --
    views_svg = {}
    for vname in views_requested:
        if vname not in VIEW_DIRECTIONS:
            log(f"  Skipping unknown view: {vname}")
            continue

        groups, bounds, centers = project_view(
            compound, VIEW_DIRECTIONS[vname], vname)

        if not groups:
            # Fallback: project individual solids
            if hasattr(compound, 'Solids') and compound.Solids:
                log(f"  View '{vname}': empty compound, trying per-solid")
                all_groups, all_centers = {}, []
                all_bounds = [1e9, 1e9, -1e9, -1e9]
                for solid in compound.Solids:
                    sg, sb, sc = project_view(
                        solid, VIEW_DIRECTIONS[vname], vname)
                    for gi, edges in sg.items():
                        all_groups.setdefault(gi, []).extend(edges)
                    all_centers.extend(sc)
                    all_bounds[0] = min(all_bounds[0], sb[0])
                    all_bounds[1] = min(all_bounds[1], sb[1])
                    all_bounds[2] = max(all_bounds[2], sb[2])
                    all_bounds[3] = max(all_bounds[3], sb[3])
                if all_groups:
                    groups = all_groups
                    bounds = tuple(all_bounds)
                    centers = all_centers

        if not groups:
            log(f"  View '{vname}': no edges projected")
            continue

        cx, cy = VIEW_CELLS.get(vname, VIEW_CELLS["front"])
        n_edges = sum(len(v) for v in groups.values())
        log(f"  View '{vname}': {n_edges} edges")

        svg = render_view_svg(vname, groups, bounds, centers, cx, cy, scale)
        views_svg[vname] = svg

    if not views_svg:
        respond_error("No views could be projected. Shape may be empty.")

    # -- Extract BOM --
    bom = extract_bom(config, parts_metadata) if is_assembly else []

    # -- Compose Drawing --
    mates = (config.get("assembly", {}).get("mates", [])
             if is_assembly else [])
    tol_specs = config.get("tolerance", {}).get("specs", {})
    svg_content = compose_drawing(
        views_svg, model_name, bom, scale, bbox,
        mates=mates, tol_specs=tol_specs)

    # -- Save SVG --
    export_dir = config.get("export", {}).get("directory", ".")
    os.makedirs(export_dir, exist_ok=True)
    svg_path = os.path.join(export_dir, f"{model_name}_drawing.svg")
    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)
    svg_size = os.path.getsize(svg_path)
    log(f"  SVG: {svg_path} ({svg_size} bytes)")

    # -- DXF Output (optional) --
    dxf_path = None
    if drawing_cfg.get("dxf"):
        try:
            import TechDraw
            from FreeCAD import Vector
            dxf_str = TechDraw.projectToDXF(compound, Vector(0, -1, 0))
            dxf_path = os.path.join(export_dir, f"{model_name}_front.dxf")
            with open(dxf_path, 'w', encoding='utf-8') as f:
                f.write(dxf_str)
            log(f"  DXF: {dxf_path}")
        except Exception as e:
            log(f"  DXF failed: {e}")

    # -- BOM CSV (optional) --
    bom_csv_path = None
    if drawing_cfg.get("bom_csv") and bom:
        bom_csv_path = os.path.join(export_dir, f"{model_name}_bom.csv")
        with open(bom_csv_path, 'w', encoding='utf-8') as f:
            f.write("Item,Part ID,Material,Dimensions,Count,Joint Type,Joint ID\n")
            for i, item in enumerate(bom):
                joint = item.get("joint", {})
                f.write(f"{i+1},{item['id']},{item.get('material','-')},"
                        f"{item.get('dimensions','-')},{item.get('count',1)},"
                        f"{joint.get('type','')},{joint.get('id','')}\n")
        log(f"  BOM CSV: {bom_csv_path}")

    # -- Response --
    scale_label = f"1:{round(1/scale)}" if scale < 1 else f"{round(scale)}:1"
    response = {
        "success": True,
        "drawing_paths": [
            {"format": "svg", "path": svg_path, "size_bytes": svg_size},
        ],
        "bom": bom,
        "views": list(views_svg.keys()),
        "scale": scale_label,
    }
    if dxf_path:
        response["drawing_paths"].append({
            "format": "dxf", "path": dxf_path,
            "size_bytes": os.path.getsize(dxf_path),
        })
    if bom_csv_path:
        response["drawing_paths"].append({
            "format": "csv", "path": bom_csv_path,
            "size_bytes": os.path.getsize(bom_csv_path),
        })

    respond(response)

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
