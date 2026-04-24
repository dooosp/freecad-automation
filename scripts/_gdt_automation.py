"""GD&T rendering helpers and disabled auto-inference compatibility shims.

Drawing Quality v2 requires GD&T and tolerance evidence to be explicit. The
legacy automatic datum/GD&T assignment APIs remain import-compatible, but they
intentionally return no inferred callouts.
"""
from _svg_utils import escape as _escape


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
    """Return no inferred datums.

    This is a compatibility shim for older imports. Automatic datum selection
    is disabled so generated drawings cannot invent GD&T/tolerance evidence.
    """
    return []


def auto_assign_gdt(feature_graph, datums):
    """Return no inferred GD&T or tolerance callouts.

    This is a compatibility shim for older imports. Automatic GD&T and numeric
    tolerance inference are prohibited by the Drawing Quality v2 locks.
    """
    return []


def render_gdt_frame_svg(gdt_entry, x, y):
    """Render a single GD&T feature control frame as SVG.

    Format: | symbol | tolerance | datum refs |

    Args:
        gdt_entry: explicit GD&T entry supplied by caller/config
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

def _modifier_symbol(mod):
    """Material condition modifier symbol."""
    mods = {"M": "\u24C2", "L": "\u24C1", "F": "\u24BB"}  # Ⓜ Ⓛ Ⓕ
    return mods.get(mod, mod)
