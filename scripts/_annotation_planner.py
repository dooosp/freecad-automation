"""Annotation placement planner with simple AABB overlap minimization."""

import math
import xml.etree.ElementTree as ET

from svg_common import iter_svg_elements


class AnnotationPlanner:
    """AABB-based collision avoidance for annotation placement.

    Collects bounding boxes of placed annotations (dimensions, datums, labels)
    and helps find positions that minimise overlap.
    """

    def __init__(self):
        self._boxes = []  # [(x_min, y_min, x_max, y_max), ...]
        self._label_boxes = []

    def register(self, x_min, y_min, x_max, y_max, *, label=True):
        """Register an already-placed annotation bounding box."""
        self._boxes.append((min(x_min, x_max), min(y_min, y_max),
                            max(x_min, x_max), max(y_min, y_max)))
        if label:
            self._label_boxes.append(self._boxes[-1])

    def register_svg(self, fragment, padding=0.5):
        """Reserve actual page-space elements; unsupported bounds remain unknown."""
        root = ET.fromstring(f'<svg>{fragment}</svg>')
        unavailable = 0
        for _elem, _classes, box in iter_svg_elements(root):
            if box is None or not all(math.isfinite(v) for v in (box.x, box.y, box.w, box.h)):
                unavailable += 1
                continue
            self.register(box.x - padding, box.y - padding,
                          box.x + box.w + padding, box.y + box.h + padding,
                          label=_elem.tag.rsplit('}', 1)[-1] == 'text')
        return {"unavailable": unavailable}

    def segment_overlap_score(self, x1, y1, x2, y2):
        """Length of a leader inside existing label rectangles (slab clipping)."""
        total = 0.0
        for bx0, by0, bx1, by1 in self._label_boxes:
            enter, leave = 0.0, 1.0
            for start, delta, lower, upper in ((x1, x2-x1, bx0, bx1), (y1, y2-y1, by0, by1)):
                if abs(delta) < 1e-12:
                    if not lower <= start <= upper:
                        leave = -1
                        break
                else:
                    a, b = (lower-start)/delta, (upper-start)/delta
                    enter, leave = max(enter, min(a, b)), min(leave, max(a, b))
            total += max(0, leave-enter) * math.hypot(x2-x1, y2-y1)
        return total

    def overlap_score(self, x_min, y_min, x_max, y_max):
        """Return total overlap area with all registered boxes."""
        bx0, by0 = min(x_min, x_max), min(y_min, y_max)
        bx1, by1 = max(x_min, x_max), max(y_min, y_max)
        total = 0.0
        for ax0, ay0, ax1, ay1 in self._boxes:
            dx = max(0, min(bx1, ax1) - max(bx0, ax0))
            dy = max(0, min(by1, ay1) - max(by0, ay0))
            total += dx * dy
        return total

    def find_best_position(self, candidates, box_w, box_h):
        """Pick candidate (x, y) with least overlap.

        candidates: [(x, y), ...]  — top-left corner of the annotation box
        Returns: (best_x, best_y)
        """
        best, best_score = candidates[0], float('inf')
        for cx, cy in candidates:
            score = self.overlap_score(cx, cy, cx + box_w, cy + box_h)
            if score < best_score:
                best_score = score
                best = (cx, cy)
                if score == 0:
                    break
        return best

    def register_and_pick(self, candidates, box_w, box_h):
        """find_best_position + register the winner. Returns (x, y)."""
        x, y = self.find_best_position(candidates, box_w, box_h)
        self.register(x, y, x + box_w, y + box_h)
        return x, y
