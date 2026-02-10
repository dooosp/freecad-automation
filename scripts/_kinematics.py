"""
Kinematic motion simulation for assemblies.
Parses joints + couplings + motion config → generates keyframes for viewer animation.

Supported joint types: revolute, prismatic, cylindrical
Supported coupling types: gear, belt, cam_follower
Supported linkage solvers: four_bar, crank_slider
"""

import math
import sys


# ---------------------------------------------------------------------------
# Cam profile helper (shared with _parts_library.py disc_cam)
# ---------------------------------------------------------------------------

def _cam_displacement(angle_deg, base_radius, max_lift, profile):
    """Compute follower displacement from cam angle (degrees)."""
    theta = math.radians(angle_deg) % (2.0 * math.pi)
    if theta <= math.pi:
        phase = theta / math.pi
    else:
        phase = (2.0 * math.pi - theta) / math.pi

    if profile == "cycloidal":
        lift = max_lift * (phase - math.sin(2.0 * math.pi * phase) / (2.0 * math.pi))
    else:  # harmonic (default)
        lift = max_lift * (1.0 - math.cos(math.pi * phase)) / 2.0

    return round(lift, 4)


# ---------------------------------------------------------------------------
# Four-bar linkage solver
# ---------------------------------------------------------------------------

def _solve_four_bar(crank_angle_deg, a, b, c, d):
    """
    Solve 4-bar linkage for given crank angle.
    a=crank, b=coupler, c=rocker, d=ground length.
    Returns (coupler_angle_deg, rocker_angle_deg) or None if no solution.

    Uses the Freudenstein equation:
    K1*cos(theta4) - K2*cos(theta2) + K3 = cos(theta2 - theta4)
    where K1=d/a, K2=d/c, K3=(a²-b²+c²+d²)/(2ac)
    """
    theta2 = math.radians(crank_angle_deg)
    K1 = d / a
    K2 = d / c
    K3 = (a * a - b * b + c * c + d * d) / (2.0 * a * c)

    A = math.cos(theta2) - K1 - K2 * math.cos(theta2) + K3
    B = -2.0 * math.sin(theta2)
    C = K1 - (K2 + 1.0) * math.cos(theta2) + K3

    discriminant = B * B - 4.0 * A * C
    if discriminant < 0:
        return None

    sqrt_d = math.sqrt(discriminant)
    t1 = (-B + sqrt_d) / (2.0 * A) if abs(A) > 1e-12 else 0
    theta4 = 2.0 * math.atan(t1)

    # Coupler angle from triangle
    Bx = a * math.cos(theta2)
    By = a * math.sin(theta2)
    Dx = d
    Dy = 0
    Cx = Dx + c * math.cos(theta4)
    Cy = Dy + c * math.sin(theta4)
    theta3 = math.atan2(Cy - By, Cx - Bx)

    return (math.degrees(theta3), math.degrees(theta4))


# ---------------------------------------------------------------------------
# Crank-slider solver
# ---------------------------------------------------------------------------

def _solve_crank_slider(crank_angle_deg, crank_r, rod_length):
    """
    Solve crank-slider: crank angle → piston displacement along X axis.
    displacement = r*cos(θ) + sqrt(l² - r²*sin²(θ))
    Returns displacement from TDC (top dead center at θ=0).
    """
    theta = math.radians(crank_angle_deg)
    sin_t = math.sin(theta)
    cos_t = math.cos(theta)
    under_sqrt = rod_length * rod_length - crank_r * crank_r * sin_t * sin_t
    if under_sqrt < 0:
        under_sqrt = 0
    x = crank_r * cos_t + math.sqrt(under_sqrt)
    # TDC position (theta=0): x_tdc = crank_r + rod_length
    x_tdc = crank_r + rod_length
    return round(x_tdc - x, 4)


# ---------------------------------------------------------------------------
# Main solver
# ---------------------------------------------------------------------------

def solve_kinematics(assembly_config, placed_shapes):
    """
    Parse joints, couplings, and motion from assembly config.
    Generate keyframes for each joint-connected part.

    Returns:
        dict with {duration, loop, parts: {part_id: {type, axis, anchor, keyframes}}}
        or None if no motion config
    """
    joints_list = assembly_config.get("joints", [])
    couplings_list = assembly_config.get("couplings", [])
    motion_config = assembly_config.get("motion")

    if not motion_config or not joints_list:
        return None

    # 1. Parse joints: joint_id → {id, type, part, axis, lead?}
    joints = {}
    for j in joints_list:
        jid = j["id"]
        joints[jid] = {
            "id": jid,
            "type": j.get("type", "revolute"),
            "part": j["part"],
            "axis": j.get("axis", [0, 0, 1]),
            "lead": j.get("lead", 0),  # mm/rev for cylindrical
        }

    # 2. Parse couplings: driver_joint_id → [(type, follower_id, params)]
    coupling_map = {}
    for c in couplings_list:
        driver_id = c["driver"]
        follower_id = c["follower"]
        ctype = c.get("type", "gear")
        entry = {
            "type": ctype,
            "follower": follower_id,
            "ratio": c.get("ratio", 1.0),
        }
        if ctype == "cam_follower":
            entry["cam_profile"] = c.get("cam_profile", "harmonic")
            entry["base_radius"] = c.get("base_radius", 20)
            entry["max_lift"] = c.get("max_lift", 10)
        if driver_id not in coupling_map:
            coupling_map[driver_id] = []
        coupling_map[driver_id].append(entry)

    # 3. Motion parameters
    driver_joint_id = motion_config["driver"]
    angle_range = motion_config.get("range", [0, 360])
    disp_range = motion_config.get("displacement_range")  # for prismatic driver
    duration = motion_config.get("duration", 2.0)
    steps = motion_config.get("steps", 60)
    loop = motion_config.get("loop", True)

    # Linkage parameters
    linkage_type = motion_config.get("linkage")  # "four_bar" or "crank_slider"
    linkage_params = motion_config.get("linkage_params", {})

    if driver_joint_id not in joints:
        print(f"[kinematics] WARNING: driver joint '{driver_joint_id}' not found", file=sys.stderr, flush=True)
        return None

    # 4. Compute anchor points from placed shapes
    anchors = {}
    for jid, jinfo in joints.items():
        part_id = jinfo["part"]
        if part_id in placed_shapes:
            shape = placed_shapes[part_id]
            try:
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

    # 5. Generate driver keyframes
    driver_joint = joints[driver_joint_id]
    driver_type = driver_joint["type"]

    driver_keyframes = []
    if driver_type == "prismatic" and disp_range:
        # Prismatic driver: displacement keyframes
        start_d = disp_range[0]
        end_d = disp_range[1]
        for i in range(steps + 1):
            t = round(duration * i / steps, 4)
            d = round(start_d + (end_d - start_d) * i / steps, 4)
            driver_keyframes.append({"t": t, "displacement": d})
    else:
        # Revolute/cylindrical driver: angle keyframes
        start_angle = angle_range[0]
        end_angle = angle_range[1]
        for i in range(steps + 1):
            t = round(duration * i / steps, 4)
            angle = round(start_angle + (end_angle - start_angle) * i / steps, 4)
            kf = {"t": t, "angle": angle}
            # Cylindrical: auto-compute displacement from lead
            if driver_type == "cylindrical" and driver_joint["lead"] != 0:
                kf["displacement"] = round(angle / 360.0 * driver_joint["lead"], 4)
            driver_keyframes.append(kf)

    # 6. Build result parts dict
    result_parts = {}

    result_parts[driver_joint["part"]] = {
        "type": driver_type,
        "axis": driver_joint["axis"],
        "anchor": anchors.get(driver_joint_id, [0, 0, 0]),
        "keyframes": driver_keyframes,
    }

    # 7. Follower keyframes via couplings
    if driver_joint_id in coupling_map:
        for entry in coupling_map[driver_joint_id]:
            follower_id = entry["follower"]
            if follower_id not in joints:
                print(f"[kinematics] WARNING: follower joint '{follower_id}' not found", file=sys.stderr, flush=True)
                continue

            follower_joint = joints[follower_id]
            follower_keyframes = []
            ctype = entry["type"]

            for kf in driver_keyframes:
                if ctype in ("gear", "belt"):
                    # gear/belt: angle ratio (belt = same direction by default)
                    driver_angle = kf.get("angle", 0)
                    follower_angle = round(driver_angle * entry["ratio"], 4)
                    fkf = {"t": kf["t"], "angle": follower_angle}
                    # Cylindrical follower: auto displacement from lead
                    if follower_joint["type"] == "cylindrical" and follower_joint["lead"] != 0:
                        fkf["displacement"] = round(follower_angle / 360.0 * follower_joint["lead"], 4)
                    follower_keyframes.append(fkf)

                elif ctype == "cam_follower":
                    # Driver revolute angle → follower prismatic displacement via cam profile
                    driver_angle = kf.get("angle", 0)
                    disp = _cam_displacement(
                        driver_angle,
                        entry["base_radius"],
                        entry["max_lift"],
                        entry["cam_profile"],
                    )
                    follower_keyframes.append({"t": kf["t"], "displacement": disp})

            result_parts[follower_joint["part"]] = {
                "type": follower_joint["type"],
                "axis": follower_joint["axis"],
                "anchor": anchors.get(follower_id, [0, 0, 0]),
                "keyframes": follower_keyframes,
            }

    # 8. Linkage-based motion (four_bar, crank_slider)
    if linkage_type == "four_bar":
        # Expects linkage_params: {a, b, c, d, coupler_joint, rocker_joint}
        a = linkage_params["a"]  # crank length
        b = linkage_params["b"]  # coupler length
        c = linkage_params["c"]  # rocker length
        d_len = linkage_params["d"]  # ground length
        coupler_jid = linkage_params.get("coupler_joint")
        rocker_jid = linkage_params.get("rocker_joint")

        for jid in [coupler_jid, rocker_jid]:
            if jid and jid in joints:
                j = joints[jid]
                kfs = []
                for kf in driver_keyframes:
                    angle = kf.get("angle", 0)
                    sol = _solve_four_bar(angle, a, b, c, d_len)
                    if sol:
                        coupler_a, rocker_a = sol
                        val = coupler_a if jid == coupler_jid else rocker_a
                        kfs.append({"t": kf["t"], "angle": round(val, 4)})
                    else:
                        # Dead position: hold last angle
                        last_a = kfs[-1]["angle"] if kfs else 0
                        kfs.append({"t": kf["t"], "angle": last_a})

                result_parts[j["part"]] = {
                    "type": "revolute",
                    "axis": j["axis"],
                    "anchor": anchors.get(jid, [0, 0, 0]),
                    "keyframes": kfs,
                }

    elif linkage_type == "crank_slider":
        # Expects linkage_params: {crank_r, rod_length, piston_joint}
        crank_r = linkage_params["crank_r"]
        rod_length = linkage_params["rod_length"]
        piston_jid = linkage_params.get("piston_joint")
        rod_jid = linkage_params.get("rod_joint")

        # Piston (prismatic)
        if piston_jid and piston_jid in joints:
            j = joints[piston_jid]
            kfs = []
            for kf in driver_keyframes:
                angle = kf.get("angle", 0)
                disp = _solve_crank_slider(angle, crank_r, rod_length)
                kfs.append({"t": kf["t"], "displacement": disp})
            result_parts[j["part"]] = {
                "type": "prismatic",
                "axis": j["axis"],
                "anchor": anchors.get(piston_jid, [0, 0, 0]),
                "keyframes": kfs,
            }

        # Connecting rod (revolute, angle derived from crank-slider geometry)
        if rod_jid and rod_jid in joints:
            j = joints[rod_jid]
            kfs = []
            for kf in driver_keyframes:
                angle = kf.get("angle", 0)
                theta = math.radians(angle)
                sin_phi = crank_r * math.sin(theta) / rod_length
                sin_phi = max(-1, min(1, sin_phi))
                phi = math.degrees(math.asin(sin_phi))
                kfs.append({"t": kf["t"], "angle": round(phi, 4)})
            result_parts[j["part"]] = {
                "type": "revolute",
                "axis": j["axis"],
                "anchor": anchors.get(rod_jid, [0, 0, 0]),
                "keyframes": kfs,
            }

    print(f"[kinematics] Generated motion: {len(result_parts)} part(s), {steps} steps, {duration}s", file=sys.stderr, flush=True)

    return {
        "duration": duration,
        "loop": loop,
        "parts": result_parts,
    }
