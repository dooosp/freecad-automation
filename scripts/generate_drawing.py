"""
Generate engineering drawing (4-view orthographic projection) from model config.
Pipeline: stdin JSON → 3D build → projection → SVG compose → BOM extract → stdout JSON

Uses Part.projectToSVG() for headless SVG generation (no TechDraw GUI required).
A3 landscape layout (420×297mm) with title block and BOM table.
"""

import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, init_freecad

# Projection directions (Z-up, 3rd angle projection)
VIEW_DIRECTIONS = {
    "front": (0, -1, 0),
    "top":   (0, 0, -1),
    "right": (1, 0, 0),
    "iso":   (1, -1, 1),
}

# A3 landscape in mm
PAGE_W = 420
PAGE_H = 297
MARGIN = 15
TITLE_H = 30
BOM_COL_W = PAGE_W - 2 * MARGIN  # full width BOM


def project_view(shape, direction, scale=1.0):
    """Project shape onto 2D plane using TechDraw.projectToSVG. Returns SVG path string."""
    import TechDraw
    from FreeCAD import Vector

    dx, dy, dz = direction
    d = Vector(dx, dy, dz)

    svg_str = TechDraw.projectToSVG(shape, d)
    return svg_str


def auto_scale(bbox, view_w, view_h):
    """Compute scale factor so shape fits inside the given view area (mm)."""
    dims = [bbox.XLength, bbox.YLength, bbox.ZLength]
    max_dim = max(dims) if dims else 1
    if max_dim < 1e-6:
        return 1.0
    # Leave 10% padding
    fit = min(view_w, view_h) * 0.9
    return fit / max_dim


def nice_scale(raw):
    """Round to nearest standard engineering scale."""
    standards = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
    return min(standards, key=lambda s: abs(s - raw))


def compose_svg(views_svg, name, bom, scale, bbox):
    """
    Compose A3 landscape SVG with 4 views, title block, and BOM.
    views_svg: dict of view_name → svg_fragment
    """
    # Drawable area (excluding margins and title block)
    draw_w = PAGE_W - 2 * MARGIN
    draw_h = PAGE_H - 2 * MARGIN - TITLE_H

    # 2×2 grid for views
    cell_w = draw_w / 2
    cell_h = draw_h / 2

    # View positions (top-left of each cell)
    positions = {
        "front": (MARGIN, MARGIN),
        "top":   (MARGIN, MARGIN + cell_h),
        "right": (MARGIN + cell_w, MARGIN),
        "iso":   (MARGIN + cell_w, MARGIN + cell_h),
    }

    parts = []
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" '
                 f'width="{PAGE_W}mm" height="{PAGE_H}mm" '
                 f'viewBox="0 0 {PAGE_W} {PAGE_H}">')

    # Background
    parts.append(f'<rect width="{PAGE_W}" height="{PAGE_H}" fill="white"/>')

    # Border
    parts.append(f'<rect x="{MARGIN}" y="{MARGIN}" '
                 f'width="{PAGE_W - 2*MARGIN}" height="{PAGE_H - 2*MARGIN}" '
                 f'fill="none" stroke="black" stroke-width="0.7"/>')

    # View cells
    for vname, (cx, cy) in positions.items():
        # Cell border (light)
        parts.append(f'<rect x="{cx}" y="{cy}" width="{cell_w}" height="{cell_h}" '
                     f'fill="none" stroke="#ccc" stroke-width="0.3" stroke-dasharray="2,2"/>')

        # View label
        parts.append(f'<text x="{cx + 3}" y="{cy + 10}" '
                     f'font-family="monospace" font-size="3.5" fill="#666">{vname.upper()}</text>')

        if vname in views_svg:
            svg_frag = views_svg[vname]
            # Center the projected SVG in the cell with scale
            tx = cx + cell_w / 2
            ty = cy + cell_h / 2
            parts.append(f'<g transform="translate({tx},{ty}) scale({scale},{-scale})">')
            parts.append(svg_frag)
            parts.append('</g>')

    # Title block
    tb_y = PAGE_H - MARGIN - TITLE_H
    tb_w = PAGE_W - 2 * MARGIN
    parts.append(f'<rect x="{MARGIN}" y="{tb_y}" width="{tb_w}" height="{TITLE_H}" '
                 f'fill="#f8f8f8" stroke="black" stroke-width="0.5"/>')

    # Title text
    parts.append(f'<text x="{MARGIN + 5}" y="{tb_y + 12}" '
                 f'font-family="sans-serif" font-size="6" font-weight="bold">{_escape(name)}</text>')

    scale_label = f"1:{round(1/scale)}" if scale < 1 else f"{round(scale)}:1"
    parts.append(f'<text x="{MARGIN + 5}" y="{tb_y + 22}" '
                 f'font-family="monospace" font-size="3.5" fill="#444">'
                 f'Scale: {scale_label}  |  A3 Landscape  |  3rd Angle Projection  |  '
                 f'BBox: {bbox.XLength:.0f} x {bbox.YLength:.0f} x {bbox.ZLength:.0f} mm</text>')

    # BOM table (if items present)
    if bom:
        bom_x = MARGIN + tb_w * 0.55
        bom_y_start = tb_y + 4
        row_h = 4.5
        parts.append(f'<text x="{bom_x}" y="{bom_y_start + 4}" '
                     f'font-family="monospace" font-size="3" font-weight="bold">BOM</text>')
        # Header
        hdr_y = bom_y_start + 8
        parts.append(f'<text x="{bom_x}" y="{hdr_y}" '
                     f'font-family="monospace" font-size="2.5" fill="#666">'
                     f'{"#":<3} {"Part":<20} {"Material":<12} {"Qty":<4}</text>')
        # Rows (max 4 visible in title block)
        for i, item in enumerate(bom[:4]):
            ry = hdr_y + (i + 1) * row_h
            parts.append(f'<text x="{bom_x}" y="{ry}" '
                         f'font-family="monospace" font-size="2.5">'
                         f'{i+1:<3} {_escape(item.get("id","?")):<20} '
                         f'{_escape(item.get("material","—")):<12} {item.get("count",1):<4}</text>')
        if len(bom) > 4:
            ry = hdr_y + 5 * row_h
            parts.append(f'<text x="{bom_x}" y="{ry}" '
                         f'font-family="monospace" font-size="2.5" fill="#999">'
                         f'... +{len(bom)-4} more items</text>')

    parts.append('</svg>')
    return '\n'.join(parts)


def extract_bom(config, parts_metadata):
    """Extract BOM from config parts + assembly joints."""
    bom = []
    parts_config = {p["id"]: p for p in config.get("parts", [])}
    assembly = config.get("assembly", {})
    joints_by_part = {}
    for j in assembly.get("joints", []):
        joints_by_part[j.get("part", "")] = {
            "id": j.get("id"),
            "type": j.get("type"),
            "axis": j.get("axis"),
        }

    for entry in assembly.get("parts", []):
        ref = entry["ref"]
        pc = parts_config.get(ref, {})
        shapes = pc.get("shapes", [])
        material = shapes[0].get("material", "—") if shapes else "—"

        # Get dimensions from parts_metadata
        dims = "—"
        meta = parts_metadata.get(entry.get("label", ref)) or parts_metadata.get(ref)
        if meta and "bounding_box" in meta:
            bb = meta["bounding_box"]
            s = bb.get("size", [0, 0, 0])
            dims = f"{s[0]:.0f}x{s[1]:.0f}x{s[2]:.0f}"

        item = {
            "id": ref,
            "material": material,
            "dimensions": dims,
            "count": 1,
        }
        joint = joints_by_part.get(ref)
        if joint:
            item["joint"] = joint

        bom.append(item)

    return bom


def _escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


try:
    config = read_input()
    model_name = config.get("name", "unnamed")
    drawing_config = config.get("drawing", {})
    views_requested = drawing_config.get("views", ["front", "top", "right", "iso"])
    scale_hint = drawing_config.get("scale")  # e.g. "1:5" or None for auto

    log(f"Generating drawing: {model_name}")

    FreeCAD = init_freecad()
    import Part

    # --- Build 3D model (reuse assembly pipeline) ---
    is_assembly = "parts" in config and "assembly" in config

    if is_assembly:
        from _assembly import build_assembly
        doc = FreeCAD.newDocument("DrawingAssembly")
        assembly_result = build_assembly(config, doc)
        compound = assembly_result["compound"]
        parts_metadata = assembly_result["parts_metadata"]
        log(f"  Assembly built: {len(assembly_result['features'])} parts")
    else:
        from _shapes import make_shape, boolean_op, apply_fillet, apply_chamfer, apply_shell, circular_pattern, get_metadata
        doc = FreeCAD.newDocument("DrawingSingle")
        shapes = {}
        for spec in config.get("shapes", []):
            sid = spec["id"]
            shapes[sid] = make_shape(spec)
        for op_spec in config.get("operations", []):
            op = op_spec["op"]
            if op in ("fuse", "cut", "common"):
                base = shapes[op_spec["base"]]
                tool_ref = op_spec["tool"]
                tool = shapes[tool_ref] if isinstance(tool_ref, str) else make_shape(tool_ref)
                result = boolean_op(op, base, tool)
                shapes[op_spec.get("result", op_spec["base"])] = result
            elif op == "fillet":
                shapes[op_spec.get("result", op_spec["target"])] = apply_fillet(
                    shapes[op_spec["target"]], op_spec["radius"], op_spec.get("edges"))
            elif op == "chamfer":
                shapes[op_spec.get("result", op_spec["target"])] = apply_chamfer(
                    shapes[op_spec["target"]], op_spec["size"], op_spec.get("edges"))
            elif op == "shell":
                shapes[op_spec.get("result", op_spec["target"])] = apply_shell(
                    shapes[op_spec["target"]], op_spec["thickness"], op_spec.get("faces"))
        final_name = config.get("final", list(shapes.keys())[-1])
        compound = shapes[final_name]
        parts_metadata = {final_name: get_metadata(compound)}
        log(f"  Single-part built: {final_name}")

    # --- Compute scale ---
    bbox = compound.BoundBox
    log(f"  BBox: {bbox.XLength:.1f} x {bbox.YLength:.1f} x {bbox.ZLength:.1f} mm")

    draw_w = (PAGE_W - 2 * MARGIN) / 2
    draw_h = (PAGE_H - 2 * MARGIN - TITLE_H) / 2

    if scale_hint:
        # Parse "1:5" format
        if ":" in str(scale_hint):
            num, den = str(scale_hint).split(":")
            scale = float(num) / float(den)
        else:
            scale = float(scale_hint)
    else:
        raw_scale = auto_scale(bbox, draw_w, draw_h)
        scale = nice_scale(raw_scale)

    log(f"  Scale: {scale} (1:{1/scale:.0f})" if scale < 1 else f"  Scale: {scale} ({scale:.0f}:1)")

    # --- Project views ---
    views_svg = {}
    for vname in views_requested:
        if vname not in VIEW_DIRECTIONS:
            log(f"  Skipping unknown view: {vname}")
            continue
        direction = VIEW_DIRECTIONS[vname]
        svg_frag = project_view(compound, direction, scale)
        if svg_frag and svg_frag.strip():
            views_svg[vname] = svg_frag
            log(f"  View '{vname}': {len(svg_frag)} chars")
        else:
            log(f"  View '{vname}': empty projection, trying individual shapes")
            # Fallback: project each solid in the compound individually
            if hasattr(compound, 'Solids') and compound.Solids:
                frags = []
                for solid in compound.Solids:
                    f = project_view(solid, direction, scale)
                    if f and f.strip():
                        frags.append(f)
                if frags:
                    views_svg[vname] = '\n'.join(frags)
                    log(f"  View '{vname}' (per-solid): {len(views_svg[vname])} chars")

    if not views_svg:
        respond_error("No views could be projected. Shape may be empty.")

    # --- Extract BOM ---
    bom = extract_bom(config, parts_metadata) if is_assembly else []

    # --- Compose SVG ---
    svg_content = compose_svg(views_svg, model_name, bom, scale, bbox)

    # --- Save SVG ---
    export_dir = config.get("export", {}).get("directory", ".")
    os.makedirs(export_dir, exist_ok=True)
    svg_path = os.path.join(export_dir, f"{model_name}_drawing.svg")
    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)
    svg_size = os.path.getsize(svg_path)
    log(f"  SVG saved: {svg_path} ({svg_size} bytes)")

    # --- BOM CSV (optional) ---
    bom_csv_path = None
    if drawing_config.get("bom_csv") and bom:
        bom_csv_path = os.path.join(export_dir, f"{model_name}_bom.csv")
        with open(bom_csv_path, 'w', encoding='utf-8') as f:
            f.write("Item,Part ID,Material,Dimensions,Count,Joint Type,Joint ID\n")
            for i, item in enumerate(bom):
                joint = item.get("joint", {})
                f.write(f"{i+1},{item['id']},{item.get('material','—')},"
                        f"{item.get('dimensions','—')},{item.get('count',1)},"
                        f"{joint.get('type','')},{joint.get('id','')}\n")
        log(f"  BOM CSV saved: {bom_csv_path}")

    # --- Response ---
    scale_label = f"1:{round(1/scale)}" if scale < 1 else f"{round(scale)}:1"
    response = {
        "success": True,
        "drawing_paths": [{"format": "svg", "path": svg_path, "size_bytes": svg_size}],
        "bom": bom,
        "views": list(views_svg.keys()),
        "scale": scale_label,
    }
    if bom_csv_path:
        response["drawing_paths"].append({
            "format": "csv",
            "path": bom_csv_path,
            "size_bytes": os.path.getsize(bom_csv_path),
        })

    respond(response)

except Exception as e:
    import traceback
    respond_error(str(e), traceback.format_exc())
