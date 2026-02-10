"""
Kinematic motion simulation for assemblies.
Parses joints + couplings + motion config → generates keyframes for viewer animation.
"""

import sys


def solve_kinematics(assembly_config, placed_shapes):
    """
    Parse joints, couplings, and motion from assembly config.
    Generate keyframes for each joint-connected part.

    Args:
        assembly_config: dict with joints[], couplings[], motion{}
        placed_shapes: dict of part_id → FreeCAD Part.Shape (already placed by mate solver)

    Returns:
        dict with {duration, loop, parts: {part_id: {type, axis, anchor, keyframes}}}
        or None if no motion config
    """
    joints_list = assembly_config.get("joints", [])
    couplings_list = assembly_config.get("couplings", [])
    motion_config = assembly_config.get("motion")

    if not motion_config or not joints_list:
        return None

    # 1. Parse joints into lookup: joint_id → {id, type, part, axis}
    joints = {}
    for j in joints_list:
        jid = j["id"]
        joints[jid] = {
            "id": jid,
            "type": j.get("type", "revolute"),
            "part": j["part"],
            "axis": j.get("axis", [0, 0, 1]),
        }

    # 2. Parse couplings: driver_joint_id → [(follower_joint_id, ratio)]
    coupling_map = {}
    for c in couplings_list:
        driver_id = c["driver"]
        follower_id = c["follower"]
        ratio = c.get("ratio", 1.0)
        if driver_id not in coupling_map:
            coupling_map[driver_id] = []
        coupling_map[driver_id].append((follower_id, ratio))

    # 3. Motion parameters
    driver_joint_id = motion_config["driver"]
    angle_range = motion_config.get("range", [0, 360])
    duration = motion_config.get("duration", 2.0)
    steps = motion_config.get("steps", 60)
    loop = motion_config.get("loop", True)

    if driver_joint_id not in joints:
        print(f"[kinematics] WARNING: driver joint '{driver_joint_id}' not found", file=sys.stderr, flush=True)
        return None

    # 4. Compute anchor points from placed shapes (CenterOfMass)
    anchors = {}
    for jid, jinfo in joints.items():
        part_id = jinfo["part"]
        if part_id in placed_shapes:
            shape = placed_shapes[part_id]
            try:
                # Compounds don't have CenterOfMass, use BoundBox center
                try:
                    com = shape.CenterOfMass
                except AttributeError:
                    bb = shape.BoundBox
                    from FreeCAD import Vector
                    com = Vector(bb.Center.x, bb.Center.y, bb.Center.z)
                anchors[jid] = [round(com.x, 4), round(com.y, 4), round(com.z, 4)]
            except Exception:
                anchors[jid] = [0, 0, 0]
        else:
            anchors[jid] = [0, 0, 0]
            print(f"[kinematics] WARNING: part '{part_id}' not in placed_shapes", file=sys.stderr, flush=True)

    # 5. Generate keyframes for driver
    driver_joint = joints[driver_joint_id]
    start_angle = angle_range[0]
    end_angle = angle_range[1]

    driver_keyframes = []
    for i in range(steps + 1):
        t = round(duration * i / steps, 4)
        angle = round(start_angle + (end_angle - start_angle) * i / steps, 4)
        driver_keyframes.append({"t": t, "angle": angle})

    # 6. Build result parts dict
    result_parts = {}

    # Driver part
    result_parts[driver_joint["part"]] = {
        "type": driver_joint["type"],
        "axis": driver_joint["axis"],
        "anchor": anchors.get(driver_joint_id, [0, 0, 0]),
        "keyframes": driver_keyframes,
    }

    # 7. Generate follower keyframes via couplings
    if driver_joint_id in coupling_map:
        for follower_id, ratio in coupling_map[driver_joint_id]:
            if follower_id not in joints:
                print(f"[kinematics] WARNING: follower joint '{follower_id}' not found", file=sys.stderr, flush=True)
                continue

            follower_joint = joints[follower_id]
            follower_keyframes = []
            for kf in driver_keyframes:
                follower_angle = round(kf["angle"] * ratio, 4)
                follower_keyframes.append({"t": kf["t"], "angle": follower_angle})

            result_parts[follower_joint["part"]] = {
                "type": follower_joint["type"],
                "axis": follower_joint["axis"],
                "anchor": anchors.get(follower_id, [0, 0, 0]),
                "keyframes": follower_keyframes,
            }

    print(f"[kinematics] Generated motion: {len(result_parts)} part(s), {steps} steps, {duration}s", file=sys.stderr, flush=True)

    return {
        "duration": duration,
        "loop": loop,
        "parts": result_parts,
    }
