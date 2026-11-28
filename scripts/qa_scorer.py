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
import math
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from svg_common import (
    load_svg, local_tag, svg_tag,
    cell_bbox, classify_by_position, group_center, count_paths,
    elem_bbox_approx, svg_contexts, polyline_coords, count_long_floats_in_str,
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
    # Phase 20-B virtual geometry + note metrics
    "virtual_pcd_missing":    5,   # boolean (PCD required but no virtual circle)
    "note_semantic_mismatch": 3,   # per mismatch in bolt count note
    # Phase 23 DFM metrics
    "dfm_error_count":       10,   # per DFM error
    "dfm_warning_count":      3,   # per DFM warning
}

WEIGHT_PRESETS = {
    # Preserve current behaviour.
    "default": {},
    # Flange: PCD/bolt semantics and note conformity are critical.
    "flange": {
        "virtual_pcd_missing": 10,
        "note_semantic_mismatch": 4,
        "note_convention": 2,
    },
    # Shaft: baseline coherence/value consistency are more important.
    "shaft": {
        "datum_coherence": 5,
        "value_inconsistency": 4,
        "view_coverage": 6,
    },
    "bracket": {
        "view_coverage": 6,
        "dim_completeness": 6,
    },
    "housing": {
        "dim_completeness": 6,
        "datum_coherence": 4,
    },
    "assembly": {
        "note_convention": 2,
        "view_coverage": 6,
    },
}


def _load_toml_file(path):
    try:
        import tomllib
    except ImportError:
        import tomli as tomllib
    with open(path, "rb") as f:
        return tomllib.load(f)


def _is_dimension_group_class(cls):
    return cls.startswith("dimensions-") or cls.startswith("plan-dimensions-")


def _iter_dimension_lines(tree):
    """Yield dimension line elements, whether grouped or directly tagged."""
    for elem in tree.iter():
        if local_tag(elem) == "line" and _is_dimension_group_class(elem.get("class", "")):
            yield elem
            continue
        if local_tag(elem) != "g":
            continue
        if not _is_dimension_group_class(elem.get("class", "")):
            continue
        for child in elem.iter():
            if local_tag(child) == "line":
                yield child


def resolve_weights(plan=None, preset=None):
    """Resolve QA deduction weights with optional part-type presets.

    Priority:
      explicit CLI preset > plan.dimensioning.qa_weight_preset > default
    Special value:
      auto -> use plan.part_type when available
    """
    requested = preset
    if not requested and plan:
        requested = plan.get("dimensioning", {}).get("qa_weight_preset")
    if not requested:
        requested = "default"

    profile = str(requested).lower()
    if profile == "auto":
        profile = str((plan or {}).get("part_type", "default")).lower()
    if profile not in WEIGHT_PRESETS:
        profile = "default"

    weights = dict(WEIGHTS)
    weights.update(WEIGHT_PRESETS.get(profile, {}))
    return weights, profile


def resolve_stroke_profile(plan=None, config=None):
    """Resolve expected stroke profile from plan/config, defaulting to KS."""
    profile = None
    if config:
        profile = (((config.get("drawing_plan") or {}).get("style") or {})
                   .get("stroke_profile"))
    if not profile and plan:
        profile = ((plan.get("style") or {}).get("stroke_profile"))
    profile = str(profile or "ks").lower()
    return profile if profile in {"ks", "exam"} else "ks"


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
    contexts = svg_contexts(tree.getroot())
    for elem in tree.iter():
        if local_tag(elem) != "text":
            continue
        bb = elem_bbox_approx(elem, contexts)
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
    contexts = svg_contexts(root)
    dim_texts = []
    geo_paths = []

    for elem in root:
        cls = elem.get("class", "")
        if _is_dimension_group_class(cls):
            for child in elem.iter():
                if local_tag(child) == "text":
                    bb = elem_bbox_approx(child, contexts)
                    if bb and bb.area() > 0.1:
                        dim_texts.append(bb)
        elif cls in ("hard_visible", "outer_visible"):
            # Collect individual path bboxes, not group bbox
            for child in elem:
                if local_tag(child) == "path":
                    bb = elem_bbox_approx(child, contexts)
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


def count_stroke_violations(tree, profile_name="ks"):
    """Count groups whose stroke attributes don't match the active profile."""
    from postprocess_svg import PROFILES, _DIM_PROFILE

    profile_name = str(profile_name or "ks").lower()
    active_profile = PROFILES.get(profile_name, PROFILES["ks"])
    violations = 0
    for elem in tree.iter():
        if local_tag(elem) != "g":
            continue
        cls = elem.get("class", "")
        if not cls:
            continue

        expected_profile = active_profile.get(cls)
        if expected_profile is None and _is_dimension_group_class(cls):
            expected_profile = _DIM_PROFILE
        if expected_profile is None:
            continue

        for attr, expected in expected_profile.items():
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


def _extract_dim_entries(tree, excluded=None, contexts=None):
    """Extract structured dimension entries from text elements, grouped by view.

    Returns: {view_name: [DimEntry, ...]}
    where DimEntry = {"value": float, "style": str, "text": str, "tol": ...}
    """
    view_entries = {}
    for elem in tree.iter():
        if excluded and elem in excluded:
            continue
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
        context = (contexts or {}).get(elem)
        view = context[0] if context and context[1] else None
        if not view:
            bbox = elem_bbox_approx(elem)
            if not bbox:
                continue
            view = classify_by_position(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2)
        if not view:
            continue
        style = _classify_dim_style(text)
        tol = _extract_tolerance(text)
        value_attr = elem.get("data-value-mm")
        if value_attr is not None:
            try:
                value = float(value_attr)
                if not math.isfinite(value):
                    raise ValueError("nonfinite value metadata")
                entry = {"value": value, "style": style, "text": text, "tol": tol}
                view_entries.setdefault(view, []).append(entry)
                continue
            except ValueError:
                pass
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


def _has_matching_pcd_callout(tree, pcd_value):
    tol = max(0.5, 0.002 * abs(float(pcd_value)))
    for elem in tree.iter():
        if local_tag(elem) != "text" or not elem.text:
            continue
        text = (elem.text or "").strip()
        if "PCD" not in text.upper():
            continue
        for match in _re.finditer(r'[\d]+(?:\.[\d]+)?', text):
            try:
                value = float(match.group())
            except ValueError:
                continue
            if abs(value - float(pcd_value)) <= tol:
                return True
    return False


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


def _dimension_contexts(tree):
    """Only dimension/view ancestry needed by the two deduction checks."""
    contexts, parents = {}, {}
    def visit(element, view=None, dimensions=False, blocked=False):
        classes = element.get("class", "").split()
        explicit = element.get("data-view-id")
        if explicit in ("front", "top", "right", "iso"):
            view = explicit
        for cls in classes:
            if _is_dimension_group_class(cls):
                dimensions = True
                candidate = cls.removeprefix("plan-").removeprefix("dimensions-")
                if candidate in ("front", "top", "right", "iso"):
                    view = candidate
        style = element.get("style", "").replace(" ", "").lower()
        blocked = blocked or element.get("display") == "none" or element.get("visibility") == "hidden" or element.get("opacity") == "0" or any(x in style for x in ("display:none", "visibility:hidden", "opacity:0;"))
        if local_tag(element) == "g" and element.get("transform"):
            blocked = True
        contexts[element] = (view, dimensions, blocked)
        for child in element:
            parents[child] = element
            visit(child, view, dimensions, blocked)
    visit(tree.getroot())
    return contexts, parents


def _current_visible_projection_geometry(tree, contexts):
    """Read only the generator's supported visible line/circle primitives."""
    result = {}
    def visit(element, visible=False):
        visible = visible or bool(set(element.get('class', '').split()) &
                                  {'hard_visible', 'outer_visible', 'smooth_visible', 'iso_visible'})
        view, _, blocked = contexts[element]
        if visible and not blocked and view in ('front', 'top', 'right') and not element.get('transform'):
            entry = result.setdefault(view, {'circles': [], 'segments': []})
            try:
                tag = local_tag(element)
                if tag == 'circle':
                    circle = tuple(float(element.get(k)) for k in ('cx', 'cy', 'r'))
                    if all(math.isfinite(n) for n in circle) and circle[2] > 0:
                        entry['circles'].append(circle)
                elif tag == 'line':
                    values = [float(element.get(k)) for k in ('x1', 'y1', 'x2', 'y2')]
                    if all(math.isfinite(n) for n in values):
                        entry['segments'].append((values[:2], values[2:]))
                elif tag == 'path':
                    raw = element.get('d', '')
                    commands = _re.findall(r'[A-Za-z]', raw)
                    if commands.count('M') == 1 and set(commands) <= {'M', 'L', 'Z'}:
                        numbers = [float(n) for n in _re.findall(r'[-+]?(?:\d*\.\d+|\d+)', raw)]
                        if len(numbers) % 2 == 0 and all(math.isfinite(n) for n in numbers):
                            points = list(zip(numbers[::2], numbers[1::2]))
                            entry['segments'].extend(zip(points, points[1:]))
                            if 'Z' in commands and points:
                                entry['segments'].append((points[-1], points[0]))
            except (TypeError, ValueError):
                pass  # Unsupported geometry is not proof of a reference.
        for child in element:
            visit(child, visible)
    visit(tree.getroot())
    return result


def _point_on_visible_segment(point, start, finish, tolerance=.011):
    dx, dy = finish[0]-start[0], finish[1]-start[1]
    length = dx*dx+dy*dy
    if length == 0:
        return math.dist(point, start) <= tolerance
    t = ((point[0]-start[0])*dx+(point[1]-start[1])*dy)/length
    t = max(0, min(1, t))
    return math.dist(point, (start[0]+t*dx, start[1]+t*dy)) <= tolerance


def _verified_dimension_annotations(tree, plan=None):
    """Validate individual producer annotations before giving identity to them.

    Invalid metadata cannot exempt an SVG, group, or unrelated legacy line.
    This validates current drawing primitives, not physical manufacturing quality.
    """
    contexts, parents = _dimension_contexts(tree)
    visible_geometry = _current_visible_projection_geometry(tree, contexts)
    groups = {}
    for element in tree.iter():
        annotation = element.get("data-annotation-id")
        if annotation:
            groups.setdefault(("annotation", annotation), set()).add(element)
        elif local_tag(element) == "text" and element.get("data-measurement-kind"):
            groups.setdefault(("plan", id(parents.get(element)), element.get("data-dim-id")), set()).add(element)
        elif local_tag(element) == "line" and element.get("data-reference-kind"):
            groups.setdefault(("plan", id(parents.get(element)), element.get("data-dim-id")), set()).add(element)
    # Plan shafts/extensions retain their existing dim-id contract.
    for key, elements in groups.items():
        labels = [e for e in elements if local_tag(e) == "text" and e.get("data-annotation-role") != "tolerance"]
        if len(labels) == 1 and labels[0].get("data-dim-id"):
            label = labels[0]
            elements.update(e for e in parents.get(label, []) if e.get("data-dim-id") == label.get("data-dim-id"))
    # An annotation-id owns its primitives; do not re-evaluate its plan subset.
    owned = set().union(*(value for key, value in groups.items() if key[0] == "annotation")) if groups else set()
    groups = {key: value for key, value in groups.items() if key[0] != "plan" or not value.intersection(owned)}
    binding_issues = check_linear_bindings(tree, plan)
    bad_ids = {issue.get("dim_id") for issue in binding_issues}
    valid, invalid, duplicate_labels = [], [], []
    def number(element, attr):
        value = float(element.get(attr))
        if not math.isfinite(value):
            raise ValueError("nonfinite_reference")
        return value
    def point(element, prefix):
        return number(element, prefix + "-x"), number(element, prefix + "-y")
    def close(a, b, tolerance=.011):
        return abs(a-b) <= tolerance
    for key, elements in groups.items():
        annotation_id = str(key[-1])
        try:
            labels = [e for e in elements if local_tag(e) == "text" and e.get("data-annotation-role") != "tolerance"]
            if len(labels) != 1:
                # A copied annotation ID is invalid for reference validation,
                # but exact repeated labels must still count as redundancy.
                signatures = {}
                for duplicate in labels:
                    signature = (tuple(sorted(duplicate.attrib.items())), "".join(duplicate.itertext()))
                    signatures[signature] = signatures.get(signature, 0) + 1
                repeated = sum(count - 1 for count in signatures.values())
                if repeated:
                    duplicate_labels.append({"annotation_id": annotation_id, "count": repeated})
                raise ValueError("missing_or_duplicate_label")
            label = labels[0]
            view, in_dimensions, blocked = contexts[label]
            if blocked or not in_dimensions or view not in ("front", "top", "right"):
                raise ValueError("invalid_annotation_view")
            if label.get("data-dim-id") in bad_ids:
                raise ValueError("invalid_current_reference")
            kind = label.get("data-measurement-kind")
            family, feature, model = (label.get(a) for a in ("data-measurement-family", "data-feature-id", "data-model-object-id"))
            axis = label.get("data-model-axis")
            if kind not in ("linear", "diameter") or family not in ("body_extent", "feature_reference", "circle") or not feature or not model or axis not in "XYZ":
                raise ValueError("incomplete_measurement_identity")
            ra, rb, scale = (number(label, a) for a in ("data-model-reference-a", "data-model-reference-b", "data-scale"))
            if scale <= 0 or rb <= ra or (family == "body_extent" and feature != model):
                raise ValueError("invalid_model_reference")
            text = "".join(label.itertext()).strip()
            nominal_match = _re.match(r"^(?:[Ø⌀]\s*)?(\d+(?:\.\d+)?)", text)
            if not nominal_match or (kind == "diameter") != text.startswith(("Ø", "⌀")):
                raise ValueError("invalid_visible_value")
            value = float(nominal_match.group(1))
            if not close(value, rb-ra, .050001):
                raise ValueError("visible_reference_mismatch")
            tolerance_texts = ["".join(e.itertext()).strip() for e in elements if e.get("data-annotation-role") == "tolerance"]
            tolerance = _extract_tolerance(" ".join([text, *tolerance_texts]))
            declared_tolerance = label.get("data-tolerance-text")
            if declared_tolerance is not None and _extract_tolerance(declared_tolerance) != tolerance:
                raise ValueError("tolerance_evidence_mismatch")
            lines = [e for e in elements if local_tag(e) == "line"]
            if any(contexts[e][2] or e.get("transform") for e in lines):
                raise ValueError("transformed_or_hidden_geometry")
            if kind == "linear":
                page_axis = label.get("data-page-axis")
                physical_axes = {"top": {"u": "X", "v": "Y"}, "front": {"u": "X", "v": "Z"}, "right": {"u": "Y", "v": "Z"}}
                if physical_axes[view].get(page_axis) != axis:
                    raise ValueError("model_projection_axis_mismatch")
                anchors = [point(label, "data-reference-a"), point(label, "data-reference-b")]
                projected = label.get('data-reference-projection') == 'axis'
                if projected:
                    if label.get('data-reference-kind') != 'visible_projection':
                        raise ValueError('unverified_projection_reference')
                    current = visible_geometry.get(view, {'circles': [], 'segments': []})
                    for name, anchor in zip(('a', 'b'), anchors):
                        reference_kind = label.get(f'data-reference-{name}-kind')
                        if reference_kind == 'circle_center':
                            radius = number(label, f'data-reference-{name}-radius-page-mm')
                            if radius <= 0 or not any(close(anchor[0], c[0]) and close(anchor[1], c[1])
                                                     and close(radius, c[2]) for c in current['circles']):
                                raise ValueError('visible_circle_reference_missing_or_changed')
                        elif reference_kind == 'outline_point':
                            if not any(_point_on_visible_segment(anchor, a, b) for a, b in current['segments']):
                                raise ValueError('visible_outline_reference_missing_or_changed')
                        else:
                            raise ValueError('unverified_projection_reference')
                dim_axis = 0 if page_axis == "u" else 1
                other = 1-dim_axis
                shafts = [e for e in lines if e.get("data-annotation-role") == "dimension-line" or e.get("data-dimension-line") == "linear"]
                extensions = [e for e in lines if e.get("data-annotation-role") in ("extension-a", "extension-b") or e.get("data-dimension-extension") == "linear"]
                if len(shafts) != 1 or len(extensions) != 2 or len(lines) != 3:
                    raise ValueError("missing_or_duplicate_linear_anchors")
                shaft = shafts[0]
                ends = [(number(shaft, "x1"), number(shaft, "y1")), (number(shaft, "x2"), number(shaft, "y2"))]
                if (not projected and not close(anchors[0][other], anchors[1][other])) or not close(ends[0][other], ends[1][other]) or not close(abs(anchors[1][dim_axis]-anchors[0][dim_axis])/scale, rb-ra, .011/scale + 1e-6):
                    raise ValueError("linear_reference_span_mismatch")
                if any(not close(a,b) for a,b in zip(sorted(p[dim_axis] for p in ends), sorted(p[dim_axis] for p in anchors))):
                    raise ValueError("linear_target_mismatch")
                used = set()
                for extension in extensions:
                    role = extension.get("data-annotation-role")
                    index = (0 if role == "extension-a" else 1) if role in ("extension-a", "extension-b") else int(extension.get("data-endpoint-index"))
                    if index not in (0, 1) or index in used:
                        raise ValueError("duplicate_extension_reference")
                    used.add(index)
                    e1 = (number(extension, "x1"), number(extension, "y1")); e2 = (number(extension, "x2"), number(extension, "y2"))
                    if not close(e1[dim_axis], anchors[index][dim_axis]) or not close(e2[dim_axis], anchors[index][dim_axis]) or not min(e1[other],e2[other])-.011 <= ends[0][other] <= max(e1[other],e2[other])+.011:
                        raise ValueError("extension_target_mismatch")
                    gap_axis = "y" if page_axis == "u" else "x"
                    gap = number(extension, "data-gap-" + gap_axis)
                    declared_gap = label.get("data-extension-gap-" + gap_axis)
                    direction = (ends[0][other] - anchors[index][other]) * (1 if page_axis == "u" else -1)
                    if gap * direction <= 0 or not close(e1[other], anchors[index][other] + gap) or (declared_gap is not None and not close(gap, number(label, "data-extension-gap-" + gap_axis))):
                        raise ValueError("extension_gap_mismatch")
                identity = (model, family, feature, axis, round(ra, 6), round(rb, 6), str(tolerance))
            else:
                if family != "circle" or axis != {"top": "Z", "front": "Y", "right": "X"}[view]:
                    raise ValueError("circle_axis_mismatch")
                leaders = [e for e in lines if e.get("data-annotation-role") == "leader" or e.get("data-diameter-leader") == "true"]
                shelves = [e for e in lines if e.get("data-annotation-role") == "shelf"]
                if len(leaders) != 1 or len(shelves) != 1 or len(lines) != 2:
                    raise ValueError("missing_or_duplicate_circle_anchors")
                leader, shelf = leaders[0], shelves[0]
                cx, cy, radius = (number(leader, a) for a in ("data-center-x", "data-center-y", "data-radius-page-mm"))
                start = (number(leader, "x1"), number(leader, "y1")); finish = (number(leader, "x2"), number(leader, "y2"))
                if radius <= 0 or not close(2*radius/scale, rb-ra, 1e-6) or not close(math.hypot(start[0]-cx,start[1]-cy), radius, .015) or not close(number(shelf,"x1"),finish[0]) or not close(number(shelf,"y1"),finish[1]) or not close(number(shelf,"y1"),number(shelf,"y2")):
                    raise ValueError("circle_anchor_mismatch")
                if label.get('data-visible-circle-proof') == 'final_projection' and not any(
                        close(cx, c[0]) and close(cy, c[1]) and close(radius, c[2])
                        for c in visible_geometry.get(view, {}).get('circles', [])):
                    raise ValueError('visible_circle_reference_missing_or_changed')
                center = (number(label, "data-center-u"), number(label, "data-center-v"))
                identity = (model, family, feature, axis, *center, round((rb-ra)/2, 6), str(tolerance))
            valid.append({"id": annotation_id, "identity": identity, "kind": kind, "value": value, "view": view, "elements": elements, "lines": set(lines)})
        except (TypeError, ValueError, IndexError, KeyError) as error:
            invalid.append({"annotation_id": annotation_id, "reason": str(error)})
    datums = [issue for issue in binding_issues if str(issue.get("dim_id", "")).startswith("DATUM_")]
    invalid.extend({"annotation_id": issue['dim_id'], "reason": issue['reason']} for issue in datums)
    return {"valid": valid, "invalid": invalid, "contexts": contexts, "duplicate_labels": duplicate_labels}


def check_dim_redundancy(tree, plan=None, diagnostics=None, _annotations=None):
    """Count repeated verified measurements; preserve legacy numeric fallback."""
    annotations = _annotations or _verified_dimension_annotations(tree, plan)
    counts = {}
    for annotation in annotations['valid']:
        counts.setdefault(annotation['identity'], []).append(annotation)
    typed_duplicates = sum(len(items)-1 for items in counts.values())
    copied_labels = annotations.get('duplicate_labels', [])
    copied_label_count = sum(item['count'] for item in copied_labels)
    excluded = set().union(*(item['elements'] for item in annotations['valid'])) if annotations['valid'] else set()
    view_entries = _extract_dim_entries(tree, excluded=excluded, contexts=annotations['contexts'])
    base_tol = (plan or {}).get("dimensioning", {}).get("redundancy_tol_mm", 0.5)
    legacy = {}
    for view, entries in view_entries.items():
        for entry in entries:
            value = entry['value']
            tolerance = max(base_tol, .002*value)
            key = (round(value/tolerance)*tolerance, entry['style'], str(entry['tol']) if entry['tol'] is not None else '')
            legacy.setdefault(key, set()).add(view)
    legacy_duplicates = sum(len(views)>1 for views in legacy.values())
    if diagnostics is not None:
        diagnostics.update(verified_annotation_count=len(annotations['valid']),
                           typed_duplicate_count=typed_duplicates, legacy_duplicate_count=legacy_duplicates,
                           copied_label_count=copied_label_count, copied_labels=copied_labels,
                           invalid_annotations=annotations['invalid'],
                           duplicate_annotations=[[a['id'] for a in items] for items in counts.values() if len(items)>1])
    return typed_duplicates + copied_label_count + legacy_duplicates


def check_datum_coherence(tree, diagnostics=None, _annotations=None):
    """Check unverified legacy baselines per view and flag invalid typed anchors."""
    annotations = _annotations or _verified_dimension_annotations(tree)
    excluded = set().union(*(item['lines'] for item in annotations['valid'])) if annotations['valid'] else set()
    origins = {}; legacy_count = 0; malformed = False
    for line in set(_iter_dimension_lines(tree)) - excluded:
        legacy_count += 1
        view = annotations['contexts'][line][0] or 'unknown'
        h, v = origins.setdefault(view, ([], []))
        try:
            x1,y1,x2,y2 = (float(line.get(attr, 0)) for attr in ('x1','y1','x2','y2'))
            if not all(math.isfinite(value) for value in (x1,y1,x2,y2)):
                raise ValueError('nonfinite legacy line')
        except (TypeError, ValueError):
            malformed = True; continue
        if abs(x2-x1)<2 and abs(y2-y1)>3: v.append(round(x1, 0))
        elif abs(y2-y1)<2 and abs(x2-x1)>3: h.append(round(y1, 0))
    def clusters(values):
        ordered = sorted(set(values))
        return 0 if not ordered else 1+sum(b-a>3 for a,b in zip(ordered,ordered[1:]))
    by_view = {view: {'horizontal_clusters': clusters(h), 'vertical_clusters': clusters(v)} for view,(h,v) in origins.items()}
    incoherent = bool(annotations['invalid']) or malformed or any(max(row.values())>3 for row in by_view.values())
    if diagnostics is not None:
        diagnostics.update(verified_annotations=len(annotations['valid']), excluded_line_count=len(excluded),
                           legacy_line_count=legacy_count, legacy_baselines_by_view=by_view,
                           invalid_annotations=annotations['invalid'], malformed_legacy_line=malformed)
    return incoherent


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
        if not target_view:
            continue
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

def _dimension_values(tree):
    """Read planned metadata and automatic dimension text independent of SVG order.

    Plain text is evidence only inside dimension groups; title-block numbers and
    general notes cannot establish the presence of a geometric dimension.
    """
    values = []

    def visit(elem, in_dimensions=False):
        classes = elem.get("class", "").split()
        in_dimensions = in_dimensions or any(_is_dimension_group_class(cls) for cls in classes)
        if local_tag(elem) == "text" and not elem.get("data-linear-status"):
            value_attr = elem.get("data-value-mm")
            if value_attr is not None:
                try:
                    values.append(float(value_attr))
                except ValueError:
                    pass
            elif in_dimensions:
                text = "".join(elem.itertext()).strip()
                for match in _re.finditer(r'[\d]+\.?\d*', text):
                    values.append(float(match.group()))
        for child in elem:
            visit(child, in_dimensions)

    visit(tree.getroot())
    return values


def check_linear_bindings(tree, plan=None):
    """Measure tagged SVG lines and visible labels; metadata alone is not evidence.

    This covers the plan extent renderer, not arbitrary legacy/automatic SVG
    dimensions. Endpoint rounding is 0.01 paper mm and labels use 0.1 model mm;
    these are serialization tolerances, not design/manufacturing allowances.
    """
    issues = []
    intents = {d.get("id"): d for d in (plan or {}).get("dim_intents", [])}
    for parent in tree.iter():
        children = list(parent)
        if parent.get('data-datum-name'):
            try:
                x, y = (float(parent.get(k)) for k in ('data-reference-x', 'data-reference-y'))
                leaders = [e for e in children if e.get('data-datum-leader') == 'true']
                markers = [e for e in children if e.get('data-datum-marker') == 'true']
                if len(leaders) != 1 or len(markers) != 1 or not all(math.isfinite(v) for v in (x, y)):
                    raise ValueError('missing datum target')
                lx, ly = float(leaders[0].get('x1')), float(leaders[0].get('y1'))
                mx, my = map(float, markers[0].get('points').split()[0].split(','))
                if any(not math.isfinite(v) for v in (lx, ly, mx, my)) or max(abs(lx-x), abs(ly-y), abs(mx-x), abs(my-y)) > .011:
                    raise ValueError('datum target changed')
            except (TypeError, ValueError, IndexError, AttributeError):
                issues.append({'dim_id': 'DATUM_' + parent.get('data-datum-name'),
                               'reason': 'datum_reference_geometry_mismatch'})
        for text in children:
            if local_tag(text) != "text":
                continue
            dim_id = text.get("data-dim-id")
            if text.get("data-linear-status") == "unresolved":
                issues.append({"dim_id": dim_id, "reason": text.get("data-reason"),
                               "requested_mm": text.get("data-requested-mm"),
                               "measured_mm": text.get("data-measured-mm")})
                continue
            radius_binding = text.get('data-runtime-radius') == 'true'
            if radius_binding or text.get('data-runtime-diameter') == 'true':
                measurement = 'radius' if radius_binding else 'diameter'
                leaders = [e for e in children if local_tag(e) == 'line'
                           and e.get(f'data-{measurement}-leader') == 'true' and e.get('data-dim-id') == dim_id]
                try:
                    if len(leaders) != 1:
                        raise ValueError('missing circular dimension leader')
                    leader = leaders[0]
                    raw = ''.join(text.itertext()).strip()
                    if not raw.startswith('R' if radius_binding else ('Ø', '⌀')):
                        raise ValueError('missing circular dimension symbol')
                    visible = float(raw[1:])
                    nominal = float(intents.get(dim_id, {}).get('value_mm', text.get('data-value-mm')))
                    cx, cy, radius, scale, x, y = (float(leader.get(k)) for k in
                        ('data-center-x', 'data-center-y', 'data-radius-page-mm', 'data-scale', 'x1', 'y1'))
                    if not all(math.isfinite(n) for n in (visible, nominal, cx, cy, radius, scale, x, y)) or scale <= 0:
                        raise ValueError('invalid circular dimension evidence')
                    factor = 1 if radius_binding else 2
                    visible_tolerance = 1e-6 if radius_binding else .050001
                    if (abs(math.hypot(x-cx, y-cy)-radius) > .015
                            or abs(factor*radius/scale-nominal) > 1e-6 or abs(visible-nominal) > visible_tolerance):
                        raise ValueError('circular dimension target/value mismatch')
                    if radius_binding:
                        arc = [float(leader.get(k)) for k in ('data-arc-x', 'data-arc-y')]
                        if not all(math.isfinite(n) for n in arc) or math.dist((x, y), arc) > .015:
                            raise ValueError('fillet arc target changed')
                except (TypeError, ValueError):
                    issues.append({'dim_id': dim_id, 'reason': f'{measurement}_reference_geometry_mismatch'})
                continue
            if not text.get("data-linear-binding"):
                continue
            lines = [e for e in children if local_tag(e) == "line"
                     and e.get("data-dimension-line") == "linear"
                     and e.get("data-dim-id") == dim_id]
            issue = {"dim_id": dim_id}
            if len(lines) != 1:
                issues.append({**issue, "reason": "linear_svg_anchor_missing"})
                continue
            line = lines[0]
            try:
                scale = float(line.get("data-scale"))
                visible = float("".join(text.itertext()).strip())
                nominal = float(intents.get(dim_id, {}).get("value_mm", text.get("data-value-mm")))
                x1, y1, x2, y2 = (float(line.get(k)) for k in ("x1", "y1", "x2", "y2"))
                if scale <= 0 or not all(math.isfinite(n) for n in (scale, visible, nominal, x1, y1, x2, y2)):
                    raise ValueError("non-finite dimension")
                axis = line.get("data-axis")
                if axis not in {"u", "v"} or (axis == "u" and abs(y2-y1) > .01) or (axis == "v" and abs(x2-x1) > .01):
                    raise ValueError("dimension axis")
                measured = math.hypot(x2-x1, y2-y1) / scale
            except (TypeError, ValueError):
                issues.append({**issue, "reason": "linear_svg_evidence_invalid"})
                continue
            issue.update(visible_mm=visible, requested_mm=nominal, measured_mm=measured)
            if line.get("data-reference-y1") is not None or line.get("data-reference-y2") is not None:
                try:
                    references = sorted(float(line.get(k)) for k in ("data-reference-y1", "data-reference-y2"))
                    if not all(math.isfinite(n) for n in references):
                        raise ValueError("non-finite reference")
                    if any(abs(a - b) > .011 for a, b in zip(sorted([y1, y2]), references)):
                        issues.append({**issue, "reason": "linear_reference_geometry_mismatch"})
                        continue
                except (TypeError, ValueError):
                    issues.append({**issue, "reason": "linear_svg_evidence_invalid"})
                    continue
            if line.get('data-reference-kind') == 'pcb_linear_reference' and axis == 'u':
                extensions = [e for e in children if local_tag(e) == 'line'
                              and e.get('data-dimension-extension') == 'linear' and e.get('data-dim-id') == dim_id]
                try:
                    if len(extensions) != 2 or {e.get('data-endpoint-index') for e in extensions} != {'0', '1'}:
                        raise ValueError('missing horizontal reference')
                    ref_y = float(line.get('data-reference-y'))
                    for extension in extensions:
                        index = int(extension.get('data-endpoint-index'))
                        ref_x = float(line.get('data-reference-x1' if index == 0 else 'data-reference-x2'))
                        ex1, ey1, ex2, ey2 = (float(extension.get(k)) for k in ('x1', 'y1', 'x2', 'y2'))
                        gap = float(extension.get('data-gap-y'))
                        dx, dy = (float(extension.get(k)) for k in ('data-reference-x', 'data-reference-y'))
                        expected_gap = float((plan or {}).get('style', {}).get('dim_gap', 2)) * (-1 if y1 < ref_y else 1)
                        if not all(math.isfinite(n) for n in (ref_x, ref_y, ex1, ey1, ex2, ey2, gap, dx, dy)):
                            raise ValueError('non-finite horizontal reference')
                        if (abs(gap-expected_gap) > 1e-6 or abs(dx-ref_x) > .011 or abs(dy-ref_y) > .011
                                or abs(ex1-ref_x) > .011 or abs(ex2-ref_x) > .011 or abs(ey1-gap-ref_y) > .011
                                or abs((x1 if index == 0 else x2)-ref_x) > .011
                                or not min(ey1, ey2)-.011 <= y1 <= max(ey1, ey2)+.011):
                            raise ValueError('horizontal physical endpoint changed')
                except (TypeError, ValueError):
                    issues.append({**issue, 'reason': 'linear_reference_geometry_mismatch'})
                    continue
            if line.get('data-reference-kind') in ('standoff_cylindrical_faces', 'pcb_linear_reference',
                                                   'bracket_vertical_reference') and axis == 'v':
                extensions = [e for e in children if local_tag(e) == 'line'
                              and e.get('data-dimension-extension') == 'linear'
                              and e.get('data-dim-id') == dim_id]
                try:
                    if len(extensions) != 2 or {e.get('data-endpoint-index') for e in extensions} != {'0', '1'}:
                        raise ValueError('missing physical endpoint')
                    ref_x = float(line.get('data-reference-x'))
                    for extension in extensions:
                        index = int(extension.get('data-endpoint-index'))
                        ref_y = float(line.get('data-reference-y2' if index == 0 else 'data-reference-y1'))
                        ex1, ey1, ex2, ey2 = (float(extension.get(k)) for k in ('x1', 'y1', 'x2', 'y2'))
                        declared_x = float(extension.get('data-reference-x'))
                        declared_y = float(extension.get('data-reference-y'))
                        gap = float(extension.get('data-gap-x'))
                        expected_gap = float((plan or {}).get('style', {}).get('dim_gap', 2))
                        if x1 > ref_x:
                            expected_gap = -expected_gap
                        values = [ref_x, ref_y, ex1, ey1, ex2, ey2, declared_x, declared_y, gap]
                        if not all(math.isfinite(value) for value in values):
                            raise ValueError('non-finite physical endpoint')
                        if (abs(gap-expected_gap) > 1e-6
                                or abs(declared_x-ref_x) > .011 or abs(declared_y-ref_y) > .011
                                or abs(ex1-gap-ref_x) > .011 or abs(ey1-ref_y) > .011
                                or abs(ey2-ref_y) > .011 or not min(ex1, ex2)-.011 <= x1 <= max(ex1, ex2)+.011):
                            raise ValueError('physical endpoint changed')
                except (TypeError, ValueError):
                    issues.append({**issue, 'reason': 'linear_reference_geometry_mismatch'})
                    continue
            # Compare each to the independent plan value, rather than accepting
            # a forged visible label merely because data-value-mm stayed intact.
            if abs(measured - nominal) > .011 / scale + 1e-6:
                issues.append({**issue, "reason": "linear_value_geometry_mismatch"})
            elif abs(visible - nominal) > .050001:
                issues.append({**issue, "reason": "linear_visible_value_mismatch"})
    return issues


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

    svg_values = _dimension_values(tree)
    invalid_ids = {i["dim_id"] for i in check_linear_bindings(tree, plan)}

    missing = []
    for di in required:
        val = di["value_mm"]
        if di.get("id") in invalid_ids:
            missing.append(di.get("id", "?"))
            continue
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

    svg_values = _dimension_values(tree)

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


# -- Phase 20-B: Virtual Geometry + Note Semantic Metrics ----------------------

def check_virtual_pcd_present(tree, plan):
    """Check if virtual-pcd group exists when PCD is required.

    Returns: True if present (or not applicable), False if missing.
    None if no plan or no PCD intent.
    """
    if not plan:
        return None
    dim_intents = plan.get("dim_intents", [])
    pcd_intent = next((d for d in dim_intents
                       if d.get("id") == "PCD" and d.get("required")), None)
    if not pcd_intent:
        return None  # PCD not required → not applicable

    for elem in tree.iter():
        if local_tag(elem) == "g" and elem.get("class") == "virtual-pcd":
            return True
    if pcd_intent.get("value_mm") is not None and _has_matching_pcd_callout(tree, pcd_intent["value_mm"]):
        return True
    return False


def check_note_semantic_consistency(tree, plan):
    """Check bolt count note matches plan values.

    Looks for "{N}x" or "{N}×" patterns in general-notes and verifies
    against BOLT_COUNT and BOLT_DIA from plan.
    Returns: 0 (consistent), 1+ (mismatches). None if not applicable.
    """
    if not plan:
        return None
    dim_intents = plan.get("dim_intents", [])
    count_intent = next((d for d in dim_intents if d.get("id") == "BOLT_COUNT"), None)
    bolt_intent = next((d for d in dim_intents if d.get("id") == "BOLT_DIA"), None)

    if not count_intent or count_intent.get("value_mm") is None:
        return None
    if not bolt_intent or bolt_intent.get("value_mm") is None:
        return None

    expected_count = int(count_intent["value_mm"])
    expected_dia = bolt_intent["value_mm"]

    # Find general-notes text
    notes_texts = []
    for elem in tree.iter():
        if local_tag(elem) == "g" and elem.get("class") == "general-notes":
            for child in elem:
                if local_tag(child) == "text" and child.text:
                    notes_texts.append(child.text.strip())

    if not notes_texts:
        return 1  # no notes at all → mismatch

    # Look for bolt count pattern: "6x" or "6×"
    joined = " ".join(notes_texts)
    pattern = _re.search(r'(\d+)\s*[x\u00d7]\s*[\u00d8\u2300]?\s*([\d.]+)', joined)
    if not pattern:
        return 1  # no bolt count note found

    found_count = int(pattern.group(1))
    found_dia = float(pattern.group(2))

    mismatches = 0
    if found_count != expected_count:
        mismatches += 1
    if abs(found_dia - expected_dia) > max(0.5, 0.01 * expected_dia):
        mismatches += 1

    return mismatches


# -- DFM metrics (Phase 23) ----------------------------------------------------

def collect_dfm_metrics(config, slot_relief_dfm=None):
    """Run DFM checker on config and return metrics dict for QA integration.

    Returns None values if no manufacturing section is present (not applicable).
    """
    if not config or not config.get("manufacturing"):
        return {"dfm_error_count": None, "dfm_warning_count": None}

    try:
        from dfm_checker import run_dfm_check
        from _slot_relief import declared_slots
        if slot_relief_dfm and declared_slots(config):
            result = slot_relief_dfm
            relief = result["slot_corner_relief"]
        else:
            result = run_dfm_check(config)
            relief = next((issue for issue in result["issues"]
                           if (issue.get("evidence") or {}).get("measurement") == "slot_side_relief"), None)
        metrics = {
            "dfm_error_count": result["summary"]["errors"],
            "dfm_warning_count": result["summary"]["warnings"],
            "dfm_score": result["score"],
        }
        if relief:
            metrics["slot_corner_relief"] = relief
        return metrics
    except Exception:
        return {"dfm_error_count": None, "dfm_warning_count": None}


# -- Score computation ---------------------------------------------------------

def collect_metrics(tree, plan=None, stroke_profile="ks"):
    """Run all checks and return metrics dict.

    Plan-dependent metrics return None when no plan is provided,
    signaling "not applicable" rather than "zero issues found".
    """
    overflows = detect_overflow(tree)
    text_overlaps = detect_text_overlaps(tree)
    linear_issues = check_linear_bindings(tree, plan)
    annotations = _verified_dimension_annotations(tree, plan)
    redundancy_details, datum_details = {}, {}
    redundancy = check_dim_redundancy(tree, plan, redundancy_details, annotations)
    datum_coherence = check_datum_coherence(tree, datum_details, annotations)
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
        "stroke_violations": count_stroke_violations(tree, profile_name=stroke_profile),
        "float_precision_count": count_float_precision(tree),
        # Phase 19 intent metrics (None = not applicable without plan)
        "dim_completeness": check_dim_completeness(tree, plan) if has_plan else None,
        "dim_redundancy": redundancy,
        "datum_coherence": datum_coherence,
        "view_coverage": check_view_coverage(tree, plan) if has_plan else None,
        "note_convention": check_note_convention(tree),
        # Phase 20-A presence enforcement metrics
        "required_presence_rate": _pres_rate if has_plan else None,
        "required_presence_miss": len(_pres_missing) if has_plan else None,
        "value_inconsistency": check_value_consistency(tree, plan) if has_plan else None,
        "linear_binding_mismatch": len(linear_issues),
        # Phase 20-B virtual geometry + note metrics
        "virtual_pcd_present": check_virtual_pcd_present(tree, plan),
        "note_semantic_mismatch": check_note_semantic_consistency(tree, plan),
        "_details": {
            "overflows": overflows,
            "text_overlaps": text_overlaps[:10],  # limit detail output
            "required_presence_missing_ids": _pres_missing if has_plan else [],
            "linear_binding_issues": linear_issues,
            "dim_redundancy": redundancy_details,
            "datum_coherence": datum_details,
        },
    }


def extract_issue_signals(metrics):
    """Normalize raw metrics into issue-level boolean QA signals.

    Returns a dict where:
      - True means "issue detected"
      - False means "no issue"
      - None means "not applicable / insufficient context"
    """
    required_presence_miss = metrics.get("required_presence_miss")
    note_semantic_mismatch = metrics.get("note_semantic_mismatch")
    virtual_pcd_present = metrics.get("virtual_pcd_present")
    view_coverage = metrics.get("view_coverage")

    return {
        "notes_overflow": bool(metrics.get("notes_overflow")),
        "datum_incoherent": bool(metrics.get("datum_coherence")),
        "view_coverage_missing": None if view_coverage is None else bool(view_coverage),
        "required_presence_missing": None if required_presence_miss is None else required_presence_miss > 0,
        "note_semantic_mismatch": None if note_semantic_mismatch is None else note_semantic_mismatch > 0,
        "virtual_pcd_missing": None if virtual_pcd_present is None else (not bool(virtual_pcd_present)),
        "linear_binding_mismatch": bool(metrics.get("linear_binding_mismatch")),
    }


def compute_score(metrics, weights=WEIGHTS):
    """Compute 100-point score with itemized deductions."""
    score = 100
    deductions = {}

    def deduct(key, amount):
        nonlocal score
        if amount > 0:
            deductions[key] = -amount
            score -= amount

    deduct("iso_hidden_count",
           metrics["iso_hidden_count"] * weights["iso_hidden_count"])
    deduct("overflow_count",
           metrics["overflow_count"] * weights["overflow_count"])
    deduct("text_overlap_pairs",
           metrics["text_overlap_pairs"] * weights["text_overlap_pairs"])
    deduct("dim_overlap_pairs",
           metrics["dim_overlap_pairs"] * weights["dim_overlap_pairs"])
    if metrics["notes_overflow"]:
        deduct("notes_overflow", weights["notes_overflow"])
    deduct("gdt_unanchored",
           metrics["gdt_unanchored"] * weights["gdt_unanchored"])
    if metrics["dense_iso"]:
        deduct("dense_iso", weights["dense_iso"])
    deduct("stroke_violations",
           metrics["stroke_violations"] * weights["stroke_violations"])
    deduct("float_precision",
           min(metrics["float_precision_count"] // 10, 5) * weights["float_precision"])
    # Phase 19 intent metrics (skip None = not applicable)
    if metrics.get("dim_completeness") is not None:
        deduct("dim_completeness",
               metrics["dim_completeness"] * weights["dim_completeness"])
    if metrics.get("dim_redundancy") is not None:
        deduct("dim_redundancy",
               metrics["dim_redundancy"] * weights["dim_redundancy"])
    if metrics.get("datum_coherence"):
        deduct("datum_coherence", weights["datum_coherence"])
    if metrics.get("view_coverage") is not None and metrics["view_coverage"]:
        deduct("view_coverage", weights["view_coverage"])
    if metrics.get("note_convention") is not None:
        deduct("note_convention",
               min(metrics["note_convention"], 3) * weights["note_convention"])
    # Phase 20-A presence enforcement
    if metrics.get("required_presence_miss") is not None:
        deduct("required_presence_miss",
               metrics["required_presence_miss"] * weights["required_presence_miss"])
    if metrics.get("value_inconsistency") is not None:
        deduct("value_inconsistency",
               metrics["value_inconsistency"] * weights["value_inconsistency"])
    # Phase 20-B
    if metrics.get("virtual_pcd_present") is not None and not metrics["virtual_pcd_present"]:
        deduct("virtual_pcd_missing", weights["virtual_pcd_missing"])
    if metrics.get("note_semantic_mismatch") is not None:
        deduct("note_semantic_mismatch",
               metrics["note_semantic_mismatch"] * weights["note_semantic_mismatch"])
    # Phase 23 DFM
    if metrics.get("dfm_error_count") is not None:
        deduct("dfm_error_count",
               metrics["dfm_error_count"] * weights.get("dfm_error_count", 10))
    if metrics.get("dfm_warning_count") is not None:
        deduct("dfm_warning_count",
               metrics["dfm_warning_count"] * weights.get("dfm_warning_count", 3))

    return max(score, 0), deductions


# -- CLI -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Drawing QA Scorer — measure SVG quality")
    parser.add_argument("input", help="Input SVG file")
    parser.add_argument("--json", dest="json_out", help="Save JSON report")
    parser.add_argument("--plan", dest="plan_file", help="Drawing plan file (TOML or JSON) for intent metrics")
    parser.add_argument("--weights-preset", dest="weights_preset",
                        help="QA weights preset: default|auto|flange|shaft|bracket|housing|assembly")
    parser.add_argument("--config", dest="config_file",
                        help="Config file (TOML/JSON) for DFM metrics integration")
    parser.add_argument("--slot-relief-dfm", type=json.loads, help=argparse.SUPPRESS)
    parser.add_argument("--fail-under", type=int, default=0,
                        help="Exit with error if score < threshold")
    args = parser.parse_args()

    tree = load_svg(args.input)

    # Load plan if provided (TOML or JSON, for intent-aware metrics)
    plan = None
    if args.plan_file and os.path.exists(args.plan_file):
        try:
            if args.plan_file.endswith(".toml"):
                plan_data = _load_toml_file(args.plan_file)
            else:
                with open(args.plan_file) as pf:
                    plan_data = json.load(pf)
            plan = plan_data.get("drawing_plan", plan_data)
        except Exception:
            pass  # plan is optional

    config_data = None
    if args.config_file and os.path.exists(args.config_file):
        try:
            if args.config_file.endswith(".toml"):
                config_data = _load_toml_file(args.config_file)
            else:
                with open(args.config_file) as cf:
                    config_data = json.load(cf)
        except Exception:
            config_data = None

    stroke_profile = resolve_stroke_profile(plan, config_data)
    metrics = collect_metrics(tree, plan, stroke_profile=stroke_profile)

    # DFM metrics integration (Phase 23)
    if config_data is not None:
        try:
            dfm_m = collect_dfm_metrics(config_data, args.slot_relief_dfm)
            relief = dfm_m.pop("slot_corner_relief", None)
            if relief:
                metrics.setdefault("_details", {})["slot_corner_relief"] = relief
            metrics.update(dfm_m)
        except Exception:
            pass

    active_weights, weight_profile = resolve_weights(plan, args.weights_preset)
    score, deductions = compute_score(metrics, active_weights)

    # Print summary
    filename = os.path.basename(args.input)
    print(f"QA Score: {score}/100  [{filename}]")
    if weight_profile != "default":
        print(f"  weight_profile: {weight_profile}")
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
            "weight_profile": weight_profile,
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
