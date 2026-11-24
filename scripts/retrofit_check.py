"""Measure retrofit placements and report the evidence through the FreeCAD runner."""

import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _bootstrap import init_freecad, read_input, respond, respond_error
from _retrofit_case import REQUIREMENTS, read_case


def note(issues, code, field=None):
    issue = {"code": code}
    if field is not None:
        issue["input"] = field
    if issue not in issues:
        issues.append(issue)


def need_fields(issues, item, prefix, keys, code):
    if item is None:
        note(issues, code, prefix)
        return False
    missing = [key for key in keys if item.get(key) is None]
    for key in missing:
        note(issues, code, f"{prefix}.{key}")
    return not missing


@dataclass
class Model:
    step: dict | None
    shape: object
    mount: object
    holes: dict

    def evidence(self):
        return {
            "step": self.step,
            "mount_plane": {"z_mm": self.mount.z, "normal": self.mount.normal} if self.mount else None,
            "holes": list(self.holes.values()),
        }


class RetrofitCheck:
    def __init__(self, case, directory, geometry, adapter_candidate_id=None):
        self.case = case
        self.directory = directory
        self.geo = geometry
        self.limits = case["requirements"]
        self.imports = {}
        self.adapter_candidate_id = adapter_candidate_id
        self.review_plate = None

    def load_model(self, item, prefix, side, issues):
        shape = None
        step = None
        filename = item["step_file"]
        if filename is None:
            note(issues, "STEP_FILE_REQUIRED", f"{prefix}.step_file")
        else:
            path = (self.directory / filename).resolve()
            if path not in self.imports:
                self.imports[path] = self.geo.read_solid(path)
            sha256, shape = self.imports[path]
            step = {"file": filename, "sha256": sha256}
            if shape is None:
                note(issues, "SINGLE_SOLID_STEP_REQUIRED", f"{prefix}.step_file")

        mount = None
        plane = item["mount_plane"]
        plane_prefix = f"{prefix}.mount_plane"
        if need_fields(issues, plane, plane_prefix, ("normal", "z_mm"), "MOUNT_PLANE_REQUIRED"):
            if not self.geo.parallel_z(plane["normal"]) or side * plane["normal"][2] <= 0:
                note(issues, "MOUNT_AXIS_UNSUPPORTED", f"{plane_prefix}.normal")
            elif shape is not None:
                mount = self.geo.find_mount_face(shape, plane["z_mm"], side)
                if mount is None:
                    note(issues, "MOUNT_PLANE_NOT_FOUND", plane_prefix)

        measured = self.measure_holes(item["holes"], prefix, shape, mount, issues)
        return Model(step, shape, mount, measured)

    def measure_holes(self, hints, prefix, shape, mount, issues):
        holes = {}
        if not hints:
            note(issues, "HOLE_HINTS_REQUIRED", f"{prefix}.holes")
            return holes
        cylinders = self.geo.cylinder_faces(shape) if mount else []
        for hint in hints:
            field = f"{prefix}.holes[{hint['id']}]"
            if not need_fields(issues, hint, field, ("center_mm", "axis"), "HOLE_HINT_REQUIRED"):
                continue
            if not self.geo.parallel_z(hint["axis"]):
                note(issues, "HOLE_AXIS_UNSUPPORTED", f"{field}.axis")
                continue
            if mount is None:
                continue
            matches = self.geo.find_holes(shape, cylinders, mount, hint)
            if len(matches) == 1:
                holes[hint["id"]] = matches[0]
            else:
                code = "HOLE_MATCH_AMBIGUOUS" if matches else "HOLE_NOT_VERIFIED"
                note(issues, code, field)
        return holes

    def obstacles(self, issues):
        boxes = self.case["obstacles"]
        if boxes is None:
            note(issues, "OBSTACLES_REQUIRED", "obstacles")
            return [], False
        checked = []
        for index, box in enumerate(boxes):
            if need_fields(issues, box, f"obstacles[{index}]", ("min_mm", "max_mm"), "OBSTACLE_BOUNDS_REQUIRED"):
                checked.append((box["id"], self.geo.box_shape(box)))
        return checked, len(checked) == len(boxes)

    def pairs(self, item, prefix, base, model, issues):
        pair_field = f"{prefix}.hole_pairs"
        declared = item["hole_pairs"]
        if not declared:
            note(issues, "HOLE_PAIRS_REQUIRED", pair_field)
            return []

        base_ids = [pair["base_hole"] for pair in declared]
        candidate_ids = [pair["candidate_hole"] for pair in declared]
        expected_base = {hole["id"] for hole in self.case["mount_plate"]["holes"] or []}
        expected_candidate = {hole["id"] for hole in item["holes"] or []}
        if (len(set(base_ids)) != len(base_ids) or len(set(candidate_ids)) != len(candidate_ids)
                or set(base_ids) != expected_base or set(candidate_ids) != expected_candidate):
            note(issues, "HOLE_PAIRING_AMBIGUOUS", pair_field)
            return []

        for holes in (base.holes, model.holes):
            centers = {tuple(hole["center_mm"][:2]) for hole in holes.values()}
            if len(centers) != len(holes):
                note(issues, "HOLE_PAIRING_AMBIGUOUS", pair_field)
                return []
        return [
            (base.holes[pair["base_hole"]], model.holes[pair["candidate_hole"]])
            for pair in declared
            if pair["base_hole"] in base.holes and pair["candidate_hole"] in model.holes
        ]

    def check_direct_holes(self, pairs, translation, failures):
        if translation is None:
            return []
        results = []
        for lower, upper in pairs:
            upper = self.geo.move_hole(upper, translation)
            offset = math.dist(lower["center_mm"][:2], upper["center_mm"][:2])
            if self.above_limit(offset, "max_hole_offset_mm"):
                note(failures, "HOLE_OFFSET_EXCEEDED")
            if self.below_limit(min(lower["diameter_mm"], upper["diameter_mm"]), "min_hole_diameter_mm"):
                note(failures, "HOLE_DIAMETER_BELOW_MINIMUM")
            results.append({"base": lower, "candidate": upper, "offset_mm": offset})
        return results

    def below_limit(self, value, key):
        limit = self.limits[key]
        return limit is not None and value + self.geo.LINEAR < limit

    def above_limit(self, value, key):
        limit = self.limits[key]
        return limit is not None and value - self.geo.LINEAR > limit

    def interface(self, lower, upper, name, failures):
        result = self.geo.mount_interface(lower, upper, name)
        if abs(result["plane_gap_mm"]) > self.geo.LINEAR:
            note(failures, "MOUNT_PLANE_MISMATCH")
        elif result["contact_area_mm2"] <= self.geo.TOLERANCES["contact_area_mm2"]:
            note(failures, "MOUNT_FACE_CONTACT_MISSING")
        return result

    def body_intersections(self, base, candidate, adapter, obstacles, failures):
        checks = [("candidate", "mount_plate", "solid", candidate, base)]
        if adapter is not None:
            checks.extend([
                ("adapter", "mount_plate", "solid", adapter, base),
                ("candidate", "adapter", "solid", candidate, adapter),
            ])
        for owner, body in (("candidate", candidate), ("adapter", adapter)):
            if body is not None:
                checks.extend((owner, name, "obstacle", body, obstacle) for name, obstacle in obstacles)

        results = []
        for body, against, kind, left, right in checks:
            if left is None or right is None:
                continue
            volume = self.geo.intersection_volume(left, right)
            if volume > self.geo.VOLUME:
                note(failures, "BODY_INTERFERENCE")
            results.append({
                "body": body, "against": against, "against_kind": kind, "volume_mm3": volume,
            })
        return results

    def connector_clearance(self, bounds, translation, obstacles, failures):
        shape = self.geo.moved(self.geo.box_shape(bounds), translation)
        result = {"bounds_mm": translate_bounds(bounds, translation), "minimum_mm": None, "obstacles": []}
        for name, obstacle in obstacles:
            distance, volume = self.geo.clearance(shape, obstacle)
            if volume > self.geo.VOLUME:
                note(failures, "CONNECTOR_INTERFERENCE")
            if self.below_limit(distance, "min_connector_clearance_mm"):
                note(failures, "CONNECTOR_CLEARANCE_BELOW_MINIMUM")
            result["obstacles"].append({
                "id": name, "distance_mm": distance, "intersection_volume_mm3": volume,
            })
        if result["obstacles"]:
            result["minimum_mm"] = min(obstacle["distance_mm"] for obstacle in result["obstacles"])
        return result

    def placement(self, translation, base, model, connector, obstacles, failures, *, adapter=None):
        placed = None
        candidate_face = None
        if translation is not None:
            if model.shape is not None:
                placed = self.geo.moved(model.shape, translation)
            if model.mount is not None:
                candidate_face = model.mount.moved(translation)

        interfaces = []
        plate = None
        if adapter is None:
            contacts = [(base.mount, candidate_face, "mount_plate_to_candidate")]
        else:
            plate, bottom, top = adapter
            contacts = [
                (base.mount, bottom, "mount_plate_to_adapter"),
                (top, candidate_face, "adapter_to_candidate"),
            ]
        for lower, upper, name in contacts:
            if lower is not None and upper is not None:
                interfaces.append(self.interface(lower, upper, name, failures))

        return {
            "translation_mm": translation,
            "mount_interfaces": interfaces,
            "intersections": self.body_intersections(base.shape, placed, plate, obstacles, failures),
            "clearance": (
                self.connector_clearance(connector, translation, obstacles, failures)
                if connector is not None and translation is not None else None
            ),
        }

    def check_adapter(self, spec, prefix, pairs, base, model, connector, obstacles):
        issues, failures = [], []
        field = f"{prefix}.adapter"
        if not need_fields(issues, spec, field, ("bounds", "translation_mm"), "ADAPTER_PLACEMENT_REQUIRED"):
            return None, issues, failures, None
        bounds = spec["bounds"]
        if not need_fields(issues, bounds, f"{field}.bounds", ("min_mm", "max_mm"), "ADAPTER_BOUNDS_REQUIRED"):
            return None, issues, failures, None
        for key in REQUIREMENTS[-2:]:
            if self.limits[key] is None:
                note(issues, "REQUIREMENT_REQUIRED", f"requirements.{key}")

        lower, upper = bounds["min_mm"], bounds["max_mm"]
        adapter_translation = spec["translation_mm"]
        holes = []
        for base_hole, candidate_hole in pairs:
            placed_hole = self.geo.move_hole(candidate_hole, adapter_translation)
            for group, hole in (("mount_plate", base_hole), ("candidate", placed_hole)):
                holes.append({
                    "id": f"{group}:{hole['id']}",
                    "pattern": group,
                    "center_mm": hole["center_mm"][:2] + [lower[2]],
                    "axis": [0, 0, 1],
                    "diameter_mm": hole["diameter_mm"],
                })
        hole_web, edge_web = self.geo.adapter_webs(bounds, holes)
        if hole_web <= self.geo.LINEAR or self.below_limit(hole_web, "min_adapter_hole_web_mm"):
            note(failures, "ADAPTER_HOLE_WEB_BELOW_MINIMUM")
        if edge_web <= self.geo.LINEAR or self.below_limit(edge_web, "min_adapter_edge_web_mm"):
            note(failures, "ADAPTER_EDGE_WEB_BELOW_MINIMUM")

        result = {
            "translation_mm": spec["translation_mm"],
            "plate": {
                "bounds_mm": bounds,
                "thickness_mm": upper[2] - lower[2],
                "min_hole_web_mm": hole_web,
                "min_edge_web_mm": edge_web,
                "holes": holes,
            },
            "mount_interfaces": [],
            "intersections": [],
            "clearance": None,
        }
        plate = None
        if hole_web > self.geo.LINEAR and edge_web > self.geo.LINEAR:
            plate = self.geo.build_adapter(bounds, holes)
            bottom = self.geo.find_mount_face(plate, lower[2], -1)
            top = self.geo.find_mount_face(plate, upper[2], 1)
            if bottom is None or top is None:
                raise RuntimeError("FreeCAD could not resolve the generated adapter faces")
            result.update(self.placement(
                adapter_translation, base, model, connector, obstacles, failures,
                adapter=(plate, bottom, top),
            ))
        return result, issues, failures, plate

    def candidate(self, item, base, shared_issues, obstacles, obstacles_complete):
        prefix = f"candidates[{item['id']}]"
        issues = shared_issues.copy()
        failures = []
        model = self.load_model(item, prefix, -1, issues)
        translation = item["translation_mm"]
        if translation is None:
            note(issues, "PLACEMENT_REQUIRED", f"{prefix}.translation_mm")
        connector = item["connector_box"]
        connector_complete = need_fields(
            issues, connector, f"{prefix}.connector_box", ("min_mm", "max_mm"), "CONNECTOR_BOX_REQUIRED",
        )
        if not connector_complete or (not obstacles_complete and not obstacles):
            connector = None

        pairs = self.pairs(item, prefix, base, model, issues)
        direct = self.placement(translation, base, model, connector, obstacles, failures)
        if direct["clearance"] is not None and not obstacles_complete:
            direct["clearance"]["minimum_mm"] = None
        direct["hole_pairs"] = self.check_direct_holes(pairs, translation, failures)
        direct_pass = not failures and not issues
        if direct_pass:
            note(failures, "DIRECT_REQUIREMENTS_MET")
        direct["issues"] = failures + issues

        adapter = None
        can_try_adapter = failures == [{"code": "HOLE_OFFSET_EXCEEDED"}] and item["adapter"] is not None
        if can_try_adapter and not issues:
            adapter, adapter_issues, adapter_failures, plate = self.check_adapter(
                item["adapter"], prefix, pairs, base, model, connector, obstacles,
            )
            if adapter_failures:
                status = "blocked"
            elif adapter_issues:
                status = "needs_input"
            else:
                status = "adapter_candidate"
                note(adapter_failures, "ADAPTER_REQUIREMENTS_MET")
                if item["id"] == self.adapter_candidate_id:
                    self.review_plate = plate
            if adapter is not None:
                adapter["issues"] = adapter_failures + adapter_issues
            failures.extend(adapter_failures)
            issues.extend(adapter_issues)
        elif can_try_adapter or (not failures and issues):
            status = "needs_input"
        elif direct_pass:
            status = "direct_mount"
        else:
            status = "blocked"

        return {
            "id": item["id"],
            "status": status,
            "reason_codes": list(dict.fromkeys(issue["code"] for issue in failures + issues)),
            "needed_inputs": list(dict.fromkeys(issue["input"] for issue in issues)),
            "candidate_model": model.evidence(),
            "direct": direct,
            "adapter": adapter,
        }

    def report(self, freecad_version):
        issues = []
        for key in REQUIREMENTS[:3]:
            if self.limits[key] is None:
                note(issues, "REQUIREMENT_REQUIRED", f"requirements.{key}")
        base = self.load_model(self.case["mount_plate"], "mount_plate", 1, issues)
        obstacles, obstacles_complete = self.obstacles(issues)
        return {
            "success": True,
            "schema_version": "0.1",
            "case_id": self.case["case_id"],
            "source_case": self.case["source_case"],
            "units": {"length": "mm", "area": "mm^2", "volume": "mm^3"},
            "scope": {
                "frame": "XY mounting planes, +Z toward candidate, translation only",
                "manual_review": ["fastener specification", "fastening strength", "electrical performance",
                                  "optical performance", "physical installation"],
            },
            "runtime": {"freecad_version": freecad_version},
            "requirements": self.limits,
            "tolerances": {
                **self.geo.TOLERANCES,
                "hole_hint_match_mm": self.geo.HOLE_HINT_TOLERANCE,
                "bore_probe_inset_mm": self.geo.BORE_PROBE_INSET,
            },
            "mount_plate": base.evidence(),
            "obstacles": self.case["obstacles"],
            "candidates": [
                self.candidate(item, base, issues, obstacles, obstacles_complete)
                for item in self.case["candidates"]
            ],
        }


def translate_bounds(bounds, delta):
    return {key: [a + b for a, b in zip(point, delta)] for key, point in bounds.items()}


def main():
    request = read_input()
    case_path = Path(request["case_path"]).absolute()
    case = read_case(case_path)
    freecad = init_freecad()
    import _retrofit_geometry as geometry

    version = ".".join(str(part) for part in freecad.Version()[:3])
    candidate_id = request.get("adapter_candidate_id")
    check = RetrofitCheck(case, case_path.parent, geometry, candidate_id)
    report = check.report(version)
    if candidate_id is not None:
        if check.review_plate is None:
            raise ValueError(f"Candidate {candidate_id!r} did not qualify as adapter_candidate")
        report["verified_step_sha256"] = geometry.export_review_step(
            check.review_plate, Path(request["adapter_step_path"]),
        )
    respond(report)


try:
    main()
except Exception as error:
    respond_error(error)
