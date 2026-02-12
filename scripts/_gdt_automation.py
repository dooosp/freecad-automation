"""
Automated GD&T assignment based on feature graph analysis.
Selects datum features and assigns geometric tolerances per
KS B 0608 (ISO 1101) rules.
"""

import math


# GD&T tolerance symbols (Unicode)
GDT_SYMBOLS = {
    "position":      "\u2316",  # ⌖ Position
    "concentricity": "\u25CE",  # ◎ Concentricity (deprecated → use position)
    "coaxiality":    "\u25CE",  # ◎ Coaxiality
    "perpendicularity": "\u27C2",  # ⟂ Perpendicularity
    "parallelism":   "\u2225",  # ∥ Parallelism
    "flatness":      "\u25B1",  # ▱ Flatness (approximated)
    "straightness":  "\u2014",  # — Straightness
    "circularity":   "\u25CB",  # ○ Circularity
    "cylindricity":  "\u232D",  # ⌭ Cylindricity (approximated)
    "runout":        "\u2197",  # ↗ Runout (approximated)
    "total_runout":  "\u21D7",  # ⇗ Total runout (approximated)
    "symmetry":      "\u232E",  # ⌮ Symmetry (approximated)
}


def auto_select_datums(feature_graph, shape_bbox=None):
    """Automatically select datum features using ASME/ISO rules.

    Datum selection hierarchy:
    - A = largest flat face (primary locating surface)
    - B = longest perpendicular edge/face (secondary)
    - C = third orthogonal face (tertiary)

    Args:
        feature_graph: FeatureGraph from _feature_inference
        shape_bbox: (xlen, ylen, zlen) shape bounding box dimensions

    Returns:
        list of {label, type, description, position} dicts
    """
    datums = []

    if shape_bbox:
        xlen, ylen, zlen = shape_bbox
    else:
        xlen, ylen, zlen = 100, 60, 20  # default guess

    # Sort dimensions to find largest faces
    dims = sorted([
        ("XY", xlen * ylen, [0, 0, 1]),
        ("XZ", xlen * zlen, [0, 1, 0]),
        ("YZ", ylen * zlen, [1, 0, 0]),
    ], key=lambda d: d[1], reverse=True)

    # A = largest face
    datums.append({
        "label": "A",
        "type": "plane",
        "plane": dims[0][0],
        "normal": dims[0][2],
        "description": f"Primary datum — {dims[0][0]} face ({dims[0][1]:.0f} mm²)",
    })

    # B = second largest perpendicular face
    datums.append({
        "label": "B",
        "type": "plane",
        "plane": dims[1][0],
        "normal": dims[1][2],
        "description": f"Secondary datum — {dims[1][0]} face ({dims[1][1]:.0f} mm²)",
    })

    # C = third face
    datums.append({
        "label": "C",
        "type": "plane",
        "plane": dims[2][0],
        "normal": dims[2][2],
        "description": f"Tertiary datum — {dims[2][0]} face ({dims[2][1]:.0f} mm²)",
    })

    # Check for axis datums (bore/shaft as datum)
    bores = feature_graph.by_type("bore")
    if bores:
        datums.append({
            "label": "D",
            "type": "axis",
            "feature_id": bores[0].id,
            "description": f"Axis datum — bore ⌀{bores[0].diameter}",
        })

    return datums


def auto_assign_gdt(feature_graph, datums):
    """Automatically assign GD&T tolerances to features.

    Rules:
    - Bolt circle holes → Position tolerance to datums A/B/C
    - Bore/shaft → Coaxiality or cylindricity
    - Mating faces → Perpendicularity or parallelism to datum A
    - Dowel holes → Position tolerance (tighter than bolt holes)

    Args:
        feature_graph: FeatureGraph
        datums: list from auto_select_datums

    Returns:
        list of {feature_id, type, symbol, value, datum_refs, note} dicts
    """
    assignments = []
    datum_labels = [d["label"] for d in datums[:3]]  # A, B, C

    # Bolt circle holes → Position
    for grp in feature_graph.groups:
        if grp.pattern == "bolt_circle":
            # Position tolerance based on hole size
            hole = grp.features[0] if grp.features else None
            if hole:
                # Rule of thumb: position tol ≈ 10% of clearance
                pos_tol = _bolt_position_tolerance(hole.diameter)
                assignments.append({
                    "feature_id": f"bolt_circle_PCD{grp.pcd}",
                    "type": "position",
                    "symbol": GDT_SYMBOLS["position"],
                    "value": pos_tol,
                    "datum_refs": datum_labels,
                    "modifier": "M",  # MMC for bolt holes
                    "note": f"{grp.count}× holes on PCD {grp.pcd}",
                    "target": {
                        "position": list(hole.position),
                        "diameter": hole.diameter,
                        "attach": "hole",
                    },
                })

    # Individual holes not in patterns → Position
    patterned_ids = set()
    for grp in feature_graph.groups:
        for f in grp.features:
            patterned_ids.add(f.id)

    for hole in feature_graph.by_type("hole"):
        if hole.id in patterned_ids:
            continue
        pos_tol = _bolt_position_tolerance(hole.diameter)
        assignments.append({
            "feature_id": hole.id,
            "type": "position",
            "symbol": GDT_SYMBOLS["position"],
            "value": pos_tol,
            "datum_refs": datum_labels,
            "modifier": "M",
            "note": f"⌀{hole.diameter} hole",
            "target": {
                "position": list(hole.position),
                "diameter": hole.diameter,
                "attach": "hole",
            },
        })

    # Dowel holes → Tighter position
    for dowel in feature_graph.by_type("dowel"):
        assignments.append({
            "feature_id": dowel.id,
            "type": "position",
            "symbol": GDT_SYMBOLS["position"],
            "value": 0.05,
            "datum_refs": datum_labels,
            "modifier": "",
            "note": f"Dowel ⌀{dowel.diameter}",
            "target": {
                "position": list(dowel.position),
                "diameter": dowel.diameter,
                "attach": "hole",
            },
        })

    # Bore → Coaxiality or cylindricity
    for bore in feature_graph.by_type("bore"):
        bore_target = {
            "position": list(bore.position),
            "diameter": bore.diameter,
            "attach": "axis",
        }
        # If there's an axis datum, use coaxiality
        axis_datum = [d for d in datums if d["type"] == "axis"]
        if axis_datum:
            assignments.append({
                "feature_id": bore.id,
                "type": "coaxiality",
                "symbol": GDT_SYMBOLS["coaxiality"],
                "value": 0.025,
                "datum_refs": [axis_datum[0]["label"]],
                "modifier": "",
                "note": f"Bore ⌀{bore.diameter} coaxiality",
                "target": bore_target,
            })
        else:
            assignments.append({
                "feature_id": bore.id,
                "type": "cylindricity",
                "symbol": GDT_SYMBOLS["cylindricity"],
                "value": 0.02,
                "datum_refs": [],
                "modifier": "",
                "note": f"Bore ⌀{bore.diameter} cylindricity",
                "target": bore_target,
            })

    # Perpendicularity for faces meeting datum A
    if len(datums) >= 2:
        assignments.append({
            "feature_id": f"face_{datums[1]['label']}",
            "type": "perpendicularity",
            "symbol": GDT_SYMBOLS["perpendicularity"],
            "value": 0.05,
            "datum_refs": [datums[0]["label"]],
            "modifier": "",
            "note": f"Face {datums[1]['label']} ⊥ datum {datums[0]['label']}",
            "target": {
                "position": [0, 0, 0],  # face center approximation
                "attach": "face",
            },
        })

    return assignments


def render_gdt_frame_svg(gdt_entry, x, y):
    """Render a single GD&T feature control frame as SVG.

    Format: | symbol | tolerance | datum refs |

    Args:
        gdt_entry: dict from auto_assign_gdt
        x, y: top-left position

    Returns:
        SVG string, (width, height)
    """
    out = []
    frame_h = 6
    cell_w = 12
    sym = gdt_entry.get("symbol", "?")
    val = gdt_entry.get("value", 0)
    mod = gdt_entry.get("modifier", "")
    refs = gdt_entry.get("datum_refs", [])

    # Calculate total width
    n_cells = 2 + len(refs)  # symbol + tolerance + datum refs
    total_w = n_cells * cell_w

    # Frame border
    out.append(f'<rect x="{x}" y="{y}" width="{total_w}" height="{frame_h}" '
               f'fill="white" stroke="#000" stroke-width="0.3"/>')

    # Cell dividers
    for i in range(1, n_cells):
        cx = x + i * cell_w
        out.append(f'<line x1="{cx}" y1="{y}" x2="{cx}" y2="{y + frame_h}" '
                   f'stroke="#000" stroke-width="0.2"/>')

    # Symbol cell
    out.append(f'<text x="{x + cell_w/2:.1f}" y="{y + frame_h - 1.5:.1f}" '
               f'text-anchor="middle" font-family="sans-serif" '
               f'font-size="3.5" fill="#000">{sym}</text>')

    # Tolerance cell
    tol_text = f"\u2300{val}" if mod == "M" else f"{val}"
    if mod:
        tol_text += f" {_modifier_symbol(mod)}"
    out.append(f'<text x="{x + cell_w * 1.5:.1f}" y="{y + frame_h - 1.5:.1f}" '
               f'text-anchor="middle" font-family="sans-serif" '
               f'font-size="2.8" fill="#000">{_escape(tol_text)}</text>')

    # Datum ref cells
    for i, ref in enumerate(refs):
        out.append(f'<text x="{x + cell_w * (2.5 + i):.1f}" '
                   f'y="{y + frame_h - 1.5:.1f}" text-anchor="middle" '
                   f'font-family="sans-serif" font-size="3" '
                   f'fill="#000">{ref}</text>')

    return '\n'.join(out), (total_w, frame_h)


def _bolt_position_tolerance(diameter):
    """Calculate position tolerance for bolt holes.

    Rule: clearance hole - nominal bolt = available tolerance,
    position tolerance ≈ 0.25 × available tolerance (safety margin)
    """
    # Approximate clearance for medium fit
    if diameter <= 6:
        clearance = 0.6
    elif diameter <= 12:
        clearance = 1.0
    elif diameter <= 20:
        clearance = 2.0
    else:
        clearance = 3.0

    return round(clearance * 0.25, 2)


def _modifier_symbol(mod):
    """Material condition modifier symbol."""
    mods = {"M": "\u24C2", "L": "\u24C1", "F": "\u24BB"}  # Ⓜ Ⓛ Ⓕ
    return mods.get(mod, mod)


def _escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
