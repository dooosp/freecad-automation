"""SVG Repair Passes — fix QA deductions in post-processed drawings.

Three repair functions targeting the main QA score deductions:
  1. rebuild_notes   — word-wrap general notes within bounds
  2. repair_text_overlaps — iteratively nudge overlapping texts apart
  3. repair_overflow — scale geometry groups that exceed cell boundaries

Each function takes an ElementTree, mutates it in-place, and returns a
result dict with "summary" (counts) and "changes" (per-element log).
"""
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
_NOTES_Y_START = 236.0
_NOTES_Y_MAX = 268.0
_NOTES_LINE_H = 4.0
_NOTES_FONT_SIZE = 2.0
_NOTES_CHAR_W = 0.55
_NOTES_MAX_WIDTH = 180.0


def rebuild_notes(tree):
    """Rebuild general-notes <text> elements with word-wrap and y-clamp.

    Returns {
        "summary": {"lines_total", "lines_rendered", "truncated", "texts_wrapped"},
        "changes": [...],
        "risks": [...]
    }.
    """
    root = tree.getroot()
    notes_group = None
    for elem in root.iter():
        if local_tag(elem) == "g" and elem.get("class") == "general-notes":
            notes_group = elem
            break

    empty = {
        "summary": {"lines_total": 0, "lines_rendered": 0,
                     "truncated": False, "texts_wrapped": 0},
        "changes": [],
        "risks": [],
    }
    if notes_group is None:
        return empty

    texts = [c for c in notes_group if local_tag(c) == "text"]
    if not texts:
        return empty

    max_chars = int(_NOTES_MAX_WIDTH / (_NOTES_FONT_SIZE * _NOTES_CHAR_W))
    texts_wrapped = 0

    # Collect all content preserving header/body distinction
    raw_lines = []
    for t in texts:
        content = t.text or ""
        is_header = t.get("font-weight") == "bold"
        attrs = {k: v for k, v in t.attrib.items()
                 if k not in ("x", "y", "text")}

        if is_header or len(content) <= max_chars:
            raw_lines.append({"text": content, "attrs": attrs})
        else:
            texts_wrapped += 1
            words = content.split(" ")
            current = ""
            first = True
            for w in words:
                if current and len(current) + 1 + len(w) > max_chars:
                    raw_lines.append({
                        "text": current,
                        "attrs": attrs if first else {},
                    })
                    current = "   " + w
                    first = False
                else:
                    current = (current + " " + w).strip() if current else w
            if current:
                raw_lines.append({
                    "text": current,
                    "attrs": attrs if first else {},
                })

    # Remove existing text children
    for t in texts:
        notes_group.remove(t)

    # Re-create within y bounds
    lines_total = len(raw_lines)
    lines_rendered = 0
    truncated = False

    for i, line_info in enumerate(raw_lines):
        y = _NOTES_Y_START + i * _NOTES_LINE_H
        if y > _NOTES_Y_MAX:
            truncated = True
            break
        new_t = ET.SubElement(notes_group, svg_tag("text"))
        new_t.set("x", str(_NOTES_X))
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
                + (", truncated overflow" if truncated else ""),
    }]

    risks = []
    if truncated:
        risks.append({
            "code": "notes_reflowed",
            "severity": "warning",
            "view": "page",
            "reason": f"Notes truncated: {lines_total - lines_rendered} lines "
                      f"exceeded y_max={_NOTES_Y_MAX}mm",
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
            "truncated": truncated,
            "texts_wrapped": texts_wrapped,
        },
        "changes": changes,
        "risks": risks,
    }


# ---------------------------------------------------------------------------
# 2. repair_text_overlaps — iterative de-overlap
# ---------------------------------------------------------------------------

def _text_priority(elem, parent_class):
    """Assign priority: 0=fixed, 1=prefer-fixed, 2=movable."""
    y_val = float(elem.get("y", "0"))
    if y_val > TITLEBLOCK_Y:
        return 0
    ff = elem.get("font-family", "")
    if "monospace" in ff.lower():
        return 0

    if parent_class:
        for prefix in ANNOTATION_PREFIXES:
            if parent_class.startswith(prefix):
                return 1

    return 2


def _collect_texts_with_info(tree):
    """Collect all <text> elements with bbox, priority, view_id."""
    results = []
    root = tree.getroot()

    def _walk(parent, parent_class):
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
                pri = _text_priority(child, parent_class)
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
                cls = child.get("class", "") or parent_class
                _walk(child, cls)

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
