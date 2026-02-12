#!/usr/bin/env python3
"""Intent Compiler: config → enriched config with drawing_plan.

Reads JSON config from stdin, classifies part type, loads matching
template from configs/templates/, merges into drawing_plan section,
and outputs enriched config as JSON to stdout.

Usage:
    cat config.json | python3 scripts/intent_compiler.py
    python3 scripts/intent_compiler.py < config.json
    python3 scripts/intent_compiler.py --classify-only < config.json
"""

import json
import sys
import os
from pathlib import Path

# Resolve templates directory relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
TEMPLATES_DIR = PROJECT_ROOT / "configs" / "templates"

KNOWN_PART_TYPES = {"flange", "shaft", "bracket", "housing", "bushing_plate", "assembly", "generic"}
VALID_VIEWS = {"front", "top", "right", "iso", "back", "bottom", "left"}
SCHEMA_VERSION = "0.1"


# ---------------------------------------------------------------------------
# Part type classification (rule-based, no LLM)
# ---------------------------------------------------------------------------

def classify_part_type(config):
    """Classify part type from shapes/operations structure.

    Rules (priority order):
    1. assembly section exists → assembly
    2. cylinder dominant + cut holes (no multi-step) → flange
    3. cylinder dominant + multi-step (≥3 cylinders fused) → shaft
    4. box + cylinder holes + thin → bracket
    5. box + cylinder holes + section view hint → housing
    6. box + cylinder holes → bushing_plate
    7. fallback → generic
    """
    # Check assembly first
    if config.get("assembly") or config.get("parts"):
        return "assembly"

    shapes = config.get("shapes", [])
    ops = config.get("operations", [])

    shape_types = [s.get("type", "") for s in shapes]
    op_types = [o.get("op", "") for o in ops]

    n_cylinders = sum(1 for t in shape_types if t == "cylinder")
    n_boxes = sum(1 for t in shape_types if t == "box")
    has_cut = "cut" in op_types
    has_fuse = "fuse" in op_types
    has_fillet = "fillet" in op_types
    has_chamfer = "chamfer" in op_types

    # Count "base" cylinders vs "hole" cylinders
    # Hole cylinders are those used as 'tool' in cut operations
    cut_tools = {o.get("tool", "") for o in ops if o.get("op") == "cut"}
    base_cylinders = [s for s in shapes if s.get("type") == "cylinder" and s.get("id") not in cut_tools]
    hole_cylinders = [s for s in shapes if s.get("type") == "cylinder" and s.get("id") in cut_tools]

    # Shaft: multiple base cylinders fused together (stepped shaft)
    if len(base_cylinders) >= 3 and has_fuse:
        return "shaft"

    # Flange: single base cylinder + many cut holes
    if len(base_cylinders) <= 2 and len(hole_cylinders) >= 4 and n_boxes == 0:
        return "flange"

    # Box-based parts
    if n_boxes >= 1 and has_cut:
        drawing = config.get("drawing", {})
        has_section = bool(drawing.get("section"))

        # Bracket: boxes fused into L/U/T shape
        if has_fuse and n_boxes >= 2:
            return "bracket"

        # Housing: internal cavities (section view hint) or deep box + fillet
        if has_section:
            return "housing"

        # Bushing plate: many holes on flat plate
        if len(hole_cylinders) >= 6:
            return "bushing_plate"

        # Fallback for box+holes: bracket (thin) vs housing (thick)
        box_shapes = [s for s in shapes if s.get("type") == "box"]
        min_thickness = min(
            (min(s.get("size", [999, 999, 999])) for s in box_shapes),
            default=999
        )
        if min_thickness < 25:
            return "bracket"
        return "housing"

    return "generic"


# ---------------------------------------------------------------------------
# Template loading (TOML)
# ---------------------------------------------------------------------------

def load_template(part_type, templates_dir=None):
    """Load configs/templates/{part_type}.toml and return as dict.

    Falls back to None if template doesn't exist (generate uses defaults).
    """
    tdir = Path(templates_dir) if templates_dir else TEMPLATES_DIR
    path = tdir / f"{part_type}.toml"

    if not path.exists():
        return None

    try:
        # Try tomllib (Python 3.11+)
        import tomllib
        with open(path, "rb") as f:
            return tomllib.load(f)
    except ImportError:
        pass

    # Fallback: simple TOML parser for our subset
    return _parse_simple_toml(path)


def _parse_simple_toml(path):
    """Minimal TOML parser for template files.
    Handles tables, arrays of tables, strings, numbers, booleans, arrays.
    """
    import re

    result = {}
    current_table = result
    current_path = []
    array_table_name = None

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            # Array of tables: [[name]]
            m = re.match(r'^\[\[(\S+)\]\]$', line)
            if m:
                name = m.group(1)
                parts = name.split(".")
                target = result
                for p in parts[:-1]:
                    target = target.setdefault(p, {})
                key = parts[-1]
                if key not in target:
                    target[key] = []
                target[key].append({})
                current_table = target[key][-1]
                array_table_name = name
                continue

            # Table: [name]
            m = re.match(r'^\[(\S+)\]$', line)
            if m:
                name = m.group(1)
                parts = name.split(".")
                current_table = result
                for p in parts:
                    current_table = current_table.setdefault(p, {})
                array_table_name = None
                continue

            # Key = value
            m = re.match(r'^(\w+)\s*=\s*(.+)$', line)
            if m:
                key = m.group(1)
                val_str = m.group(2).strip()
                current_table[key] = _parse_toml_value(val_str)

    return result


def _parse_toml_value(s):
    """Parse a TOML value string."""
    s = s.strip()
    if s == "true":
        return True
    if s == "false":
        return False
    if s.startswith('"') and s.endswith('"'):
        return s[1:-1]
    if s.startswith("'") and s.endswith("'"):
        return s[1:-1]
    if s.startswith("["):
        return _parse_toml_array(s)
    if s.startswith("{"):
        return _parse_toml_inline_table(s)
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        return s


def _parse_toml_array(s):
    """Parse a TOML array like ["a", "b", "c"]."""
    s = s.strip()[1:-1].strip()
    if not s:
        return []
    items = []
    depth = 0
    current = ""
    in_str = False
    str_char = None
    for ch in s:
        if not in_str and ch in ('"', "'"):
            in_str = True
            str_char = ch
            current += ch
        elif in_str and ch == str_char:
            in_str = False
            current += ch
        elif not in_str and ch in ("[", "{"):
            depth += 1
            current += ch
        elif not in_str and ch in ("]", "}"):
            depth -= 1
            current += ch
        elif not in_str and ch == "," and depth == 0:
            items.append(_parse_toml_value(current.strip()))
            current = ""
        else:
            current += ch
    if current.strip():
        items.append(_parse_toml_value(current.strip()))
    return items


def _parse_toml_inline_table(s):
    """Parse a TOML inline table like { key = value, ... }."""
    import re
    s = s.strip()[1:-1].strip()
    result = {}
    for pair in re.split(r',\s*(?=\w+\s*=)', s):
        pair = pair.strip()
        if not pair:
            continue
        m = re.match(r'(\w+)\s*=\s*(.+)', pair)
        if m:
            result[m.group(1)] = _parse_toml_value(m.group(2).strip())
    return result


# ---------------------------------------------------------------------------
# Plan merging
# ---------------------------------------------------------------------------

def merge_plan(config, template):
    """Merge template rules with config explicit values into drawing_plan.

    Priority: config explicit > template rules > generate defaults
    """
    plan = {
        "schema_version": SCHEMA_VERSION,
        "part_type": template.get("template", {}).get("part_type", "generic") if template else "generic",
        "profile": "KS",
    }

    # Existing plan overrides from config (user can pre-set values)
    existing_plan = config.get("drawing_plan", {})

    if template:
        # Views
        tpl_views = template.get("views", {})
        plan["views"] = {
            "enabled": tpl_views.get("enabled", ["front", "top", "right", "iso"]),
            "layout": tpl_views.get("layout", "third_angle"),
            "options": {},
        }
        for vname in VALID_VIEWS:
            if vname in tpl_views:
                plan["views"]["options"][vname] = tpl_views[vname]
        # Also check views.options from template
        tpl_view_opts = tpl_views.get("options", {})
        for vname, opts in tpl_view_opts.items():
            plan["views"]["options"][vname] = opts

        # Datums
        plan["datums"] = template.get("datums", [])

        # Dimensioning
        plan["dimensioning"] = template.get("dimensioning", {})

        # Dim intents
        plan["dim_intents"] = template.get("dim_intents", [])

        # Notes
        plan["notes"] = template.get("notes", {})

        # Scale (defaults)
        plan["scale"] = template.get("scale", {"mode": "auto", "min": 0.4, "max": 2.5})
    else:
        # No template: minimal plan
        plan["views"] = {
            "enabled": ["front", "top", "right", "iso"],
            "layout": "third_angle",
            "options": {
                "iso": {"show_hidden": False, "show_centerlines": False},
            },
        }
        plan["datums"] = []
        plan["dimensioning"] = {}
        plan["dim_intents"] = []
        plan["notes"] = {}
        plan["scale"] = {"mode": "auto", "min": 0.4, "max": 2.5}

    # Override with existing plan values (config explicit > template)
    _deep_merge(plan, existing_plan)

    # Override part_type if explicitly set
    if existing_plan.get("part_type"):
        plan["part_type"] = existing_plan["part_type"]

    return plan


def _deep_merge(base, override, _parent_key=""):
    """Recursively merge override into base. Override wins for leaf values.

    Special: lists of dicts with 'id' keys use id-based patch merge by default.
    - Same id → deep-merge fields (override wins)
    - New id  → append at end
    - remove=true → delete from result
    Set ``<key>_merge = "replace"`` in parent dict to force full replacement.
    """
    for key, val in override.items():
        # Skip merge-mode directives (consumed below)
        if key.endswith("_merge"):
            base[key] = val
            continue

        if key in base and isinstance(base[key], dict) and isinstance(val, dict):
            _deep_merge(base[key], val, _parent_key=key)
        elif (key in base
              and isinstance(base[key], list) and isinstance(val, list)
              and _is_id_list(base[key]) and _is_id_list(val)):
            mode = override.get(f"{key}_merge", "patch")
            if mode == "replace":
                base[key] = val
            else:
                base[key] = _merge_id_list(base[key], val)
        else:
            base[key] = val


def _is_id_list(lst):
    """True if list contains dicts that all have an 'id' key."""
    return len(lst) > 0 and all(isinstance(x, dict) and "id" in x for x in lst)


def _merge_id_list(base_list, override_list):
    """Patch-merge two lists of id-bearing dicts.

    - Template order preserved
    - Override items with matching id → field-level merge
    - Override items with remove=true → removed from result
    - New ids → appended at end
    """
    removed = {x["id"] for x in override_list if x.get("remove") is True}
    ov_map = {x["id"]: x for x in override_list if not x.get("remove")}
    base_ids = set()
    out = []

    for item in base_list:
        iid = item["id"]
        if iid in removed:
            continue
        base_ids.add(iid)
        if iid in ov_map:
            merged = {**item}
            for k, v in ov_map[iid].items():
                if k == "remove":
                    continue
                merged[k] = v
            out.append(merged)
        else:
            out.append(item)

    # Append new ids from override
    for iid, item in ov_map.items():
        if iid not in base_ids:
            clean = {k: v for k, v in item.items() if k != "remove"}
            out.append(clean)

    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Intent Compiler for drawing plan")
    parser.add_argument("--classify-only", action="store_true",
                        help="Only output part type classification")
    parser.add_argument("--templates-dir", type=str, default=None,
                        help="Override templates directory")
    args = parser.parse_args()

    config = json.load(sys.stdin)

    # Step 1: Classify part type
    explicit_type = config.get("drawing_plan", {}).get("part_type")
    part_type = explicit_type or classify_part_type(config)

    if args.classify_only:
        json.dump({"part_type": part_type}, sys.stdout)
        sys.stdout.write("\n")
        return

    # Step 2: Load template
    templates_dir = args.templates_dir or TEMPLATES_DIR
    template = load_template(part_type, templates_dir)

    # Step 3: Merge plan
    plan = merge_plan(config, template)
    plan["part_type"] = part_type

    # Step 3.5: Enrich dim_intents with value_mm from config/features
    if plan.get("dim_intents"):
        try:
            from _feature_inference import infer_features_from_config
            from feature_extractor import extract_values
            fg = infer_features_from_config(config)
            plan["dim_intents"] = extract_values(config, fg, plan["dim_intents"])
        except Exception as e:
            print(f"Feature extraction warning: {e}", file=sys.stderr)

    # Step 4: Validate (inline, lightweight)
    # If no template was found, validate as "generic" (no required intents)
    from plan_validator import validate_plan
    validate_type = part_type if template else "generic"
    result = validate_plan(plan, validate_type)
    if not result["valid"]:
        print(f"Plan validation errors: {result['errors']}", file=sys.stderr)
        sys.exit(1)
    if result["warnings"]:
        print(f"Plan warnings: {result['warnings']}", file=sys.stderr)

    # Step 5: Output enriched config
    config["drawing_plan"] = plan
    json.dump(config, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
