#!/usr/bin/env python3
"""
validate-mjcf.py — Validate MuJoCo MJCF XML file.

Usage: python3 scripts/validate-mjcf.py <input.xml>

Checks:
  1. XML loads without error
  2. Body/joint/actuator counts
  3. Total mass
  4. Gravity torque on each joint
  5. Self-collision detection
  6. 100-step stability (position drift)

Outputs JSON to stdout for programmatic consumption.
"""

import json
import sys

try:
    import mujoco
except ImportError:
    print(json.dumps({"valid": False, "error": "mujoco not installed"}))
    sys.exit(1)


def validate(xml_path):
    result = {
        "valid": False,
        "file": xml_path,
        "checks": {},
    }

    # 1. Load model
    try:
        model = mujoco.MjModel.from_xml_path(xml_path)
        data = mujoco.MjData(model)
        result["checks"]["xml_load"] = True
    except Exception as e:
        result["checks"]["xml_load"] = False
        result["error"] = str(e)
        return result

    # 2. Counts
    nbody = model.nbody - 1  # exclude worldbody
    njoint = model.njnt
    nactuator = model.nu
    result["counts"] = {
        "bodies": nbody,
        "joints": njoint,
        "actuators": nactuator,
    }
    result["checks"]["has_bodies"] = bool(nbody > 0)
    result["checks"]["has_joints"] = bool(njoint > 0)

    # 3. Total mass
    total_mass = 0.0
    for i in range(model.nbody):
        total_mass += model.body_mass[i]
    result["total_mass_kg"] = round(total_mass, 6)
    result["checks"]["positive_mass"] = bool(total_mass > 0)

    # 4. Gravity torque — forward step 0 to compute
    mujoco.mj_forward(model, data)
    max_gravity_torque = 0.0
    gravity_torques = []
    for i in range(njoint):
        torque = abs(float(data.qfrc_bias[i]))
        gravity_torques.append(round(torque, 6))
        max_gravity_torque = max(max_gravity_torque, torque)
    result["gravity_torques"] = gravity_torques
    result["max_gravity_torque"] = round(max_gravity_torque, 6)

    # 5. Self-collision check at initial pose (warning only, not a validity failure)
    mujoco.mj_forward(model, data)
    n_contacts = data.ncon
    result["initial_contacts"] = int(n_contacts)
    if n_contacts > 0:
        result["warnings"] = result.get("warnings", [])
        result["warnings"].append(f"{n_contacts} initial contact(s) — parts may overlap in assembly pose")

    # 6. 100-step stability — check position drift
    initial_qpos = data.qpos.copy()
    for _ in range(100):
        mujoco.mj_step(model, data)

    max_drift = 0.0
    for i in range(model.nq):
        drift = abs(float(data.qpos[i] - initial_qpos[i]))
        max_drift = max(max_drift, drift)

    result["stability"] = {
        "steps": 100,
        "max_position_drift": round(max_drift, 8),
        "stable": bool(max_drift < 10.0),  # generous threshold for unconstrained gravity
    }
    result["checks"]["stable_100_steps"] = bool(max_drift < 10.0)

    # Overall validity
    result["valid"] = all(result["checks"].values())

    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/validate-mjcf.py <input.xml>", file=sys.stderr)
        sys.exit(1)

    xml_path = sys.argv[1]
    result = validate(xml_path)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
