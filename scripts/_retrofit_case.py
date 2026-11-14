"""Read the v0.1 case contract without importing FreeCAD."""

import hashlib
import json
import math


def finite_number(value, field):
    if type(value) not in (float, int) or not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number")
    return value


def identifier(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def vector(value, field):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{field} must be a three-number array")
    return [finite_number(component, f"{field}[{index}]") for index, component in enumerate(value)]


def direction(value, field):
    components = vector(value, field)
    length = math.hypot(*components)
    if not math.isfinite(length) or length == 0:
        raise ValueError(f"{field} must be a nonzero direction")
    return [component / length for component in components]


def optional(value, field, parse):
    return None if value is None else parse(value, field)


def fields(value, field, *allowed):
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    extra = value.keys() - set(allowed)
    if extra:
        raise ValueError(f"{field} has unsupported fields: {', '.join(sorted(extra))}")
    return value


def nonnegative(value, field):
    number = finite_number(value, field)
    if number < 0:
        raise ValueError(f"{field} must be nonnegative")
    return number


def records(value, field, parse, *, unique_ids=False):
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    entries = [parse(entry, f"{field}[{index}]") for index, entry in enumerate(value)]
    if unique_ids:
        ids = [entry["id"] for entry in entries]
        if len(set(ids)) != len(ids):
            raise ValueError(f"{field} must have unique IDs")
    return entries


def bounds(value, field):
    box = fields(value, field, "min_mm", "max_mm")
    lower = optional(box.get("min_mm"), f"{field}.min_mm", vector)
    upper = optional(box.get("max_mm"), f"{field}.max_mm", vector)
    if lower is not None and upper is not None and any(a >= b for a, b in zip(lower, upper)):
        raise ValueError(f"{field} must have min_mm strictly below max_mm on all axes")
    return {"min_mm": lower, "max_mm": upper}


def obstacle(value, field):
    item = fields(value, field, "id", "min_mm", "max_mm")
    return {
        "id": identifier(item.get("id"), f"{field}.id"),
        **bounds({key: item[key] for key in ("min_mm", "max_mm") if key in item}, field),
    }


def mount_plane(value, field):
    item = fields(value, field, "z_mm", "normal")
    return {
        "z_mm": optional(item.get("z_mm"), f"{field}.z_mm", finite_number),
        "normal": optional(item.get("normal"), f"{field}.normal", direction),
    }


def hole(value, field):
    item = fields(value, field, "id", "center_mm", "axis")
    return {
        "id": identifier(item.get("id"), f"{field}.id"),
        "center_mm": optional(item.get("center_mm"), f"{field}.center_mm", vector),
        "axis": optional(item.get("axis"), f"{field}.axis", direction),
    }


def pairing(value, field):
    item = fields(value, field, "base_hole", "candidate_hole")
    return {
        key: optional(item.get(key), f"{field}.{key}", identifier)
        for key in ("base_hole", "candidate_hole")
    }


def adapter(value, field):
    item = fields(value, field, "bounds", "translation_mm")
    return {
        "bounds": optional(item.get("bounds"), f"{field}.bounds", bounds),
        "translation_mm": optional(item.get("translation_mm"), f"{field}.translation_mm", vector),
    }


def part(item, field):
    return {
        "step_file": optional(item.get("step_file"), f"{field}.step_file", identifier),
        "mount_plane": optional(item.get("mount_plane"), f"{field}.mount_plane", mount_plane),
        "holes": optional(
            item.get("holes"), f"{field}.holes",
            lambda value, name: records(value, name, hole, unique_ids=True),
        ),
    }


def candidate(value, field):
    item = fields(
        value, field, "id", "step_file", "mount_plane", "holes", "translation_mm",
        "hole_pairs", "connector_box", "adapter",
    )
    return {
        "id": identifier(item.get("id"), f"{field}.id"),
        **part(item, field),
        "translation_mm": optional(item.get("translation_mm"), f"{field}.translation_mm", vector),
        "hole_pairs": optional(item.get("hole_pairs"), f"{field}.hole_pairs",
                               lambda value, name: records(value, name, pairing)),
        "connector_box": optional(item.get("connector_box"), f"{field}.connector_box", bounds),
        "adapter": optional(item.get("adapter"), f"{field}.adapter", adapter),
    }


REQUIREMENTS = (
    "max_hole_offset_mm", "min_hole_diameter_mm", "min_connector_clearance_mm",
    "min_adapter_hole_web_mm", "min_adapter_edge_web_mm",
)


def unique_fields(pairs):
    record = {}
    for key, value in pairs:
        if key in record:
            raise ValueError(f"Duplicate JSON key: {key}")
        record[key] = value
    return record


def invalid_constant(value):
    raise ValueError(f"Non-JSON number: {value}")


def read_case(path):
    raw = path.read_bytes()
    try:
        document = json.loads(
            raw.decode("utf-8"), parse_constant=invalid_constant, object_pairs_hook=unique_fields,
        )
    except (UnicodeError, ValueError) as error:
        raise ValueError(f"Invalid JSON in {path}: {error}") from error
    item = fields(document, "case", "case_id", "units", "mount_plate", "obstacles", "requirements", "candidates")
    if item.get("units") != "mm":
        raise ValueError('units must be "mm"')
    base = optional(item.get("mount_plate"), "mount_plate",
                    lambda value, name: fields(value, name, "step_file", "mount_plane", "holes"))
    limits = optional(item.get("requirements"), "requirements",
                      lambda value, name: fields(value, name, *REQUIREMENTS)) or {}
    candidates = records(item.get("candidates"), "candidates", candidate, unique_ids=True)
    if not candidates:
        raise ValueError("candidates must contain at least one candidate")
    return {
        "case_id": identifier(item.get("case_id"), "case_id"),
        "units": "mm",
        "source_case": {"file": path.name, "sha256": hashlib.sha256(raw).hexdigest()},
        "mount_plate": part(base or {}, "mount_plate"),
        "obstacles": optional(
            item.get("obstacles"), "obstacles",
            lambda value, name: records(value, name, obstacle, unique_ids=True),
        ),
        "requirements": {
            key: optional(limits.get(key), f"requirements.{key}", nonnegative) for key in REQUIREMENTS
        },
        "candidates": candidates,
    }
