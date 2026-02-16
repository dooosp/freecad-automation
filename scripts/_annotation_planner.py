"""Annotation placement planner with simple AABB overlap minimization."""


class AnnotationPlanner:
    """AABB-based collision avoidance for annotation placement.

    Collects bounding boxes of placed annotations (dimensions, datums, labels)
    and helps find positions that minimise overlap.
    """

    def __init__(self):
        self._boxes = []  # [(x_min, y_min, x_max, y_max), ...]

    def register(self, x_min, y_min, x_max, y_max):
        """Register an already-placed annotation bounding box."""
        self._boxes.append((min(x_min, x_max), min(y_min, y_max),
                            max(x_min, x_max), max(y_min, y_max)))

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
