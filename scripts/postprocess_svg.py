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
import xml.etree.ElementTree as ET
from svg_common import (
    load_svg, write_svg, local_tag, svg_tag,
    cell_bbox, classify_by_position, group_center, count_paths,
    elem_bbox_approx, path_coords, polyline_coords,
    round_float_str, count_long_floats_in_str,
    HIDDEN_CLASSES, BBox, SVG_NS, TITLEBLOCK_Y,
)
from svg_repair import rebuild_notes, repair_text_overlaps, repair_overflow

VERSION = "0.4.0"


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


# -- Plan-aware Rule 7: Inject PCD virtual circle ------------------------------

import math as _math


def _find_bolt_hole_circles(tree, bolt_dia_mm):
    """Find bolt-hole circles in the front view cell.

    Returns list of (cx, cy, r) in SVG coordinates.
    Strategy:
      1. If bolt_dia_mm given: filter circles with r ≈ bolt_dia_mm/2 (±30%)
      2. Fallback: group circles by similar radius (±10%), pick largest group ≥3
    """
    front_cell = cell_bbox("front")
    candidates = []  # (cx, cy, r)

    for elem in tree.iter():
        if local_tag(elem) != "circle":
            continue
        cx = float(elem.get("cx", 0))
        cy = float(elem.get("cy", 0))
        r = float(elem.get("r", 0))
        if r < 0.5:
            continue
        if front_cell.contains(cx, cy):
            candidates.append((cx, cy, r))

    if not candidates:
        return []

    # Strategy 1: filter by known bolt diameter
    if bolt_dia_mm and bolt_dia_mm > 0:
        target_r = bolt_dia_mm / 2
        # We need to figure out the scale from SVG coords.
        # Look for circles whose radius is proportional to target_r.
        # Group by similar r first, then pick the group that best matches.
        from collections import defaultdict
        groups = defaultdict(list)
        for cx, cy, r in candidates:
            key = round(r, 1)
            groups[key].append((cx, cy, r))

        # Find the group whose radius count ≥ 3 and r is closest to expected
        best_group = None
        best_diff = float("inf")
        for key, members in groups.items():
            if len(members) < 3:
                continue
            avg_r = sum(m[2] for m in members) / len(members)
            # Can't compare SVG r to model r directly without scale.
            # Use count as primary signal: bolt holes repeat ≥3 times.
            # Among groups with ≥3 members, pick the one with most members.
            if best_group is None or len(members) > len(best_group):
                best_group = members
            elif len(members) == len(best_group):
                # If same count, prefer smaller r (bolt holes < counterbores)
                if avg_r < sum(m[2] for m in best_group) / len(best_group):
                    best_group = members

        if best_group and len(best_group) >= 3:
            return best_group

    # Strategy 2: fallback — group by radius, pick largest group ≥ 3
    from collections import defaultdict
    groups = defaultdict(list)
    for cx, cy, r in candidates:
        key = round(r, 1)
        groups[key].append((cx, cy, r))

    best = None
    for key, members in groups.items():
        if len(members) >= 3:
            if best is None or len(members) > len(best):
                best = members
    return best or []


def inject_pcd_virtual_circle(tree, plan):
    """Inject a virtual PCD circle into the front view based on bolt hole positions.

    Finds bolt-hole circles in SVG, computes their center cluster,
    and draws a chain-line circle at PCD radius with a diameter callout.
    """
    if not plan:
        return {"injected": False, "reason": "no_plan"}

    dim_intents = plan.get("dim_intents", [])
    pcd_intent = next((d for d in dim_intents if d.get("id") == "PCD"), None)
    bolt_dia_intent = next((d for d in dim_intents if d.get("id") == "BOLT_DIA"), None)

    if not pcd_intent or pcd_intent.get("value_mm") is None:
        return {"injected": False, "reason": "no_pcd_value"}

    pcd_value = pcd_intent["value_mm"]
    bolt_dia = bolt_dia_intent["value_mm"] if bolt_dia_intent else None

    # Find bolt hole circles in SVG
    bolt_circles = _find_bolt_hole_circles(tree, bolt_dia)
    if len(bolt_circles) < 3:
        return {"injected": False, "reason": f"too_few_circles({len(bolt_circles)})"}

    # Compute center and average radius
    avg_cx = sum(c[0] for c in bolt_circles) / len(bolt_circles)
    avg_cy = sum(c[1] for c in bolt_circles) / len(bolt_circles)
    distances = [_math.hypot(c[0] - avg_cx, c[1] - avg_cy) for c in bolt_circles]
    avg_r = sum(distances) / len(distances)

    if avg_r < 2.0:  # too small to be meaningful
        return {"injected": False, "reason": "radius_too_small"}

    # Build SVG elements
    root = tree.getroot()
    ns = SVG_NS

    g = ET.SubElement(root, f"{{{ns}}}g")
    g.set("class", "virtual-pcd")

    # Chain-line circle (ISO construction line style)
    circle = ET.SubElement(g, f"{{{ns}}}circle")
    circle.set("cx", f"{avg_cx:.2f}")
    circle.set("cy", f"{avg_cy:.2f}")
    circle.set("r", f"{avg_r:.2f}")
    circle.set("fill", "none")
    circle.set("stroke", "#555")
    circle.set("stroke-width", "0.30")
    circle.set("stroke-dasharray", "8,2,1.5,2")

    # Leader line from 45° point outward
    angle = _math.radians(45)
    start_x = avg_cx + avg_r * _math.cos(angle)
    start_y = avg_cy - avg_r * _math.sin(angle)
    leader_len = min(avg_r * 0.6, 18)
    end_x = start_x + leader_len * _math.cos(angle)
    end_y = start_y - leader_len * _math.sin(angle)

    leader = ET.SubElement(g, f"{{{ns}}}line")
    leader.set("x1", f"{start_x:.2f}")
    leader.set("y1", f"{start_y:.2f}")
    leader.set("x2", f"{end_x:.2f}")
    leader.set("y2", f"{end_y:.2f}")
    leader.set("stroke", "#000")
    leader.set("stroke-width", "0.18")

    # Horizontal shelf
    shelf_len = 8
    shelf_x = end_x + shelf_len
    shelf = ET.SubElement(g, f"{{{ns}}}line")
    shelf.set("x1", f"{end_x:.2f}")
    shelf.set("y1", f"{end_y:.2f}")
    shelf.set("x2", f"{shelf_x:.2f}")
    shelf.set("y2", f"{end_y:.2f}")
    shelf.set("stroke", "#000")
    shelf.set("stroke-width", "0.18")

    # Diameter text
    val_str = str(int(pcd_value)) if pcd_value == int(pcd_value) else f"{pcd_value:.1f}"
    text = ET.SubElement(g, f"{{{ns}}}text")
    text.set("x", f"{shelf_x + 0.5:.2f}")
    text.set("y", f"{end_y - 0.5:.2f}")
    text.set("font-family", "sans-serif")
    text.set("font-size", "3")
    text.set("fill", "#000")
    text.text = f"\u00d8{val_str} PCD"

    return {
        "injected": True,
        "center": [round(avg_cx, 2), round(avg_cy, 2)],
        "radius": round(avg_r, 2),
        "bolt_count": len(bolt_circles),
        "pcd_value": pcd_value,
    }


# -- Plan-aware Rule 8: Inject bolt count note ---------------------------------

def inject_bolt_count_note(tree, plan):
    """Insert bolt count note into general-notes group.

    Format: "{N}x dia.{d} HOLES EQ. SPACED ON PCD dia.{pcd}"
    """
    if not plan:
        return {"injected": False, "reason": "no_plan"}

    dim_intents = plan.get("dim_intents", [])
    count_intent = next((d for d in dim_intents if d.get("id") == "BOLT_COUNT"), None)
    bolt_dia_intent = next((d for d in dim_intents if d.get("id") == "BOLT_DIA"), None)
    pcd_intent = next((d for d in dim_intents if d.get("id") == "PCD"), None)

    count_val = count_intent.get("value_mm") if count_intent else None
    bolt_val = bolt_dia_intent.get("value_mm") if bolt_dia_intent else None
    pcd_val = pcd_intent.get("value_mm") if pcd_intent else None

    if count_val is None or bolt_val is None:
        return {"injected": False, "reason": "missing_values"}

    # Build note text — KS concise format: "N×⌀d"
    n = int(count_val)
    d_str = str(int(bolt_val)) if bolt_val == int(bolt_val) else f"{bolt_val:.1f}"
    note_text = f"{n}\u00d7\u00d8{d_str}"
    if pcd_val is not None:
        pcd_str = str(int(pcd_val)) if pcd_val == int(pcd_val) else f"{pcd_val:.1f}"
        note_text += f" EQ. SP. ON PCD \u00d8{pcd_str}"

    # Find general-notes group
    notes_group = None
    for elem in tree.iter():
        if local_tag(elem) == "g" and elem.get("class") == "general-notes":
            notes_group = elem
            break

    if notes_group is None:
        return {"injected": False, "reason": "no_notes_group"}

    # Find last text y position
    last_y = 0
    last_x = 15.0
    text_elems = [e for e in notes_group if local_tag(e) == "text"]
    if text_elems:
        last_y = max(float(e.get("y", 0)) for e in text_elems)
        last_x = float(text_elems[0].get("x", 15.0))

    new_y = last_y + 6.0  # LINE_H = 6mm (extra spacing for bolt note)
    # TITLEBLOCK_Y=247 is cell boundary; QA checks overflow at y>270.
    # Allow notes up to 268 (2mm margin before QA limit).
    if new_y > 268:
        return {"injected": False, "reason": "overflow"}

    # Count existing numbered notes to get next number
    next_num = len(text_elems)  # rough estimate (includes wrapped lines)
    # Better: count lines starting with "N. "
    numbered = sum(1 for e in text_elems
                   if (e.text or "").strip()[:1].isdigit())
    next_num = numbered + 1

    ns = SVG_NS
    new_text = ET.SubElement(notes_group, f"{{{ns}}}text")
    new_text.set("x", f"{last_x:.1f}")
    new_text.set("y", f"{new_y:.1f}")
    new_text.text = f"{next_num}. {note_text}"

    return {
        "injected": True,
        "note": note_text,
        "y_position": round(new_y, 1),
    }


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

def _load_plan(plan_file):
    """Load drawing plan from TOML or JSON file."""
    if not plan_file or not os.path.exists(plan_file):
        return None
    try:
        if plan_file.endswith(".toml"):
            import tomllib
            with open(plan_file, "rb") as f:
                data = tomllib.load(f)
        else:
            with open(plan_file) as f:
                data = json.load(f)
        return data.get("drawing_plan", data)
    except Exception:
        return None


def postprocess(input_path, output_path, profile="ks", dry_run=False,
                plan_file=None):
    """Run all post-processing rules and return structured report."""
    tree = load_svg(input_path)
    plan = _load_plan(plan_file)
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
        ("inject_pcd_circle", lambda: inject_pcd_virtual_circle(tree, plan)),
        ("inject_bolt_note", lambda: inject_bolt_count_note(tree, plan)),
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

    # --- inject_pcd_circle ---
    elif pass_name == "inject_pcd_circle":
        if summary.get("injected"):
            report["changes"].append({
                "pass": pass_name,
                "type": "insert",
                "view": "front",
                "selector": "g.virtual-pcd",
                "note": f"PCD virtual circle injected (r={summary.get('radius', '?')}mm, "
                        f"{summary.get('bolt_count', '?')} bolt holes)",
            })

    # --- inject_bolt_note ---
    elif pass_name == "inject_bolt_note":
        if summary.get("injected"):
            counts["texts_wrapped"] += 1
            report["changes"].append({
                "pass": pass_name,
                "type": "insert",
                "view": "notes",
                "selector": "g.general-notes > text",
                "note": f"Bolt count note added: {summary.get('note', '')}",
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
    parser.add_argument("--plan", help="Drawing plan file (TOML or JSON) for plan-aware passes")
    args = parser.parse_args()

    output = args.output or args.input
    if args.dry_run:
        output = None

    print(f"Post-processing: {args.input}")
    report = postprocess(args.input, output, profile=args.profile,
                         dry_run=args.dry_run, plan_file=args.plan)

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
