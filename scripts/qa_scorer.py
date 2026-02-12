#!/usr/bin/env python3
"""Drawing QA Scorer — measure SVG drawing quality numerically.

Scores 100-point scale with per-metric deductions.
Designed to run on generate_drawing.py output (raw or post-processed).

Usage:
    python scripts/qa_scorer.py input.svg [--json report.json] [--fail-under 80]
"""
import argparse
import json
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from svg_common import (
    load_svg, local_tag, svg_tag,
    cell_bbox, classify_by_position, group_center, count_paths,
    elem_bbox_approx, polyline_coords, count_long_floats_in_str,
    HIDDEN_CLASSES, GEOMETRY_CLASSES, CELLS, BBox,
)


# -- Deduction weights ---------------------------------------------------------

WEIGHTS = {
    "iso_hidden_count":     5,   # per group
    "overflow_count":       10,  # per element
    "text_overlap_pairs":   2,   # per pair
    "dim_overlap_pairs":    2,   # per pair
    "notes_overflow":       15,  # boolean
    "gdt_unanchored":       3,   # per FCF
    "dense_iso":            5,   # boolean
    "stroke_violations":    1,   # per group
    "float_precision":      1,   # per 10 occurrences, max 5
    # Phase 19 intent metrics
    "dim_completeness":     5,   # per missing required dim
    "dim_redundancy":       2,   # per duplicate across views
    "datum_coherence":      3,   # boolean (incoherent)
    "view_coverage":        5,   # boolean (uncovered features)
    "note_convention":      1,   # per violation, max 3
    # Phase 20-A presence enforcement metrics
    "required_presence_miss": 10,  # per missing required dim
    "value_inconsistency":    3,   # per inconsistent value
}


# -- P0 Metrics ----------------------------------------------------------------

def count_iso_hidden(tree):
    """Count hidden-line groups in the ISO cell."""
    root = tree.getroot()
    iso_cell = cell_bbox("iso")
    count = 0

    for elem in root:
        cls = elem.get("class", "")
        if cls not in HIDDEN_CLASSES:
            continue
        center = group_center(elem)
        if center and iso_cell.contains(*center):
            count += 1

    return count


def detect_overflow(tree):
    """Find geometry elements that exceed their view cell boundaries.

    Returns list of overflow details.
    """
    root = tree.getroot()
    overflows = []

    for elem in root:
        cls = elem.get("class", "")
        if cls not in GEOMETRY_CLASSES:
            continue

        center = group_center(elem)
        if not center:
            continue

        view = classify_by_position(*center)
        if not view:
            continue

        cell = cell_bbox(view)
        bb = elem_bbox_approx(elem)
        if bb is None:
            continue

        # Check if group bbox exceeds cell
        dx_left = max(0, cell.x - bb.x)
        dx_right = max(0, (bb.x + bb.w) - (cell.x + cell.w))
        dy_top = max(0, cell.y - bb.y)
        dy_bottom = max(0, (bb.y + bb.h) - (cell.y + cell.h))
        overflow_px = max(dx_left, dx_right, dy_top, dy_bottom)

        if overflow_px > 2.0:  # tolerance 2mm
            overflows.append({
                "view": view,
                "class": cls,
                "overflow_mm": round(overflow_px, 1),
            })

    return overflows


def detect_text_overlaps(tree):
    """Find overlapping text element pairs (IoU > threshold).

    Only compares texts within the SAME view cell to avoid cross-view noise.
    Returns list of overlap details.
    """
    # Collect all text elements with their bboxes, grouped by view
    by_view = {}  # view_name -> list of {bbox, text}
    for elem in tree.iter():
        if local_tag(elem) != "text":
            continue
        bb = elem_bbox_approx(elem)
        if bb is None or bb.area() < 0.1:
            continue
        content = elem.text or ""
        if not content.strip():
            continue
        cx, cy = bb.center()
        view = classify_by_position(cx, cy) or "page"
        by_view.setdefault(view, []).append(
            {"bbox": bb, "text": content[:30]})

    overlaps = []
    threshold = 0.10  # IoU threshold (raised from 0.05 to reduce noise)

    for view, texts in by_view.items():
        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                bb1 = texts[i]["bbox"]
                bb2 = texts[j]["bbox"]
                iou_val = bb1.iou(bb2)
                if iou_val > threshold:
                    overlaps.append({
                        "text1": texts[i]["text"],
                        "text2": texts[j]["text"],
                        "iou": round(iou_val, 3),
                        "view": view,
                    })

    return overlaps


def detect_dim_overlaps(tree):
    """Find dimension texts overlapping with individual geometry paths.

    Compares each dimension text bbox against individual path bboxes
    (not group bboxes which are too large), with minimum area threshold.
    """
    root = tree.getroot()
    dim_texts = []
    geo_paths = []

    for elem in root:
        cls = elem.get("class", "")
        if cls.startswith("dimensions-"):
            for child in elem.iter():
                if local_tag(child) == "text":
                    bb = elem_bbox_approx(child)
                    if bb and bb.area() > 0.1:
                        dim_texts.append(bb)
        elif cls in ("hard_visible", "outer_visible"):
            # Collect individual path bboxes, not group bbox
            for child in elem:
                if local_tag(child) == "path":
                    bb = elem_bbox_approx(child)
                    if bb:
                        geo_paths.append(bb)

    overlaps = 0
    for dt in dim_texts:
        for pb in geo_paths:
            if dt.iou(pb) > 0.15:  # significant overlap required
                overlaps += 1
                break

    return overlaps


def check_notes_overflow(tree):
    """Check if general-notes text extends into title block area (y > 270)."""
    max_y = 270.0  # title block starts around y=247, with margin

    for elem in tree.iter():
        if local_tag(elem) == "g" and elem.get("class") == "general-notes":
            for child in elem:
                if local_tag(child) == "text":
                    y = float(child.get("y", 0))
                    if y > max_y:
                        return True
    return False


# -- P1 Metrics ----------------------------------------------------------------

def count_gdt_unanchored(tree):
    """Count GD&T leaders with zero-length polyline (no real anchor)."""
    count = 0

    for elem in tree.iter():
        if local_tag(elem) != "g" or elem.get("class") != "gdt-leader":
            continue
        for child in elem:
            if local_tag(child) == "polyline":
                pts = polyline_coords(child.get("points", ""))
                if len(pts) >= 2:
                    start, end = pts[0], pts[-1]
                    dist = ((end[0] - start[0])**2 + (end[1] - start[1])**2)**0.5
                    if dist < 1.0:
                        count += 1

    return count


def check_dense_iso(tree, threshold=800):
    """Check if ISO cell has excessive paths."""
    root = tree.getroot()
    iso_cell = cell_bbox("iso")
    total_paths = 0

    for elem in root:
        cls = elem.get("class", "")
        if cls not in GEOMETRY_CLASSES:
            continue
        center = group_center(elem)
        if center and iso_cell.contains(*center):
            total_paths += count_paths(elem)

    return total_paths > threshold


def count_stroke_violations(tree):
    """Count groups whose stroke attributes don't match KS profile."""
    from postprocess_svg import STROKE_PROFILE_KS, _DIM_PROFILE

    violations = 0
    for elem in tree.iter():
        if local_tag(elem) != "g":
            continue
        cls = elem.get("class", "")
        if not cls:
            continue

        profile = STROKE_PROFILE_KS.get(cls)
        if profile is None and cls.startswith("dimensions-"):
            profile = _DIM_PROFILE
        if profile is None:
            continue

        for attr, expected in profile.items():
            actual = elem.get(attr)
            if actual is not None and actual != expected:
                violations += 1
                break  # one violation per group is enough

    return violations


def count_float_precision(tree, min_decimals=4):
    """Count coordinate attributes with excessive decimal places."""
    total = 0
    coord_attrs = {"x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r",
                   "width", "height"}

    for elem in tree.iter():
        for attr in coord_attrs:
            val = elem.get(attr)
            if val and "." in val:
                decimals = len(val.split(".")[-1])
                if decimals >= min_decimals:
                    total += 1

        tag = local_tag(elem)
        if tag == "path":
            total += count_long_floats_in_str(elem.get("d", ""))
        elif tag in ("polyline", "polygon"):
            total += count_long_floats_in_str(elem.get("points", ""))

    return total


# -- Phase 19 Intent Metrics ---------------------------------------------------

import re as _re

def _classify_dim_style(text):
    """Classify dimension style from text content.

    Returns one of: "diameter", "radius", "callout", "linear".
    """
    t = text.strip()
    if t.startswith("Ø") or t.startswith("⌀"):
        return "diameter"
    if _re.match(r'^R\s*\d', t):
        return "radius"
    if _re.match(r'^C\s*\d', t):
        return "callout"
    return "linear"


def _extract_tolerance(text):
    """Extract tolerance annotation from dimension text, or None."""
    m = _re.search(r'[±]\s*([\d.]+)', text)
    if m:
        return float(m.group(1))
    # Upper/lower tolerance: +0.1/-0.05
    m = _re.search(r'[+]([\d.]+)\s*/\s*[\-]([\d.]+)', text)
    if m:
        return (float(m.group(1)), float(m.group(2)))
    return None


def _extract_dim_entries(tree):
    """Extract structured dimension entries from text elements, grouped by view.

    Returns: {view_name: [DimEntry, ...]}
    where DimEntry = {"value": float, "style": str, "text": str, "tol": ...}
    """
    view_entries = {}
    for elem in tree.iter():
        tag = local_tag(elem)
        if tag != "text":
            continue
        text = (elem.text or "").strip()
        if not text:
            continue
        if text in ("FRONT", "TOP", "RIGHT", "ISO", "NOTES:", "A", "B", "C"):
            continue
        nums = _re.findall(r'[\d]+(?:\.[\d]+)?', text)
        if not nums:
            continue
        bbox = elem_bbox_approx(elem)
        if not bbox:
            continue
        view = classify_by_position(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2)
        if not view:
            continue
        style = _classify_dim_style(text)
        tol = _extract_tolerance(text)
        for n in nums:
            entry = {"value": float(n), "style": style, "text": text, "tol": tol}
            view_entries.setdefault(view, []).append(entry)
    return view_entries


def _extract_dim_numbers(tree):
    """Extract dimension numbers from text elements, grouped by view cell.

    Thin wrapper over _extract_dim_entries for backward compatibility.
    """
    entries = _extract_dim_entries(tree)
    return {view: [e["value"] for e in elist] for view, elist in entries.items()}


def check_dim_completeness(tree, plan):
    """Count missing required dim_intents from plan.
    Returns 0 if no plan (backward compatible).
    """
    if not plan:
        return 0
    dim_intents = plan.get("dim_intents", [])
    required = [d for d in dim_intents if d.get("required")]
    if not required:
        return 0

    # Collect all text content from SVG
    all_texts = []
    for elem in tree.iter():
        if local_tag(elem) == "text":
            t = (elem.text or "").strip()
            if t:
                all_texts.append(t)
    all_text_joined = " ".join(all_texts)

    missing = 0
    for dim in required:
        style = dim.get("style", "")
        feature = dim.get("feature", "")
        found = False

        if style == "diameter":
            # Look for Ø symbol + any number
            found = "Ø" in all_text_joined or "⌀" in all_text_joined
        elif style == "linear":
            # At least some numeric dimension exists
            found = bool(_re.search(r'\d+\.?\d*', all_text_joined))
        elif style == "note":
            # Bolt count: look for "Nx" or "N holes" pattern
            if "count" in feature:
                found = bool(_re.search(r'\d+[\-x×]', all_text_joined))
            else:
                found = True  # generic notes assumed present
        elif style == "callout":
            # Chamfer callout: "C" + number
            found = bool(_re.search(r'C\s*\d', all_text_joined))
        elif style == "radius":
            # R + number
            found = bool(_re.search(r'R\s*\d', all_text_joined))
        else:
            found = True  # unknown style, assume present

        if not found:
            missing += 1

    return missing


def check_dim_redundancy(tree, plan=None):
    """Count duplicate dimension values across different views.

    Redundancy rules (Phase 19.1):
      A dimension is redundant when it appears in multiple views with:
        - Same value within tolerance: max(tol_mm, 0.2% of value)
        - Same style (diameter/linear/radius/callout)
      Exceptions (NOT counted as redundant):
        - Different tolerance annotations (inspection dimension)
        - inspection_redundancy_allowed flag in dim_intents (future)
      Parameters:
        - plan.dimensioning.redundancy_tol_mm overrides base tolerance (default 0.5)
    """
    view_entries = _extract_dim_entries(tree)
    if len(view_entries) < 2:
        return 0

    # Read tolerance from plan or use default
    base_tol = 0.5
    if plan:
        base_tol = plan.get("dimensioning", {}).get("redundancy_tol_mm", 0.5)

    # Build per-view sets of (rounded_value, style, tol_signature)
    # tol_signature distinguishes dimensions with different tolerance annotations
    view_dim_keys = {}  # {view: set of (rounded_val, style, tol_sig)}
    for view, entries in view_entries.items():
        keys = set()
        for e in entries:
            val = e["value"]
            tol = max(base_tol, 0.002 * val)
            rounded = round(val / tol) * tol
            tol_sig = str(e["tol"]) if e["tol"] is not None else ""
            keys.add((rounded, e["style"], tol_sig))
        view_dim_keys[view] = keys

    # Count (value, style, tol_sig) appearing in multiple views
    all_keys = {}  # {key: set of views}
    for view, keys in view_dim_keys.items():
        for k in keys:
            all_keys.setdefault(k, set()).add(view)

    # Only count as redundant if same style AND same tolerance annotation
    duplicates = sum(1 for k, views in all_keys.items() if len(views) > 1)
    return duplicates


def check_datum_coherence(tree):
    """Check if dimension extension lines originate from consistent baselines.
    Returns True if incoherent (too many origins), False if coherent.
    """
    # Collect x-starts of horizontal dimension lines and y-starts of vertical ones
    h_origins = []
    v_origins = []

    for elem in tree.iter():
        tag = local_tag(elem)
        cls = elem.get("class", "")
        if not cls.startswith("dimensions-"):
            continue

        if tag == "line":
            x1 = float(elem.get("x1", 0))
            y1 = float(elem.get("y1", 0))
            x2 = float(elem.get("x2", 0))
            y2 = float(elem.get("y2", 0))
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)
            # Extension line (short, mostly vertical or horizontal)
            if dx < 2 and dy > 3:
                v_origins.append(round(x1, 0))
            elif dy < 2 and dx > 3:
                h_origins.append(round(y1, 0))

    # Cluster origins: count distinct clusters with tolerance
    def count_clusters(values, tol=3):
        if not values:
            return 0
        sorted_vals = sorted(set(values))
        clusters = 1
        for i in range(1, len(sorted_vals)):
            if sorted_vals[i] - sorted_vals[i - 1] > tol:
                clusters += 1
        return clusters

    h_clusters = count_clusters(h_origins)
    v_clusters = count_clusters(v_origins)

    # Incoherent if more than 3 distinct baselines in either direction
    return (h_clusters > 3) or (v_clusters > 3)


def check_view_coverage(tree, plan):
    """Check if required dim_intents have dimensions in their target view.
    Returns True if uncovered features exist, False otherwise.
    Returns False if no plan (backward compatible).
    """
    if not plan:
        return False
    dim_intents = plan.get("dim_intents", [])
    required = [d for d in dim_intents if d.get("required") and d.get("view") != "notes"]
    if not required:
        return False

    view_nums = _extract_dim_numbers(tree)

    for dim in required:
        target_view = dim.get("view", "")
        if target_view not in view_nums or not view_nums[target_view]:
            return True  # uncovered

    return False


def check_note_convention(tree):
    """Check general-notes compliance: position, line spacing, wrap width.
    Returns violation count (max 3).
    """
    violations = 0
    notes_group = None

    for elem in tree.iter():
        cls = elem.get("class", "")
        if "general-notes" in cls:
            notes_group = elem
            break

    if notes_group is None:
        return 0  # no notes to check

    texts = list(notes_group.iter())
    text_elems = [e for e in texts if local_tag(e) == "text"]
    if not text_elems:
        return 0

    # Check 1: notes should be in bottom-left region (x < 200, y > 200)
    first_y = float(text_elems[0].get("y", 0))
    first_x = float(text_elems[0].get("x", 0))
    if first_x > 200 or first_y < 200:
        violations += 1

    # Check 2: line spacing consistency (should be ~3.5-5.0mm)
    if len(text_elems) >= 2:
        y_values = [float(e.get("y", 0)) for e in text_elems]
        spacings = [y_values[i + 1] - y_values[i] for i in range(len(y_values) - 1)]
        spacings = [s for s in spacings if s > 0]
        if spacings:
            avg_spacing = sum(spacings) / len(spacings)
            if avg_spacing < 3.0 or avg_spacing > 6.0:
                violations += 1

    # Check 3: text should not extend beyond x=200 (wrap width)
    for te in text_elems:
        bbox = elem_bbox_approx(te)
        if bbox and bbox.x + bbox.w > 200:
            violations += 1
            break

    return min(violations, 3)


# -- Phase 20-A: Presence Enforcement Metrics ----------------------------------

def check_required_presence(tree, plan):
    """Check required dim_intents presence in SVG.

    For each required intent with value_mm, verify the value appears in SVG text.
    Returns: (rate_pct, total_required, missing_ids)
    """
    if not plan:
        return 100, 0, []

    dim_intents = plan.get("dim_intents", [])
    required = [d for d in dim_intents
                if d.get("required") and d.get("value_mm") is not None]
    if not required:
        return 100, 0, []

    # Collect all numeric values from SVG text
    svg_values = []
    for elem in tree.iter():
        if local_tag(elem) == "text":
            t = (elem.text or "").strip()
            if not t:
                continue
            # Extract numbers (including after Ø, R, C prefixes)
            for m in _re.finditer(r'[\d]+\.?\d*', t):
                try:
                    svg_values.append(float(m.group()))
                except ValueError:
                    pass

    missing = []
    for di in required:
        val = di["value_mm"]
        found = False
        for sv in svg_values:
            if abs(sv - val) <= max(0.5, 0.002 * val):
                found = True
                break
        if not found:
            missing.append(di.get("id", "?"))

    total = len(required)
    present = total - len(missing)
    rate = round(present / total * 100) if total > 0 else 100
    return rate, total, missing


def check_value_consistency(tree, plan):
    """Check plan value_mm vs actual SVG dimension values.

    For each intent with value_mm that IS found in SVG, verify the closest
    match is within tolerance (max(1.0, 1% of value)).
    Returns: number of inconsistencies.
    """
    if not plan:
        return 0

    dim_intents = plan.get("dim_intents", [])
    with_values = [d for d in dim_intents if d.get("value_mm") is not None]
    if not with_values:
        return 0

    # Collect all numeric values from SVG text
    svg_values = []
    for elem in tree.iter():
        if local_tag(elem) == "text":
            t = (elem.text or "").strip()
            for m in _re.finditer(r'[\d]+\.?\d*', t):
                try:
                    svg_values.append(float(m.group()))
                except ValueError:
                    pass

    inconsistencies = 0
    for di in with_values:
        val = di["value_mm"]
        tol = max(1.0, 0.01 * val)
        # Find closest SVG value
        best_diff = float("inf")
        for sv in svg_values:
            diff = abs(sv - val)
            if diff < best_diff:
                best_diff = diff
        # Only flag if a close value exists but deviates beyond tolerance
        if best_diff < val * 0.3 and best_diff > tol:
            inconsistencies += 1

    return inconsistencies


# -- Score computation ---------------------------------------------------------

def collect_metrics(tree, plan=None):
    """Run all checks and return metrics dict.

    Plan-dependent metrics return None when no plan is provided,
    signaling "not applicable" rather than "zero issues found".
    """
    overflows = detect_overflow(tree)
    text_overlaps = detect_text_overlaps(tree)
    has_plan = plan is not None

    # Phase 20-A: required presence check
    if has_plan:
        _pres_rate, _pres_total, _pres_missing = check_required_presence(tree, plan)
    else:
        _pres_rate, _pres_total, _pres_missing = 100, 0, []

    return {
        "intent_metrics_applicable": has_plan,
        "iso_hidden_count": count_iso_hidden(tree),
        "overflow_count": len(overflows),
        "text_overlap_pairs": len(text_overlaps),
        "dim_overlap_pairs": detect_dim_overlaps(tree),
        "notes_overflow": check_notes_overflow(tree),
        "gdt_unanchored": count_gdt_unanchored(tree),
        "dense_iso": check_dense_iso(tree),
        "stroke_violations": count_stroke_violations(tree),
        "float_precision_count": count_float_precision(tree),
        # Phase 19 intent metrics (None = not applicable without plan)
        "dim_completeness": check_dim_completeness(tree, plan) if has_plan else None,
        "dim_redundancy": check_dim_redundancy(tree, plan),
        "datum_coherence": check_datum_coherence(tree),
        "view_coverage": check_view_coverage(tree, plan) if has_plan else None,
        "note_convention": check_note_convention(tree),
        # Phase 20-A presence enforcement metrics
        "required_presence_rate": _pres_rate if has_plan else None,
        "required_presence_miss": len(_pres_missing) if has_plan else None,
        "value_inconsistency": check_value_consistency(tree, plan) if has_plan else None,
        "_details": {
            "overflows": overflows,
            "text_overlaps": text_overlaps[:10],  # limit detail output
            "required_presence_missing_ids": _pres_missing if has_plan else [],
        },
    }


def compute_score(metrics):
    """Compute 100-point score with itemized deductions."""
    score = 100
    deductions = {}

    def deduct(key, amount):
        nonlocal score
        if amount > 0:
            deductions[key] = -amount
            score -= amount

    deduct("iso_hidden_count",
           metrics["iso_hidden_count"] * WEIGHTS["iso_hidden_count"])
    deduct("overflow_count",
           metrics["overflow_count"] * WEIGHTS["overflow_count"])
    deduct("text_overlap_pairs",
           metrics["text_overlap_pairs"] * WEIGHTS["text_overlap_pairs"])
    deduct("dim_overlap_pairs",
           metrics["dim_overlap_pairs"] * WEIGHTS["dim_overlap_pairs"])
    if metrics["notes_overflow"]:
        deduct("notes_overflow", WEIGHTS["notes_overflow"])
    deduct("gdt_unanchored",
           metrics["gdt_unanchored"] * WEIGHTS["gdt_unanchored"])
    if metrics["dense_iso"]:
        deduct("dense_iso", WEIGHTS["dense_iso"])
    deduct("stroke_violations",
           metrics["stroke_violations"] * WEIGHTS["stroke_violations"])
    deduct("float_precision",
           min(metrics["float_precision_count"] // 10, 5) * WEIGHTS["float_precision"])
    # Phase 19 intent metrics (skip None = not applicable)
    if metrics.get("dim_completeness") is not None:
        deduct("dim_completeness",
               metrics["dim_completeness"] * WEIGHTS["dim_completeness"])
    if metrics.get("dim_redundancy") is not None:
        deduct("dim_redundancy",
               metrics["dim_redundancy"] * WEIGHTS["dim_redundancy"])
    if metrics.get("datum_coherence"):
        deduct("datum_coherence", WEIGHTS["datum_coherence"])
    if metrics.get("view_coverage") is not None and metrics["view_coverage"]:
        deduct("view_coverage", WEIGHTS["view_coverage"])
    if metrics.get("note_convention") is not None:
        deduct("note_convention",
               min(metrics["note_convention"], 3) * WEIGHTS["note_convention"])
    # Phase 20-A presence enforcement
    if metrics.get("required_presence_miss") is not None:
        deduct("required_presence_miss",
               metrics["required_presence_miss"] * WEIGHTS["required_presence_miss"])
    if metrics.get("value_inconsistency") is not None:
        deduct("value_inconsistency",
               metrics["value_inconsistency"] * WEIGHTS["value_inconsistency"])

    return max(score, 0), deductions


# -- CLI -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Drawing QA Scorer — measure SVG quality")
    parser.add_argument("input", help="Input SVG file")
    parser.add_argument("--json", dest="json_out", help="Save JSON report")
    parser.add_argument("--plan", dest="plan_file", help="Drawing plan file (TOML or JSON) for intent metrics")
    parser.add_argument("--fail-under", type=int, default=0,
                        help="Exit with error if score < threshold")
    args = parser.parse_args()

    tree = load_svg(args.input)

    # Load plan if provided (TOML or JSON, for intent-aware metrics)
    plan = None
    if args.plan_file and os.path.exists(args.plan_file):
        try:
            if args.plan_file.endswith(".toml"):
                import tomllib
                with open(args.plan_file, "rb") as pf:
                    plan_data = tomllib.load(pf)
            else:
                with open(args.plan_file) as pf:
                    plan_data = json.load(pf)
            plan = plan_data.get("drawing_plan", plan_data)
        except Exception:
            pass  # plan is optional

    metrics = collect_metrics(tree, plan)
    score, deductions = compute_score(metrics)

    # Print summary
    filename = os.path.basename(args.input)
    print(f"QA Score: {score}/100  [{filename}]")
    for key in sorted(metrics):
        if key.startswith("_"):
            continue
        val = metrics[key]
        if val is None:
            print(f"  {key}: N/A")
            continue
        ded = deductions.get(key, 0)
        ded_str = f" ({ded})" if ded else ""
        print(f"  {key}: {val}{ded_str}")

    # JSON report
    if args.json_out:
        report = {
            "file": filename,
            "score": score,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "metrics": {k: v for k, v in metrics.items() if not k.startswith("_")},
            "deductions": deductions,
            "details": metrics.get("_details", {}),
        }
        with open(args.json_out, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"  Report: {args.json_out}")

    if args.fail_under and score < args.fail_under:
        print(f"  FAIL: score {score} < threshold {args.fail_under}")
        sys.exit(1)


if __name__ == "__main__":
    main()
