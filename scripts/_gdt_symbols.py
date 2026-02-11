"""
GD&T (Geometric Dimensioning & Tolerancing) symbol library for SVG drawings.
Maps assembly mate types to ISO 1101 geometric tolerance symbols.
Generates feature control frame SVG fragments.
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

# Mate type → GD&T symbol mapping
MATE_TO_GDT = {
    "coaxial": "concentricity",
    "coincident": "perpendicularity",
    "parallel": "parallelism",
}


def mate_type_to_gdt(mate_type):
    """Map a mate constraint type to the corresponding GD&T symbol key."""
    return MATE_TO_GDT.get(mate_type, None)


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
    """
    Generate GD&T SVG fragments for a list of mate constraints.

    Args:
        mates: list of mate dicts from assembly config
        tolerance_specs: dict of "part1/part2" → spec like "H7/g6"
        start_x, start_y: starting position for the first symbol
        spacing: vertical spacing between symbols

    Returns list of SVG <g> fragment strings.
    """
    if not tolerance_specs:
        tolerance_specs = {}

    fragments = []
    y_offset = start_y
    datum_letter = ord('A')

    for mate in mates:
        mate_type = mate.get("type", "")
        gdt_key = mate_type_to_gdt(mate_type)
        if not gdt_key:
            continue

        p1 = mate.get("part1", "")
        p2 = mate.get("part2", "")
        spec_key = f"{p1}/{p2}"
        spec = tolerance_specs.get(spec_key, None)

        tol_val = None
        if spec:
            # Extract tolerance grade from spec like "H7/g6"
            tol_val = spec

        datum = chr(datum_letter)
        datum_letter += 1

        frag = render_fcf_svg(gdt_key, tolerance_value=tol_val, datum=datum,
                              x=start_x, y=y_offset)
        if frag:
            fragments.append(frag)
            y_offset += spacing

    return fragments
