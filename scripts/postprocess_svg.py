#!/usr/bin/env python3
"""SVG Post-Processor for engineering drawings.

Rule-based filter applied to generate_drawing.py output.
Does NOT modify generate_drawing.py — works on output SVG only.

Report schema v0.3: meta, summary, risks, qa_diff (placeholder), changes.

Usage:
    python scripts/postprocess_svg.py input.svg -o output.svg [--profile ks] [--report report.json]
    python scripts/postprocess_svg.py input.svg --dry-run --report report.json
"""
import argparse
import json
import sys
import os
import re
import time
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from svg_common import (
    load_svg, write_svg, local_tag, svg_tag,
    cell_bbox, classify_by_position, group_center, count_paths,
    elem_bbox_approx, path_coords, polyline_coords,
    round_float_str, count_long_floats_in_str,
    HIDDEN_CLASSES, BBox,
)
from svg_repair import rebuild_notes, repair_text_overlaps, repair_overflow

VERSION = "0.3.0"


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
    """Remove hidden-line groups that fall within the ISO cell."""
    root = tree.getroot()
    iso_cell = cell_bbox("iso")
    to_remove = []
    paths_removed = 0

    for elem in list(root):
        cls = elem.get("class", "")
        if cls not in HIDDEN_CLASSES:
            continue
        center = group_center(elem)
        if center and iso_cell.contains(*center):
            paths_removed += count_paths(elem)
            to_remove.append(elem)

    for elem in to_remove:
        root.remove(elem)

    return {
        "groups_removed": len(to_remove),
        "paths_removed": paths_removed,
    }


# -- P0 Rule 2: Stroke normalization -------------------------------------------

def normalize_strokes(tree, profile=None):
    """Enforce stroke attributes per class according to profile."""
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

        attrs = profile.get(cls)
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

    return {"stroke_overrides": modified}


# -- P0 Rule 4: Round coordinates ----------------------------------------------

_COORD_ATTRS = {"x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r",
                "width", "height"}


def round_coordinates(tree, precision=2):
    """Round floating-point noise in coordinate attributes."""
    modified = 0

    for elem in tree.iter():
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

        tag = local_tag(elem)
        if tag == "path":
            d = elem.get("d", "")
            if count_long_floats_in_str(d) > 0:
                elem.set("d", round_float_str(d, precision))
                modified += 1

        if tag in ("polyline", "polygon"):
            pts = elem.get("points", "")
            if count_long_floats_in_str(pts) > 0:
                elem.set("points", round_float_str(pts, precision))
                modified += 1

    return {"coords_rounded": modified}


# -- P1 Rule 5: Simplify ISO view ----------------------------------------------

def simplify_iso(tree, max_smooth_paths=600):
    """Remove excessive detail from ISO view."""
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

    return {"iso_paths_removed": removed_paths, "dense_iso_trimmed": removed_paths > 0}


# -- P1 Rule 6: GD&T audit -----------------------------------------------------

def audit_gdt(tree):
    """Audit GD&T structure."""
    total = 0
    anchored = 0
    overflow = 0

    for elem in tree.iter():
        if local_tag(elem) != "g" or elem.get("class") != "gdt-leader":
            continue
        total += 1

        for child in elem:
            if local_tag(child) == "polyline":
                pts = polyline_coords(child.get("points", ""))
                if len(pts) >= 2:
                    start, end = pts[0], pts[-1]
                    dist = ((end[0] - start[0])**2 + (end[1] - start[1])**2)**0.5
                    if dist > 1.0:
                        anchored += 1

        bb = elem_bbox_approx(elem)
        if bb:
            cx, cy = bb.center()
            view = classify_by_position(cx, cy)
            if view is None:
                overflow += 1

    return {"total": total, "anchored": anchored, "overflow": overflow}


# -- Main pipeline -------------------------------------------------------------

def postprocess(input_path, output_path, profile="ks", dry_run=False):
    """Run all post-processing rules and return structured report."""
    tree = load_svg(input_path)
    kst = timezone(timedelta(hours=9))

    report = {
        "meta": {
            "tool": "postprocess_svg.py",
            "version": VERSION,
            "profile": profile,
            "timestamp": datetime.now(kst).isoformat(timespec="seconds"),
            "input_svg": input_path,
            "output_svg": output_path if not dry_run else None,
            "dry_run": dry_run,
        },
        "summary": {
            "passes": [],
            "counts": {
                "elements_removed": 0,
                "groups_removed": 0,
                "paths_removed": 0,
                "texts_moved": 0,
                "texts_wrapped": 0,
                "transforms_added": 0,
                "stroke_overrides": 0,
                "coords_rounded": 0,
            },
            "view_fixes": {},
        },
        "risks": [],
        "qa_diff": None,  # filled by orchestrator (fcad.js)
        "changes": [],
        "errors": [],
    }

    # Define pass pipeline
    pass_defs = [
        ("remove_iso_hidden", lambda: remove_iso_hidden(tree)),
        ("normalize_strokes", lambda: normalize_strokes(tree)),
        ("rebuild_notes", lambda: rebuild_notes(tree)),
        ("deoverlap_text", lambda: repair_text_overlaps(tree)),
        ("repair_overflow_scale", lambda: repair_overflow(tree)),
        ("round_coords", lambda: round_coordinates(tree)),
        ("simplify_iso", lambda: simplify_iso(tree)),
        ("gdt_audit", lambda: audit_gdt(tree)),
    ]

    counts = report["summary"]["counts"]

    for name, fn in pass_defs:
        t0 = time.monotonic()
        try:
            result = fn()
        except Exception as e:
            report["errors"].append({"rule": name, "error": str(e)})
            report["summary"]["passes"].append({
                "name": name, "applied": False,
                "duration_ms": round((time.monotonic() - t0) * 1000),
            })
            print(f"  WARN: pass '{name}' failed: {e}", file=sys.stderr)
            continue

        dur_ms = round((time.monotonic() - t0) * 1000)
        report["summary"]["passes"].append({
            "name": name, "applied": True, "duration_ms": dur_ms,
        })

        # Aggregate counts + changes + risks from each pass
        _aggregate(report, name, result, counts)

    if not dry_run and output_path:
        write_svg(tree, output_path)

    return report


def _aggregate(report, pass_name, result, counts):
    """Merge pass result into the global report."""

    # Repair functions return {"summary": ..., "changes": [...], "risks": [...]}
    if isinstance(result, dict) and "changes" in result:
        report["changes"].extend(result.get("changes", []))
        report["risks"].extend(result.get("risks", []))
        summary = result.get("summary", {})
    elif isinstance(result, dict):
        summary = result
    else:
        summary = {}

    # --- remove_iso_hidden ---
    if pass_name == "remove_iso_hidden":
        gr = summary.get("groups_removed", 0)
        pr = summary.get("paths_removed", 0)
        counts["groups_removed"] += gr
        counts["paths_removed"] += pr
        counts["elements_removed"] += gr
        if gr > 0:
            report["summary"]["view_fixes"]["iso"] = {
                "hidden_groups_removed": gr,
                "paths_removed": pr,
            }
            report["changes"].append({
                "pass": pass_name,
                "type": "delete",
                "view": "iso",
                "selector": "g.outer_hidden, g.hard_hidden, g.smooth_hidden, g.iso_hidden",
                "count": gr,
                "note": f"Removed {gr} hidden-line groups ({pr} paths) inside ISO cell",
            })

    # --- normalize_strokes ---
    elif pass_name == "normalize_strokes":
        counts["stroke_overrides"] += summary.get("stroke_overrides", 0)

    # --- rebuild_notes ---
    elif pass_name == "rebuild_notes":
        counts["texts_wrapped"] += summary.get("texts_wrapped", 0)

    # --- deoverlap_text ---
    elif pass_name == "deoverlap_text":
        counts["texts_moved"] += summary.get("texts_moved", 0)

    # --- repair_overflow_scale ---
    elif pass_name == "repair_overflow_scale":
        vs = summary.get("views_scaled", {})
        counts["transforms_added"] += len(vs)
        for vname, scale in vs.items():
            report["summary"]["view_fixes"].setdefault(vname, {})
            report["summary"]["view_fixes"][vname]["overflow_repaired"] = True
            report["summary"]["view_fixes"][vname]["scale_factor"] = scale
            report["summary"]["view_fixes"][vname]["transform_target"] = "geometry_only"

    # --- round_coords ---
    elif pass_name == "round_coords":
        counts["coords_rounded"] += summary.get("coords_rounded", 0)

    # --- simplify_iso ---
    elif pass_name == "simplify_iso":
        pr = summary.get("iso_paths_removed", 0)
        counts["paths_removed"] += pr
        trimmed = summary.get("dense_iso_trimmed", False)
        if trimmed:
            report["summary"]["view_fixes"].setdefault("iso", {})
            report["summary"]["view_fixes"]["iso"]["dense_iso_trimmed"] = True
            report["risks"].append({
                "code": "iso_simplified",
                "severity": "info",
                "view": "iso",
                "reason": f"Removed {pr} excessive paths from ISO view",
            })

    # --- gdt_audit ---
    elif pass_name == "gdt_audit":
        unanchored = summary.get("overflow", 0)
        if unanchored > 0:
            report["risks"].append({
                "code": "gdt_unanchored_remaining",
                "severity": "warning",
                "view": "page",
                "reason": f"{unanchored} GD&T FCF(s) outside any view cell",
            })


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
    summary = report["summary"]
    for p in summary["passes"]:
        status = "OK" if p["applied"] else "FAIL"
        print(f"  {p['name']}: {status} ({p['duration_ms']}ms)")
    c = summary["counts"]
    print(f"  counts: removed={c['elements_removed']} moved={c['texts_moved']} "
          f"strokes={c['stroke_overrides']} rounded={c['coords_rounded']}")
    if report["risks"]:
        warns = [r for r in report["risks"] if r["severity"] == "warning"]
        infos = [r for r in report["risks"] if r["severity"] == "info"]
        if warns:
            print(f"  risks: {len(warns)} warning(s)")
        if infos:
            print(f"  info: {len(infos)} note(s)")
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
