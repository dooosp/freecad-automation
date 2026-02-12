#!/usr/bin/env python3
"""SVG Post-Processor for engineering drawings.

Rule-based filter applied to generate_drawing.py output.
Does NOT modify generate_drawing.py — works on output SVG only.

Usage:
    python scripts/postprocess_svg.py input.svg -o output.svg [--profile ks] [--report report.json]
    python scripts/postprocess_svg.py input.svg --dry-run --report report.json
"""
import argparse
import json
import sys
import os
import re

sys.path.insert(0, os.path.dirname(__file__))
from svg_common import (
    load_svg, write_svg, local_tag, svg_tag,
    cell_bbox, classify_by_position, group_center, count_paths,
    elem_bbox_approx, path_coords, polyline_coords,
    round_float_str, count_long_floats_in_str,
    HIDDEN_CLASSES, BBox,
)


# -- Stroke Profile ------------------------------------------------------------

STROKE_PROFILE_KS = {
    "hard_visible":   {"stroke-width": "0.7",  "stroke": "#000"},
    "outer_visible":  {"stroke-width": "0.50", "stroke": "#000"},
    "smooth_visible": {"stroke-width": "0.35", "stroke": "#000"},
    "outer_hidden":   {"stroke-width": "0.20", "stroke": "#333",
                       "stroke-dasharray": "3,1.5"},
    "hard_hidden":    {"stroke-width": "0.20", "stroke": "#333",
                       "stroke-dasharray": "3,1.5"},
    "smooth_hidden":  {"stroke-width": "0.20", "stroke": "#444",
                       "stroke-dasharray": "3,1.5"},
    "centerlines":    {"stroke-width": "0.18",
                       "stroke-dasharray": "8,2,1.5,2",
                       "vector-effect": "non-scaling-stroke"},
    "symmetry-axes":  {"stroke-width": "0.13",
                       "stroke-dasharray": "8,2,1.5,2",
                       "vector-effect": "non-scaling-stroke"},
    "gdt-leader":     {"stroke-width": "0.25"},
}

# Wildcard: dimensions-front, dimensions-top, etc.
_DIM_PROFILE = {"stroke-width": "0.18", "vector-effect": "non-scaling-stroke"}


# -- P0 Rule 1: Remove ISO hidden lines ----------------------------------------

def remove_iso_hidden(tree):
    """Remove hidden-line groups that fall within the ISO cell.

    Returns number of removed groups.
    """
    root = tree.getroot()
    iso_cell = cell_bbox("iso")
    removed = 0
    to_remove = []

    for elem in list(root):
        cls = elem.get("class", "")
        if cls not in HIDDEN_CLASSES:
            continue
        center = group_center(elem)
        if center and iso_cell.contains(*center):
            to_remove.append(elem)

    for elem in to_remove:
        root.remove(elem)
        removed += 1

    return removed


# -- P0 Rule 2: Stroke normalization -------------------------------------------

def normalize_strokes(tree, profile=None):
    """Enforce stroke attributes per class according to profile.

    Returns number of modified groups.
    """
    if profile is None:
        profile = STROKE_PROFILE_KS

    root = tree.getroot()
    modified = 0

    for elem in root.iter():
        if local_tag(elem) != "g":
            continue
        cls = elem.get("class", "")
        if not cls:
            continue

        # Exact match
        attrs = profile.get(cls)

        # Wildcard match for dimensions-*
        if attrs is None and cls.startswith("dimensions-"):
            attrs = _DIM_PROFILE

        if attrs is None:
            continue

        changed = False
        for attr_name, attr_val in attrs.items():
            if elem.get(attr_name) != attr_val:
                elem.set(attr_name, attr_val)
                changed = True
        if changed:
            modified += 1

    return modified


# -- P0 Rule 3: Notes rewrap ---------------------------------------------------

NOTES_CONFIG = {
    "max_width_mm": 180.0,
    "line_height_mm": 4.0,
    "font_size_mm": 2.0,
    "char_width_factor": 0.55,
    "start_x": 19.0,
}


def rewrap_notes(tree, config=None):
    """Reformat general-notes text elements with consistent spacing.

    Returns number of repositioned lines.
    """
    if config is None:
        config = NOTES_CONFIG

    root = tree.getroot()
    notes_group = None

    for elem in root.iter():
        if local_tag(elem) == "g" and elem.get("class") == "general-notes":
            notes_group = elem
            break

    if notes_group is None:
        return 0

    texts = [c for c in notes_group if local_tag(c) == "text"]
    if not texts:
        return 0

    max_chars = int(config["max_width_mm"] / (config["font_size_mm"] * config["char_width_factor"]))

    # Build line list: split long lines
    lines = []
    for t in texts:
        content = t.text or ""
        is_header = t.get("font-weight") == "bold"

        if is_header or len(content) <= max_chars:
            lines.append({"text": content, "elem": t, "is_header": is_header})
        else:
            # Word-wrap
            words = content.split(" ")
            current = ""
            first = True
            for w in words:
                if current and len(current) + 1 + len(w) > max_chars:
                    lines.append({"text": current, "elem": t if first else None,
                                  "is_header": False})
                    current = "   " + w  # indent continuation
                    first = False
                else:
                    current = (current + " " + w).strip() if current else w
            if current:
                lines.append({"text": current, "elem": t if first else None,
                              "is_header": False})

    if not lines:
        return 0

    # Find starting y from first text (NOTES: header)
    first_y = float(texts[0].get("y", "236.0"))
    lh = config["line_height_mm"]
    repositioned = 0

    # Remove all existing text children
    for t in texts:
        notes_group.remove(t)

    # Re-create text elements with correct spacing
    for i, line_info in enumerate(lines):
        y = first_y + i * lh
        t = line_info.get("elem")
        if t is not None:
            # Reuse original element (preserve attributes like font-weight)
            t.set("y", f"{y:.1f}")
            t.text = line_info["text"]
            notes_group.append(t)
        else:
            # Create new text element for wrapped continuation
            import xml.etree.ElementTree as ET
            new_t = ET.SubElement(notes_group, svg_tag("text"))
            new_t.set("x", str(config["start_x"]))
            new_t.set("y", f"{y:.1f}")
            new_t.text = line_info["text"]
        repositioned += 1

    return repositioned


# -- P0 Rule 4: Round coordinates ----------------------------------------------

_COORD_ATTRS = {"x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r",
                "width", "height"}


def round_coordinates(tree, precision=2):
    """Round floating-point noise in coordinate attributes.

    Returns number of modified attributes.
    """
    modified = 0

    for elem in tree.iter():
        # Scalar attributes
        for attr in _COORD_ATTRS:
            val = elem.get(attr)
            if val is None:
                continue
            try:
                fval = float(val)
            except ValueError:
                continue
            rounded = f"{fval:.{precision}f}"
            if rounded != val and len(val) > len(rounded):
                elem.set(attr, rounded)
                modified += 1

        # path d attribute
        tag = local_tag(elem)
        if tag == "path":
            d = elem.get("d", "")
            if count_long_floats_in_str(d) > 0:
                elem.set("d", round_float_str(d, precision))
                modified += 1

        # polyline/polygon points
        if tag in ("polyline", "polygon"):
            pts = elem.get("points", "")
            if count_long_floats_in_str(pts) > 0:
                elem.set("points", round_float_str(pts, precision))
                modified += 1

    return modified


# -- P1 Rule 5: Simplify ISO view ----------------------------------------------

def simplify_iso(tree, max_smooth_paths=600):
    """Remove excessive detail from ISO view.

    - iso_visible groups in ISO cell: always remove
    - smooth_visible groups in ISO cell: remove if path count > threshold

    Returns number of removed paths.
    """
    root = tree.getroot()
    iso_cell = cell_bbox("iso")
    removed_paths = 0
    to_remove = []

    for elem in list(root):
        cls = elem.get("class", "")
        if cls not in ("iso_visible", "smooth_visible"):
            continue
        center = group_center(elem)
        if not center or not iso_cell.contains(*center):
            continue

        if cls == "iso_visible":
            removed_paths += count_paths(elem)
            to_remove.append(elem)
        elif cls == "smooth_visible":
            n = count_paths(elem)
            if n > max_smooth_paths:
                removed_paths += n
                to_remove.append(elem)

    for elem in to_remove:
        root.remove(elem)

    return removed_paths


# -- P1 Rule 6: GD&T audit -----------------------------------------------------

def audit_gdt(tree):
    """Audit GD&T structure. Minimal modifications (coordinate rounding only).

    Returns dict with audit results.
    """
    root = tree.getroot()
    total = 0
    anchored = 0
    overflow = 0
    rounded = 0

    iso_cell = cell_bbox("iso")
    front_cell = cell_bbox("front")
    right_cell = cell_bbox("right")
    top_cell = cell_bbox("top")

    for elem in root.iter():
        if local_tag(elem) != "g" or elem.get("class") != "gdt-leader":
            continue
        total += 1

        # Check leader polyline
        for child in elem:
            if local_tag(child) == "polyline":
                pts = polyline_coords(child.get("points", ""))
                if len(pts) >= 2:
                    start, end = pts[0], pts[-1]
                    dist = ((end[0] - start[0])**2 + (end[1] - start[1])**2)**0.5
                    if dist > 1.0:
                        anchored += 1

        # Check if FCF bbox is within any view cell
        bb = elem_bbox_approx(elem)
        if bb:
            cx, cy = bb.center()
            view = classify_by_position(cx, cy)
            if view is None:
                overflow += 1

    return {
        "total": total,
        "anchored": anchored,
        "overflow": overflow,
    }


# -- Main pipeline -------------------------------------------------------------

def postprocess(input_path, output_path, profile="ks", dry_run=False):
    """Run all post-processing rules and return report."""
    tree = load_svg(input_path)
    report = {"rules": {}, "errors": []}

    rules = [
        ("iso_hidden_removed", lambda: remove_iso_hidden(tree)),
        ("strokes_normalized", lambda: normalize_strokes(tree)),
        ("notes_rewrapped", lambda: rewrap_notes(tree)),
        ("coords_rounded", lambda: round_coordinates(tree)),
        ("iso_paths_simplified", lambda: simplify_iso(tree)),
        ("gdt_audit", lambda: audit_gdt(tree)),
    ]

    for name, fn in rules:
        try:
            report["rules"][name] = fn()
        except Exception as e:
            report["errors"].append({"rule": name, "error": str(e)})
            print(f"  WARN: rule '{name}' failed: {e}", file=sys.stderr)

    if not dry_run:
        write_svg(tree, output_path)

    return report


# -- CLI -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="SVG Post-Processor for engineering drawings")
    parser.add_argument("input", help="Input SVG file")
    parser.add_argument("-o", "--output", help="Output SVG file (default: overwrite input)")
    parser.add_argument("--profile", default="ks", help="Stroke profile (default: ks)")
    parser.add_argument("--report", help="Save JSON report to file")
    parser.add_argument("--dry-run", action="store_true",
                        help="Don't write output, report only")
    args = parser.parse_args()

    output = args.output or args.input
    if args.dry_run:
        output = None

    print(f"Post-processing: {args.input}")
    report = postprocess(args.input, output, profile=args.profile,
                         dry_run=args.dry_run)

    # Print summary
    for rule, result in report["rules"].items():
        print(f"  {rule}: {result}")
    if report["errors"]:
        print(f"  ERRORS: {len(report['errors'])}")

    if args.report:
        with open(args.report, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"  Report saved: {args.report}")

    if output and not args.dry_run:
        print(f"  Output: {output}")


if __name__ == "__main__":
    main()
