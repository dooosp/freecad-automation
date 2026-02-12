#!/usr/bin/env python3
"""Drawing Plan Validator: validates drawing_plan structure and completeness.

Usage:
    python3 scripts/plan_validator.py enriched_config.json
    echo '{"drawing_plan": {...}}' | python3 scripts/plan_validator.py -

Can also be imported: from plan_validator import validate_plan
"""

import json
import sys
from pathlib import Path

SUPPORTED_VERSIONS = {"0.1"}
KNOWN_PART_TYPES = {"flange", "shaft", "bracket", "housing", "bushing_plate", "assembly", "generic"}
VALID_VIEWS = {"front", "top", "right", "iso", "back", "bottom", "left"}
VALID_DIM_STYLES = {"diameter", "linear", "radius", "callout", "note", "angular"}
VALID_DATUM_KINDS = {"plane", "axis", "point"}
VALID_LAYOUTS = {"third_angle", "first_angle"}

# Required dim_intents per part type (minimum set)
REQUIRED_INTENTS = {
    "flange": {"OD", "ID", "PCD", "BOLT_DIA", "THK"},
    "shaft": {"TOTAL_LENGTH", "STEP_DIAMETERS"},
    "bracket": {"WIDTH", "HEIGHT", "THK", "HOLE_DIA"},
    "housing": {"WIDTH", "HEIGHT", "DEPTH"},
    "bushing_plate": {"WIDTH", "HEIGHT", "THK", "BUSHING_DIA"},
    "assembly": set(),  # assembly has no fixed required dims
    "generic": set(),
}

# Known plan keys for typo detection
KNOWN_PLAN_KEYS = {
    "schema_version", "part_type", "profile",
    "views", "scale", "datums", "dimensioning", "dim_intents", "notes",
    "sections",
}
KNOWN_VIEW_KEYS = {"enabled", "layout", "options"}
KNOWN_DIM_KEYS = {"scheme", "baseline_datum", "avoid_redundant"}
KNOWN_INTENT_KEYS = {"id", "feature", "view", "style", "required", "priority"}
KNOWN_NOTE_KEYS = {"general", "placement"}


def validate_plan(plan, part_type=None):
    """Validate drawing_plan dict.

    Returns: {"valid": bool, "errors": [...], "warnings": [...]}
    """
    errors = []
    warnings = []

    if not plan:
        errors.append("drawing_plan is empty or missing")
        return {"valid": False, "errors": errors, "warnings": warnings}

    pt = part_type or plan.get("part_type", "generic")

    # V1: schema_version
    sv = plan.get("schema_version")
    if not sv:
        errors.append("V1: schema_version is missing")
    elif sv not in SUPPORTED_VERSIONS:
        errors.append(f"V1: schema_version '{sv}' not supported (supported: {SUPPORTED_VERSIONS})")

    # V2: part_type
    plan_pt = plan.get("part_type")
    if not plan_pt:
        errors.append("V2: part_type is missing")
    elif plan_pt not in KNOWN_PART_TYPES:
        warnings.append(f"V2: part_type '{plan_pt}' not in known types: {KNOWN_PART_TYPES}")

    # V3: views.enabled
    views = plan.get("views", {})
    enabled = views.get("enabled", [])
    if not enabled:
        errors.append("V3: views.enabled is empty")
    else:
        for v in enabled:
            if v not in VALID_VIEWS:
                errors.append(f"V3: unknown view name '{v}' (valid: {VALID_VIEWS})")

    # V4: required dim_intents completeness
    dim_intents = plan.get("dim_intents", [])
    required_ids = {d["id"] for d in dim_intents if d.get("required")}
    expected = REQUIRED_INTENTS.get(pt, set())
    missing = expected - required_ids
    if missing:
        errors.append(f"V4: missing required dim_intents for {pt}: {missing}")

    # V5: dim_intents view validity
    enabled_set = set(enabled) | {"notes"}  # "notes" is special
    for di in dim_intents:
        di_view = di.get("view", "")
        if di_view and di_view not in enabled_set:
            warnings.append(f"V5: dim_intent '{di.get('id')}' targets view '{di_view}' not in enabled views")

    # V6: datums
    datums = plan.get("datums", [])
    if not datums:
        warnings.append("V6: no datums defined")
    else:
        for d in datums:
            if d.get("kind") and d["kind"] not in VALID_DATUM_KINDS:
                warnings.append(f"V6: datum '{d.get('name')}' has unknown kind '{d['kind']}'")

    # V7: scale
    scale = plan.get("scale", {})
    if scale:
        smin = scale.get("min", 0.4)
        smax = scale.get("max", 2.5)
        if isinstance(smin, (int, float)) and isinstance(smax, (int, float)):
            if smin > smax:
                errors.append(f"V7: scale.min ({smin}) > scale.max ({smax})")

    # V8: notes.general
    notes = plan.get("notes", {})
    if not notes.get("general"):
        warnings.append("V8: notes.general is empty")

    # V9: unknown keys (typo detection)
    for key in plan:
        if key not in KNOWN_PLAN_KEYS:
            warnings.append(f"V9: unknown plan key '{key}' (typo?)")
    for key in views:
        if key not in KNOWN_VIEW_KEYS:
            warnings.append(f"V9: unknown views key '{key}'")
    dimensioning = plan.get("dimensioning", {})
    for key in dimensioning:
        if key not in KNOWN_DIM_KEYS:
            warnings.append(f"V9: unknown dimensioning key '{key}'")
    for di in dim_intents:
        for key in di:
            if key not in KNOWN_INTENT_KEYS:
                warnings.append(f"V9: unknown dim_intent key '{key}' in intent '{di.get('id')}'")

    # V10: dim_intents id uniqueness
    ids = [d.get("id") for d in dim_intents]
    seen = set()
    for did in ids:
        if did in seen:
            errors.append(f"V10: duplicate dim_intent id '{did}'")
        seen.add(did)

    # Additional: dim_intent style validity
    for di in dim_intents:
        s = di.get("style", "")
        if s and s not in VALID_DIM_STYLES:
            warnings.append(f"dim_intent '{di.get('id')}' has unknown style '{s}'")

    # Layout validity
    layout = views.get("layout", "")
    if layout and layout not in VALID_LAYOUTS:
        warnings.append(f"unknown layout '{layout}' (valid: {VALID_LAYOUTS})")

    valid = len(errors) == 0
    return {"valid": valid, "errors": errors, "warnings": warnings}


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Validate drawing plan")
    parser.add_argument("input", nargs="?", default="-",
                        help="JSON file path or - for stdin")
    parser.add_argument("--part-type", type=str, default=None,
                        help="Override part type for validation")
    args = parser.parse_args()

    if args.input == "-":
        data = json.load(sys.stdin)
    else:
        with open(args.input) as f:
            data = json.load(f)

    plan = data.get("drawing_plan", data)
    pt = args.part_type or plan.get("part_type", "generic")

    result = validate_plan(plan, pt)

    if result["errors"]:
        print(f"FAIL ({len(result['errors'])} error(s))")
        for e in result["errors"]:
            print(f"  ERROR: {e}")
    else:
        print("PASS")

    if result["warnings"]:
        for w in result["warnings"]:
            print(f"  WARN: {w}")

    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
