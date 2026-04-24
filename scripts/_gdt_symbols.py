"""Explicit GD&T symbol rendering helpers for SVG drawings.

Drawing Quality v2 prohibits automatic mate-to-GD&T and tolerance inference.
The legacy mate-generation API remains import-compatible, but returns no
generated fragments.
"""


# ISO 1101 GD&T symbol SVG paths (viewBox: 0 0 10 10)
GDT_SYMBOLS = {
    "concentricity": {
        "label": "Concentricity",
        "svg": '<circle cx="5" cy="5" r="3.5" fill="none" stroke="black" stroke-width="0.5"/>'
               '<circle cx="5" cy="5" r="1.5" fill="none" stroke="black" stroke-width="0.5"/>',
    },
    "position": {
        "label": "Position",
        "svg": '<circle cx="5" cy="5" r="3.5" fill="none" stroke="black" stroke-width="0.5"/>'
               '<line x1="5" y1="1" x2="5" y2="9" stroke="black" stroke-width="0.5"/>'
               '<line x1="1" y1="5" x2="9" y2="5" stroke="black" stroke-width="0.5"/>',
    },
    "perpendicularity": {
        "label": "Perpendicularity",
        "svg": '<line x1="2" y1="8" x2="8" y2="8" stroke="black" stroke-width="0.6"/>'
               '<line x1="5" y1="8" x2="5" y2="2" stroke="black" stroke-width="0.6"/>',
    },
    "parallelism": {
        "label": "Parallelism",
        "svg": '<line x1="2" y1="3" x2="8" y2="3" stroke="black" stroke-width="0.6"/>'
               '<line x1="2" y1="7" x2="8" y2="7" stroke="black" stroke-width="0.6"/>',
    },
    "flatness": {
        "label": "Flatness",
        "svg": '<polygon points="2,7 5,3 8,7" fill="none" stroke="black" stroke-width="0.5"/>'
               '<line x1="1" y1="8" x2="9" y2="8" stroke="black" stroke-width="0.5"/>',
    },
}

MATE_TO_GDT = {}


def mate_type_to_gdt(mate_type):
    """Return no inferred GD&T symbol for assembly mates."""
    return None


def render_fcf_svg(symbol_key, tolerance_value=None, datum=None, x=0, y=0, size=8):
    """
    Render an ISO 1101 feature control frame as an SVG <g> element.

    A feature control frame has compartments:
    [symbol | tolerance value | datum reference]

    Args:
        symbol_key: key from GDT_SYMBOLS
        tolerance_value: e.g. "0.021" (mm)
        datum: e.g. "A" (datum reference letter)
        x, y: position in SVG coordinates (mm)
        size: height of the frame (mm)

    Returns SVG <g> fragment string.
    """
    sym = GDT_SYMBOLS.get(symbol_key)
    if not sym:
        return ""

    cell_w = size
    num_cells = 1
    if tolerance_value is not None:
        num_cells += 1
    if datum:
        num_cells += 1

    total_w = cell_w * num_cells
    half_h = size / 2

    parts = [f'<g class="gdt-symbol" data-type="{symbol_key}" '
             f'transform="translate({x},{y})">']

    # Outer frame
    parts.append(f'<rect x="0" y="{-half_h}" width="{total_w}" height="{size}" '
                 f'fill="white" stroke="black" stroke-width="0.3"/>')

    # Symbol cell
    parts.append(f'<svg x="0" y="{-half_h}" width="{cell_w}" height="{size}" '
                 f'viewBox="0 0 10 10">')
    parts.append(sym["svg"])
    parts.append('</svg>')

    col = 1
    # Divider + tolerance value
    if tolerance_value is not None:
        dx = cell_w * col
        parts.append(f'<line x1="{dx}" y1="{-half_h}" x2="{dx}" y2="{half_h}" '
                     f'stroke="black" stroke-width="0.3"/>')
        parts.append(f'<text x="{dx + cell_w/2}" y="1.2" '
                     f'text-anchor="middle" font-family="monospace" '
                     f'font-size="{size * 0.4}">{tolerance_value}</text>')
        col += 1

    # Divider + datum
    if datum:
        dx = cell_w * col
        parts.append(f'<line x1="{dx}" y1="{-half_h}" x2="{dx}" y2="{half_h}" '
                     f'stroke="black" stroke-width="0.3"/>')
        parts.append(f'<text x="{dx + cell_w/2}" y="1.2" '
                     f'text-anchor="middle" font-family="monospace" '
                     f'font-size="{size * 0.45}" font-weight="bold">{datum}</text>')

    parts.append('</g>')
    return '\n'.join(parts)


def generate_gdt_for_mates(mates, tolerance_specs=None, start_x=0, start_y=0, spacing=12):
    """Return no inferred GD&T SVG fragments for assembly mates."""
    return []
