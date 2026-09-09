"""SVG Repair Passes — fix QA deductions in post-processed drawings.

Three repair functions targeting the main QA score deductions:
  1. rebuild_notes   — word-wrap general notes within bounds
  2. repair_text_overlaps — iteratively nudge overlapping texts apart
  3. repair_overflow — scale geometry groups that exceed cell boundaries

Each function takes an ElementTree, mutates it in-place, and returns a
result dict with "summary" (counts) and "changes" (per-element log).
"""
import math
import textwrap
import xml.etree.ElementTree as ET

from svg_common import (
    local_tag, svg_tag, elem_bbox_approx,
    cell_bbox, classify_by_position,
    CELLS, GEOMETRY_CLASSES, ANNOTATION_PREFIXES, TITLEBLOCK_Y, BBox,
)


# ---------------------------------------------------------------------------
# 1. rebuild_notes — replace rewrap_notes with overflow-safe version
# ---------------------------------------------------------------------------

_NOTES_X = 19.0
_NOTES_Y_START = 252.0
_NOTES_Y_MAX = 272.0
_NOTES_LINE_H = 4.0
_NOTES_FONT_SIZE = 2.0
_NOTES_CHAR_W = 0.55
_NOTES_MAX_WIDTH = 212.0


def _notes_region(group):
    """Return declared text-baseline bounds, or the legacy A3 footer bounds."""
    defaults = {"x": _NOTES_X, "y-min": _NOTES_Y_START,
                "y-max": _NOTES_Y_MAX, "width": _NOTES_MAX_WIDTH}
    declared = [key for key in defaults if group.get(f"data-layout-{key}") is not None]
    if not declared:
        return defaults, "legacy_a3_footer"
    if len(declared) != len(defaults):
        return None, "incomplete_declared_region"
    try:
        region = {key: float(group.get(f"data-layout-{key}")) for key in defaults}
    except (TypeError, ValueError):
        return None, "invalid_declared_region"
    if (not all(math.isfinite(value) for value in region.values())
            or region["x"] < 0 or region["width"] <= 0
            or region["x"] + region["width"] > 420
            or not 0 <= region["y-min"] <= region["y-max"] <= 297):
        return None, "invalid_declared_region"
    return region, "declared"


def rebuild_notes(tree):
    """Reflow notes inside their reserved region without discarding overflow.

    Returns {
        "summary": {"lines_total", "lines_rendered", "truncated", "texts_wrapped"},
        "changes": [...],
        "risks": [...]
    }.
    """
    root = tree.getroot()
    notes_group = None
    for elem in root.iter():
        if local_tag(elem) == "g" and "general-notes" in elem.get("class", "").split():
            notes_group = elem
            break

    empty = {
        "summary": {"lines_total": 0, "lines_rendered": 0,
                     "truncated": False, "texts_wrapped": 0,
                     "overflow": False, "layout_status": "not_evaluated"},
        "changes": [],
        "risks": [],
    }
    if notes_group is None:
        return empty

    texts = [c for c in notes_group if local_tag(c) == "text"]
    if not texts:
        return empty

    region, layout_source = _notes_region(notes_group)
    if region is None:
        return {
            "summary": {"lines_total": len(texts), "lines_rendered": len(texts),
                        "truncated": False, "texts_wrapped": 0,
                        "overflow": None, "layout_status": "unavailable",
                        "layout_source": layout_source},
            "changes": [],
            "risks": [{"code": "notes_layout_unavailable", "severity": "warning",
                       "view": "page", "reason": "Invalid or incomplete declared notes region; original content and placement retained."}],
        }
    texts_wrapped = 0
    columns = 2 if notes_group.get("data-layout-columns") == "2" and region["width"] > 8 else 1
    column_width = (region["width"] - (8 if columns == 2 else 0)) / columns
    body_rows = max(1, int((region["y-max"] - region["y-min"]) / _NOTES_LINE_H))

    # Collect all content preserving header/body distinction
    raw_lines = []
    for t in texts:
        content = "".join(t.itertext())
        attrs = {k: v for k, v in t.attrib.items()
                 if k not in ("x", "y", "text")}
        try:
            font_size = float(t.get("font-size", notes_group.get("font-size", _NOTES_FONT_SIZE)))
        except (TypeError, ValueError):
            font_size = _NOTES_FONT_SIZE
        if not math.isfinite(font_size) or font_size <= 0:
            font_size = _NOTES_FONT_SIZE
        max_chars = max(1, int(column_width / (font_size * _NOTES_CHAR_W)))
        wrapped = textwrap.wrap(content, width=max_chars, expand_tabs=False,
                                replace_whitespace=False, break_long_words=True,
                                break_on_hyphens=False) or [""]
        if len(wrapped) > 1:
            texts_wrapped += 1
        for index, line in enumerate(wrapped):
            line_attrs = dict(attrs)
            if index:
                # A multiline note keeps its styling without duplicating an SVG ID.
                line_attrs.pop("id", None)
            raw_lines.append({"text": line, "attrs": line_attrs,
                              "width_mm": len(line) * font_size * _NOTES_CHAR_W})

    # Remove existing text children
    for t in texts:
        notes_group.remove(t)

    # Re-create every line. A region that cannot hold the content is unavailable,
    # not a reason to hide notes or reduce their text size.
    lines_total = len(raw_lines)
    lines_rendered = 0
    overflow_lines = 0

    body_slot = 0
    for i, line_info in enumerate(raw_lines):
        column, row = 0, i
        if columns == 2 and i:
            # Keep a logical note together when it fits one column.
            note_index = line_info["attrs"].get("data-note-index")
            if note_index and note_index != raw_lines[i-1]["attrs"].get("data-note-index"):
                length = 1
                while i + length < len(raw_lines) and raw_lines[i+length]["attrs"].get("data-note-index") == note_index:
                    length += 1
                if length <= body_rows and body_slot < body_rows < body_slot + length:
                    body_slot = body_rows
            column = min(body_slot // body_rows, columns - 1)
            row = body_slot - column * body_rows + 1
            body_slot += 1
        y = region["y-min"] + row * _NOTES_LINE_H
        if y > region["y-max"] or line_info["width_mm"] > column_width:
            overflow_lines += 1
        new_t = ET.SubElement(notes_group, svg_tag("text"))
        new_t.set("x", str(region["x"] + column * (column_width + 8)))
        new_t.set("y", f"{y:.1f}")
        for k, v in line_info["attrs"].items():
            new_t.set(k, v)
        new_t.text = line_info["text"]
        lines_rendered += 1

    changes = [{
        "pass": "rebuild_notes",
        "type": "reflow",
        "view": "page",
        "selector": "g.general-notes > text",
        "count": lines_rendered,
        "note": f"Rebuilt {lines_rendered}/{lines_total} lines, "
                f"wrapped {texts_wrapped} long texts"
                + (f", retained {overflow_lines} overflowing lines" if overflow_lines else ""),
    }]

    risks = []
    if overflow_lines:
        risks.append({
            "code": "notes_layout_overflow",
            "severity": "warning",
            "view": "page",
            "reason": f"All notes retained; {overflow_lines} lines exceed the "
                      f"reserved width={region['width']}mm or y_max={region['y-max']}mm. Layout is unavailable.",
        })
    else:
        risks.append({
            "code": "notes_reflowed",
            "severity": "info",
            "view": "page",
            "reason": f"Notes reflowed: {lines_rendered} lines, "
                      f"{texts_wrapped} wrapped",
        })

    return {
        "summary": {
            "lines_total": lines_total,
            "lines_rendered": lines_rendered,
            "truncated": False,
            "texts_wrapped": texts_wrapped,
            "overflow": bool(overflow_lines),
            "overflow_lines": overflow_lines,
            "layout_status": "unavailable" if overflow_lines else "available",
            "layout_source": layout_source,
        },
        "changes": changes,
        "risks": risks,
    }


# ---------------------------------------------------------------------------
# 2. repair_text_overlaps — iterative de-overlap
# ---------------------------------------------------------------------------

def _text_priority(elem, parent_class, bound_annotation=False):
    """Assign priority: 0=bound/fixed, 2=unbound/movable."""
    classes = f"{parent_class or ''} {elem.get('class', '')}".split()
    if (bound_annotation or elem.get("data-dim-id") is not None
            or "general-notes" in classes
            or any(cls.startswith(prefix) for cls in classes for prefix in ANNOTATION_PREFIXES)):
        # Reposition the whole annotation in its renderer; moving this text alone
        # would detach it from a leader, datum frame or deliberate notes region.
        return 0
    y_val = float(elem.get("y", "0"))
    if y_val > TITLEBLOCK_Y:
        return 0
    ff = elem.get("font-family", "")
    if "monospace" in ff.lower():
        return 0

    return 2


def _collect_texts_with_info(tree):
    """Collect all <text> elements with bbox, priority, view_id."""
    results = []
    root = tree.getroot()

    def _walk(parent, parent_class, bound_annotation=False):
        for child in parent:
            tag = local_tag(child)
            if tag == "text":
                bb = elem_bbox_approx(child)
                if bb is None or bb.area() < 0.1:
                    continue
                content = child.text or ""
                if not content.strip():
                    continue
                cx, cy = bb.center()
                view = classify_by_position(cx, cy)
                if view is None:
                    continue
                pri = _text_priority(child, parent_class, bound_annotation)
                results.append({
                    "elem": child,
                    "bbox": bb,
                    "priority": pri,
                    "view": view,
                    "shift_y": 0.0,
                    "shift_x": 0.0,
                    "orig_x": float(child.get("x", "0")),
                    "orig_y": float(child.get("y", "0")),
                })
            elif tag == "g":
                cls = " ".join([parent_class, child.get("class", "")]).strip()
                _walk(child, cls, bound_annotation or child.get("data-dim-id") is not None)

    _walk(root, "")
    return results


_MAX_CHANGE_LOG = 30  # cap per-element change entries


def repair_text_overlaps(tree, max_iter=40, step_mm=2.5,
                         max_shift_mm=18.0, iou_thresh=0.10):
    """Iteratively nudge overlapping text elements apart.

    Returns {
        "summary": {"pairs_resolved", "texts_moved", "iterations"},
        "changes": [...],
        "risks": [...]
    }.
    """
    infos = _collect_texts_with_info(tree)

    by_view = {}
    for info in infos:
        by_view.setdefault(info["view"], []).append(info)

    total_resolved = 0
    moved_set = set()
    total_iters = 0
    changes = []

    for view_name, view_texts in by_view.items():
        vcell = cell_bbox(view_name)

        for iteration in range(max_iter):
            total_iters += 1
            resolved_this = 0

            for i in range(len(view_texts)):
                for j in range(i + 1, len(view_texts)):
                    a = view_texts[i]
                    b = view_texts[j]
                    iou_val = a["bbox"].iou(b["bbox"])
                    if iou_val <= iou_thresh:
                        continue

                    if a["priority"] <= b["priority"]:
                        mover = b
                    else:
                        mover = a

                    if mover["priority"] == 0:
                        continue

                    old_x = float(mover["elem"].get("x", "0"))
                    old_y = float(mover["elem"].get("y", "0"))

                    if abs(mover["shift_y"]) >= max_shift_mm:
                        if abs(mover["shift_x"]) >= max_shift_mm:
                            continue
                        new_x = old_x + step_mm
                        new_x = min(new_x, vcell.x + vcell.w - 2.0)
                        mover["elem"].set("x", f"{new_x:.2f}")
                        mover["shift_x"] += step_mm
                    else:
                        new_y = old_y + step_mm
                        new_y = min(new_y, vcell.y + vcell.h - 2.0)
                        mover["elem"].set("y", f"{new_y:.2f}")
                        mover["shift_y"] += step_mm

                    mover["bbox"] = elem_bbox_approx(mover["elem"])
                    first_move = id(mover["elem"]) not in moved_set
                    moved_set.add(id(mover["elem"]))
                    resolved_this += 1
                    total_resolved += 1

                    # Log first move per element (cap total entries)
                    if first_move and len(changes) < _MAX_CHANGE_LOG:
                        snippet = (mover["elem"].text or "")[:30]
                        changes.append({
                            "pass": "deoverlap_text",
                            "type": "move",
                            "view": view_name,
                            "target": {
                                "kind": "text",
                                "text_snippet": snippet,
                            },
                            "from": {
                                "x": round(mover["orig_x"], 2),
                                "y": round(mover["orig_y"], 2),
                            },
                            "to": {
                                "x": round(float(mover["elem"].get("x", "0")), 2),
                                "y": round(float(mover["elem"].get("y", "0")), 2),
                            },
                            "delta_mm": {
                                "dx": round(mover["shift_x"], 2),
                                "dy": round(mover["shift_y"], 2),
                            },
                            "reason": "text_overlap",
                        })

            if resolved_this == 0:
                break

    # Update final positions in change log
    for ch in changes:
        # Find matching info by snippet and orig position
        for info in infos:
            if id(info["elem"]) in moved_set:
                snippet = (info["elem"].text or "")[:30]
                if (snippet == ch["target"]["text_snippet"]
                        and ch["from"]["x"] == round(info["orig_x"], 2)
                        and ch["from"]["y"] == round(info["orig_y"], 2)):
                    ch["to"]["x"] = round(float(info["elem"].get("x", "0")), 2)
                    ch["to"]["y"] = round(float(info["elem"].get("y", "0")), 2)
                    ch["delta_mm"]["dx"] = round(info["shift_x"], 2)
                    ch["delta_mm"]["dy"] = round(info["shift_y"], 2)
                    break

    risks = []
    fixed_pairs = sum(
        1 for view_texts in by_view.values()
        for index, first in enumerate(view_texts)
        for second in view_texts[index + 1:]
        if first["priority"] == second["priority"] == 0
        and first["bbox"].iou(second["bbox"]) > iou_thresh
    )
    if fixed_pairs:
        risks.append({
            "code": "annotation_overlap_requires_layout", "severity": "warning",
            "view": "page",
            "reason": f"{fixed_pairs} overlapping bound annotation pairs retained; their renderer must reposition the complete annotations.",
        })
    # Flag texts moved significantly
    big_movers = [info for info in infos
                  if abs(info["shift_y"]) + abs(info["shift_x"]) > 12.0]
    if big_movers:
        risks.append({
            "code": "dimension_association_uncertain",
            "severity": "warning",
            "view": ", ".join(set(m["view"] for m in big_movers)),
            "reason": f"{len(big_movers)} text(s) moved >12mm; "
                      f"dimension-to-geometry association may be unclear",
        })

    return {
        "summary": {
            "pairs_resolved": total_resolved,
            "texts_moved": len(moved_set),
            "iterations": total_iters,
            "unresolved_fixed_pairs": fixed_pairs,
        },
        "changes": changes,
        "risks": risks,
    }


# ---------------------------------------------------------------------------
# 3. repair_overflow — scale geometry to fit within cell
# ---------------------------------------------------------------------------

def repair_overflow(tree, min_scale=0.80, safety_pad=3.0):
    """Scale geometry groups that overflow their view cell.

    Returns {
        "summary": {"views_scaled": {...}},
        "changes": [...],
        "risks": [...]
    }.
    """
    root = tree.getroot()
    views_scaled = {}
    changes = []
    risks = []

    geo_by_view = {}
    for elem in list(root):
        cls = elem.get("class", "")
        if cls not in GEOMETRY_CLASSES:
            continue
        center = _group_center_fast(elem)
        if not center:
            continue
        view = classify_by_position(*center)
        if not view:
            continue
        bb = elem_bbox_approx(elem)
        if bb is None:
            continue
        geo_by_view.setdefault(view, []).append((elem, bb))

    for view_name, geo_list in geo_by_view.items():
        vcell = cell_bbox(view_name)
        padded = BBox(
            vcell.x + safety_pad, vcell.y + safety_pad,
            vcell.w - 2 * safety_pad, vcell.h - 2 * safety_pad,
        )

        all_bbs = [bb for _, bb in geo_list]
        union = BBox.union_all(all_bbs)
        if union is None:
            continue

        overflow_x = max(0, union.w - padded.w)
        overflow_y = max(0, union.h - padded.h)
        if overflow_x <= 0 and overflow_y <= 0:
            if (union.x >= padded.x and
                union.y >= padded.y and
                union.x + union.w <= padded.x + padded.w and
                union.y + union.h <= padded.y + padded.h):
                continue

        kx = padded.w / union.w if union.w > padded.w else 1.0
        ky = padded.h / union.h if union.h > padded.h else 1.0
        k = min(kx, ky)
        k = max(k, min_scale)

        if k >= 0.999:
            continue

        cx, cy = padded.center()
        wrapper = ET.SubElement(root, svg_tag("g"))
        wrapper.set("class", f"viewcell-{view_name}")
        wrapper.set("transform",
                     f"translate({cx:.2f},{cy:.2f}) "
                     f"scale({k:.4f}) "
                     f"translate({-cx:.2f},{-cy:.2f})")

        for elem, _ in geo_list:
            root.remove(elem)
            wrapper.append(elem)

        k_rounded = round(k, 4)
        views_scaled[view_name] = k_rounded

        changes.append({
            "pass": "repair_overflow_scale",
            "type": "transform",
            "view": view_name,
            "target": {"kind": "group", "class": f"viewcell-{view_name}"},
            "transform": {
                "scale": k_rounded,
                "about": {"x": round(cx, 2), "y": round(cy, 2)},
            },
            "reason": "overflow",
        })
        risks.append({
            "code": "semantic_may_shift",
            "severity": "warning",
            "view": view_name,
            "reason": f"Applied scale {k_rounded} to geometry; "
                      f"dimensions/leaders may not match exact geometry scale.",
            "details": {
                "scale_factor": k_rounded,
                "target": "geometry_only",
            },
        })

    return {
        "summary": {"views_scaled": views_scaled},
        "changes": changes,
        "risks": risks,
    }


def _group_center_fast(g_elem):
    """Fast center: check first child only."""
    for child in g_elem:
        bb = elem_bbox_approx(child)
        if bb and bb.area() >= 0:
            return bb.center()
    return None
