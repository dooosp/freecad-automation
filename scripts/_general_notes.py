"""
General notes and revision table for engineering drawings.
Builds standard note lists and renders SVG for the title block area.
"""

import math
from datetime import date as _date


def build_general_notes(drawing_cfg, feature_graph=None, ks=True):
    """Build a list of general notes for the drawing.

    Args:
        drawing_cfg: drawing section of TOML config
        feature_graph: FeatureGraph for feature-aware notes
        ks: Use KS standard references (True) or ISO (False)

    Returns:
        list of note strings
    """
    notes = []
    meta = drawing_cfg.get("meta", {})
    sf_cfg = drawing_cfg.get("surface_finish", {})
    notes_cfg = drawing_cfg.get("notes", {})
    tol_cfg = drawing_cfg.get("tolerances", {})
    ks_cfg = drawing_cfg.get("ks_standard", {})

    # 1. General tolerance
    gen_tol = ks_cfg.get("general_tolerance") or tol_cfg.get("general") or meta.get("tolerance", "")
    if gen_tol:
        if ks and "KS" in gen_tol.upper():
            notes.append(f"GENERAL TOLERANCES PER {gen_tol}")
        elif "ISO" in gen_tol.upper():
            notes.append(f"GENERAL TOLERANCES PER {gen_tol}")
        else:
            std = "KS B 0401" if ks else "ISO 2768"
            notes.append(f"GENERAL TOLERANCES PER {std} {gen_tol}")
    else:
        std = "KS B 0401" if ks else "ISO 2768"
        notes.append(f"GENERAL TOLERANCES PER {std}-m")

    # 2. Default surface finish
    sf_default = sf_cfg.get("default", "")
    if sf_default:
        notes.append(f"UNLESS OTHERWISE SPECIFIED: {sf_default}")

    # 3. Edge treatment
    has_chamfer = False
    has_fillet = False
    if feature_graph:
        has_chamfer = bool(feature_graph.by_type("chamfer"))
        has_fillet = bool(feature_graph.by_type("fillet"))

    if has_chamfer:
        ch = feature_graph.by_type("chamfer")[0]
        notes.append(f"BREAK ALL SHARP EDGES C{ch.size}")
    else:
        notes.append("BREAK ALL SHARP EDGES 0.2~0.5")

    notes.append("DEBURR ALL MACHINED EDGES")

    # 4. Material specification
    material = notes_cfg.get("material_spec") or meta.get("material", "")
    if material and material != "-":
        notes.append(f"MATERIAL: {material}")

    # 5. Heat treatment
    heat_treat = notes_cfg.get("heat_treatment", "")
    if heat_treat:
        notes.append(f"HEAT TREATMENT: {heat_treat}")

    # 6. Coating / surface treatment
    coating = notes_cfg.get("coating", "")
    if coating:
        notes.append(f"SURFACE TREATMENT: {coating}")

    # 7. Unit
    notes.append("ALL DIMENSIONS IN mm")

    return notes


def build_revision_table(revisions):
    """Build a revision table from config.

    Args:
        revisions: list of {rev, date, description, by}

    Returns:
        list of dicts with standardized keys
    """
    if not revisions:
        return []

    table = []
    for entry in revisions:
        table.append({
            "rev": entry.get("rev", "-"),
            "date": entry.get("date", _date.today().isoformat()),
            "description": entry.get("description", ""),
            "by": entry.get("by", "-"),
        })
    return table


def render_revision_table_svg(revisions, x, y, width=170):
    """Render revision table as SVG above the title block.

    Args:
        revisions: list from build_revision_table
        x, y: top-left corner position
        width: table width in mm

    Returns:
        SVG string
    """
    if not revisions:
        return ""

    out = [f'<g class="revision-table">']
    row_h = 5
    header_h = 5
    col_widths = [15, 25, width - 65, 25]  # REV, DATE, DESCRIPTION, BY

    # Header
    out.append(f'<rect x="{x}" y="{y}" width="{width}" height="{header_h}" '
               f'fill="#eee" stroke="black" stroke-width="0.25"/>')

    headers = ["REV", "DATE", "DESCRIPTION", "BY"]
    cx = x
    for i, (hdr, cw) in enumerate(zip(headers, col_widths)):
        out.append(f'<text x="{cx + 2}" y="{y + header_h - 1.5}" '
                   f'font-family="sans-serif" font-size="2" '
                   f'font-weight="bold" fill="#333">{hdr}</text>')
        if i < len(col_widths) - 1:
            cx += cw
            out.append(f'<line x1="{cx}" y1="{y}" x2="{cx}" '
                       f'y2="{y + header_h + len(revisions) * row_h}" '
                       f'stroke="black" stroke-width="0.15"/>')

    # Rows (newest first)
    for ri, rev in enumerate(reversed(revisions)):
        ry = y + header_h + ri * row_h
        out.append(f'<rect x="{x}" y="{ry}" width="{width}" height="{row_h}" '
                   f'fill="none" stroke="black" stroke-width="0.15"/>')

        cx = x
        values = [rev["rev"], rev["date"], rev["description"], rev["by"]]
        for val, cw in zip(values, col_widths):
            # Truncate description if too long
            max_chars = int(cw / 1.5)
            text = str(val)[:max_chars]
            out.append(f'<text x="{cx + 2}" y="{ry + row_h - 1.5}" '
                       f'font-family="sans-serif" font-size="2" '
                       f'fill="#000">{_escape(text)}</text>')
            cx += cw

    out.append('</g>')
    return '\n'.join(out)


def _wrap_text(text, max_chars):
    """Word-wrap text to fit within max_chars per line.

    Returns list of lines. Breaks at word boundaries when possible,
    falls back to hard break for very long words.
    """
    if len(text) <= max_chars:
        return [text]

    lines = []
    remaining = text
    while remaining:
        if len(remaining) <= max_chars:
            lines.append(remaining)
            break
        # Find last space within max_chars
        break_at = remaining.rfind(' ', 0, max_chars)
        if break_at <= 0:
            # No space found — hard break
            break_at = max_chars
        lines.append(remaining[:break_at].rstrip())
        remaining = remaining[break_at:].lstrip()
    return lines


def estimate_notes_height(notes, max_width=200):
    """Pre-calculate total height of rendered notes block (mm).

    Accounts for word wrapping so caller can position the block accurately.
    """
    if not notes:
        return 0.0
    LINE_H = 4.0
    INDENT = 4.0
    CHAR_W = 1.2
    max_chars = max(int((max_width - INDENT) / CHAR_W), 20)
    total_lines = 1  # "NOTES:" title
    for note in notes:
        wrapped = _wrap_text(note, max_chars)
        total_lines += len(wrapped)
    return total_lines * LINE_H


def render_general_notes_svg(notes, x, y, max_width=200):
    """Render general notes as SVG text block with word wrapping.

    Args:
        notes: list of note strings
        x, y: top-left position
        max_width: maximum text width in mm

    Returns:
        (SVG string, total_height_mm) tuple
    """
    if not notes:
        return "", 0.0

    FONT_SIZE = 2.0
    LINE_H = 4.0        # line spacing (leading) — increased for readability
    INDENT = 4.0         # indent for bullet number
    WRAP_INDENT = 6.5    # indent for wrapped continuation lines
    # Approximate characters per line (sans-serif at 2.0pt ≈ 1.2mm per char)
    CHAR_W = 1.2
    max_chars = int((max_width - INDENT) / CHAR_W)
    max_chars = max(max_chars, 20)  # floor

    out = [f'<g class="general-notes" font-family="sans-serif" '
           f'font-size="{FONT_SIZE}" fill="#333">']

    # Title
    out.append(f'<text x="{x}" y="{y}" font-size="2.5" '
               f'font-weight="bold" fill="#000">NOTES:</text>')

    # Note lines with word wrapping
    cur_y = y + LINE_H
    for ni, note in enumerate(notes):
        prefix = f'{ni+1}. '
        wrapped = _wrap_text(note, max_chars)
        # First line with bullet number
        out.append(f'<text x="{x:.1f}" y="{cur_y:.1f}">'
                   f'{_escape(prefix + wrapped[0])}</text>')
        cur_y += LINE_H
        # Continuation lines (indented)
        for wline in wrapped[1:]:
            out.append(f'<text x="{x + WRAP_INDENT:.1f}" y="{cur_y:.1f}">'
                       f'{_escape(wline)}</text>')
            cur_y += LINE_H

    out.append('</g>')
    total_height = cur_y - y
    return '\n'.join(out), total_height


def _escape(text):
    """Escape XML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
