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


# -- Score computation ---------------------------------------------------------

def collect_metrics(tree):
    """Run all checks and return metrics dict."""
    overflows = detect_overflow(tree)
    text_overlaps = detect_text_overlaps(tree)

    return {
        "iso_hidden_count": count_iso_hidden(tree),
        "overflow_count": len(overflows),
        "text_overlap_pairs": len(text_overlaps),
        "dim_overlap_pairs": detect_dim_overlaps(tree),
        "notes_overflow": check_notes_overflow(tree),
        "gdt_unanchored": count_gdt_unanchored(tree),
        "dense_iso": check_dense_iso(tree),
        "stroke_violations": count_stroke_violations(tree),
        "float_precision_count": count_float_precision(tree),
        "_details": {
            "overflows": overflows,
            "text_overlaps": text_overlaps[:10],  # limit detail output
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

    return max(score, 0), deductions


# -- CLI -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Drawing QA Scorer — measure SVG quality")
    parser.add_argument("input", help="Input SVG file")
    parser.add_argument("--json", dest="json_out", help="Save JSON report")
    parser.add_argument("--fail-under", type=int, default=0,
                        help="Exit with error if score < threshold")
    args = parser.parse_args()

    tree = load_svg(args.input)
    metrics = collect_metrics(tree)
    score, deductions = compute_score(metrics)

    # Print summary
    filename = os.path.basename(args.input)
    print(f"QA Score: {score}/100  [{filename}]")
    for key in sorted(metrics):
        if key.startswith("_"):
            continue
        val = metrics[key]
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
