"""
Cost Estimator for FreeCAD Studio.

Estimates manufacturing cost based on:
- Material cost (bounding box volume x density x unit price)
- Machining cost (complexity x process rate)
- Setup cost (number of operations x setup rate)
- Inspection cost (tolerance pairs x inspection rate)
- Defect rate correction (based on DFM score)
- Batch discounts

Input (JSON via stdin):
{
  "name": "part_name",
  "shapes": [...],
  "operations": [...],
  "tolerance": {...},
  "manufacturing": { "process": "machining", "material": "SS304" },
  "material": "SS304",
  "process": "machining",
  "batch_size": 100,
  "dfm_result": { "score": 72, ... }
}

Output (JSON via stdout):
{
  "success": true,
  "total_cost": 125000,
  "unit_cost": 1250,
  "breakdown": { "material": ..., "machining": ..., "setup": ..., "inspection": ... },
  "batch_curve": [{ "quantity": 1, "unit_cost": ... }, ...],
  "dfm_savings": { "amount": 15000, "percent": 12 },
  "process_comparison": [...]
}
"""

import sys
import json
import math

# Material cost (KRW/kg, 2026 estimates)
MATERIAL_COST = {
    "SS304": 5500, "SUS304": 5500,
    "SS316": 7800, "SUS316": 7800,
    "AL6061": 4200,
    "AL7075": 6500,
    "S45C": 2800,
    "SCM440": 3500,
    "brass": 8000,
    "titanium": 45000,
    "ABS": 3000,
    "PLA": 2500,
}

# Material density (kg/mm^3)
MATERIAL_DENSITY = {
    "SS304": 8.0e-6, "SUS304": 8.0e-6,
    "SS316": 8.0e-6, "SUS316": 8.0e-6,
    "AL6061": 2.7e-6,
    "AL7075": 2.8e-6,
    "S45C": 7.85e-6,
    "SCM440": 7.85e-6,
    "brass": 8.5e-6,
    "titanium": 4.5e-6,
    "ABS": 1.04e-6,
    "PLA": 1.24e-6,
}

# Process rate (KRW/min)
PROCESS_RATE = {
    "machining": 1200,
    "casting": 800,
    "sheet_metal": 600,
    "3d_printing": 2000,
}

# Process complexity coefficient
PROCESS_COEFF = {
    "machining": 1.0,
    "casting": 0.6,
    "sheet_metal": 0.4,
    "3d_printing": 1.5,
}

# Setup cost per operation (KRW)
SETUP_COST_PER_OP = 15000

# Inspection cost per tolerance pair (KRW)
INSPECTION_COST_PER_PAIR = 8000

# Batch discount tiers
BATCH_DISCOUNTS = [
    (1, 0.0),
    (10, 0.05),
    (50, 0.15),
    (100, 0.25),
    (500, 0.35),
]


def respond(data):
    print(json.dumps(data, ensure_ascii=False))
    sys.exit(0)


def respond_error(msg, details=""):
    respond({"success": False, "error": msg, "details": details})


def count_features(config):
    """Count faces, holes, fillets from config shapes/operations."""
    faces = 0
    holes = 0
    fillets = 0

    for shape in config.get("shapes", []):
        stype = shape.get("type", "")
        if stype == "cylinder":
            faces += 3  # top, bottom, side
            if shape.get("inner_radius") or shape.get("inner_diameter"):
                holes += 1
        elif stype == "box":
            faces += 6
        elif stype == "revolution":
            faces += 4
        elif stype == "extrusion":
            faces += 5
        else:
            faces += 4

    for op in config.get("operations", []):
        op_type = op.get("type", "")
        if op_type == "cut":
            holes += 1
            faces += 2
        elif op_type == "fillet" or op_type == "chamfer":
            fillets += 1
        elif op_type == "circular_pattern":
            count = op.get("count", 1)
            holes += count - 1
            faces += count * 2

    return faces, holes, fillets


def estimate_bounding_volume(config):
    """Estimate bounding box volume from shapes (mm^3)."""
    max_dims = [0, 0, 0]

    for shape in config.get("shapes", []):
        stype = shape.get("type", "")
        if stype == "cylinder":
            r = shape.get("radius", shape.get("diameter", 50) / 2)
            h = shape.get("height", 50)
            max_dims[0] = max(max_dims[0], r * 2)
            max_dims[1] = max(max_dims[1], r * 2)
            max_dims[2] = max(max_dims[2], h)
        elif stype == "box":
            max_dims[0] = max(max_dims[0], shape.get("length", 100))
            max_dims[1] = max(max_dims[1], shape.get("width", 50))
            max_dims[2] = max(max_dims[2], shape.get("height", 30))
        elif stype == "revolution":
            profile = shape.get("profile", [])
            if profile:
                max_r = max(p.get("x", 0) for p in profile) if profile else 50
                max_h = max(p.get("y", 0) for p in profile) if profile else 50
                max_dims[0] = max(max_dims[0], max_r * 2)
                max_dims[1] = max(max_dims[1], max_r * 2)
                max_dims[2] = max(max_dims[2], max_h)
        else:
            max_dims[0] = max(max_dims[0], 100)
            max_dims[1] = max(max_dims[1], 100)
            max_dims[2] = max(max_dims[2], 50)

    if all(d == 0 for d in max_dims):
        max_dims = [100, 100, 50]

    return max_dims[0] * max_dims[1] * max_dims[2]


def calculate_complexity(faces, holes, fillets):
    """Calculate manufacturing complexity score."""
    return (faces * 0.3 + holes * 2.0 + fillets * 1.0) / 10.0


def get_batch_discount(quantity, batch_discounts=None):
    """Get batch discount rate for given quantity."""
    if batch_discounts is None:
        batch_discounts = BATCH_DISCOUNTS
    discount = 0.0
    for threshold, rate in batch_discounts:
        if quantity >= threshold:
            discount = rate
    return discount


def estimate_cost(config):
    material_key = config.get("material", config.get("manufacturing", {}).get("material", "SS304"))
    process = config.get("process", config.get("manufacturing", {}).get("process", "machining"))
    batch_size = config.get("batch_size", 1)
    dfm_result = config.get("dfm_result")
    profile = config.get("shop_profile")

    # Material cost - start with defaults, override with profile
    mat_costs = dict(MATERIAL_COST)
    if profile:
        for mat_key, mat_info in profile.get("material_rates", {}).items():
            if mat_info.get("available", True):
                mat_costs[mat_key] = mat_info.get("cost_krw_per_kg", mat_costs.get(mat_key, 5000))

    # Process rates - override with profile if present
    process_rates = dict(PROCESS_RATE)
    setup_cost_per_op = SETUP_COST_PER_OP
    if profile:
        proc_caps = profile.get("process_capabilities", {}).get(process, {})
        if proc_caps.get("rate_krw_per_min"):
            process_rates[process] = proc_caps["rate_krw_per_min"]
        if proc_caps.get("setup_cost_per_op_krw"):
            setup_cost_per_op = proc_caps["setup_cost_per_op_krw"]

    # Inspection cost - override with profile if present
    inspection_cost_per_pair = INSPECTION_COST_PER_PAIR
    if profile:
        insp = profile.get("inspection", {})
        if insp.get("cost_per_tolerance_pair_krw"):
            inspection_cost_per_pair = insp["cost_per_tolerance_pair_krw"]

    # Batch discounts - override with profile if present
    batch_discounts = list(BATCH_DISCOUNTS)
    if profile:
        batch_discount_list = profile.get("batch_discounts", [])
        if batch_discount_list:
            # Convert from list of {min_qty, discount_pct} to tuples
            batch_discounts = [(bd["min_qty"], bd["discount_pct"] / 100.0)
                              for bd in batch_discount_list]

    # Material cost calculation
    volume = estimate_bounding_volume(config)
    density = MATERIAL_DENSITY.get(material_key, 7.85e-6)
    mass_kg = volume * density
    mat_cost_per_kg = mat_costs.get(material_key, 5000)
    material_cost = mass_kg * mat_cost_per_kg

    # Machining cost
    faces, holes, fillets = count_features(config)
    complexity = calculate_complexity(faces, holes, fillets)
    process_rate = process_rates.get(process, 1200)
    process_coeff = PROCESS_COEFF.get(process, 1.0)
    machining_time = complexity * (volume ** 0.33) * process_coeff  # minutes
    machining_cost = machining_time * process_rate

    # Setup cost
    num_ops = len(config.get("operations", [])) + 1  # at least 1
    setup_cost = num_ops * setup_cost_per_op

    # Inspection cost
    tol_pairs = len(config.get("tolerance", {}).get("pairs", []))
    inspection_cost = tol_pairs * inspection_cost_per_pair

    # Defect rate correction
    dfm_score = 100
    if dfm_result and isinstance(dfm_result, dict):
        dfm_score = dfm_result.get("score", dfm_result.get("overall_score", 100))
    defect_factor = max(1.0, 1.0 + (100 - dfm_score) / 200.0)

    # Total per unit
    base_cost = (material_cost + machining_cost + setup_cost + inspection_cost) * defect_factor
    discount = get_batch_discount(batch_size, batch_discounts)
    unit_cost = base_cost * (1 - discount)
    total_cost = unit_cost * batch_size

    # Batch curve
    batch_curve = []
    for qty in [1, 5, 10, 25, 50, 100, 250, 500, 1000]:
        disc = get_batch_discount(qty, batch_discounts)
        uc = base_cost * (1 - disc)
        batch_curve.append({"quantity": qty, "unit_cost": round(uc)})

    # DFM savings estimate
    dfm_savings = None
    if dfm_score < 100:
        perfect_factor = 1.0
        savings = (defect_factor - perfect_factor) * (material_cost + machining_cost + setup_cost + inspection_cost)
        if savings > 0:
            dfm_savings = {
                "amount": round(savings * batch_size),
                "percent": round((savings / base_cost) * 100, 1),
            }

    # Process comparison - use profile rates if available
    process_comparison = []
    for proc in ["machining", "casting", "sheet_metal", "3d_printing"]:
        # Check profile for this process
        p_rate = PROCESS_RATE.get(proc, 1200)
        p_setup = SETUP_COST_PER_OP
        if profile:
            proc_caps = profile.get("process_capabilities", {}).get(proc, {})
            if proc_caps.get("rate_krw_per_min"):
                p_rate = proc_caps["rate_krw_per_min"]
            if proc_caps.get("setup_cost_per_op_krw"):
                p_setup = proc_caps["setup_cost_per_op_krw"]

        p_coeff = PROCESS_COEFF.get(proc, 1.0)
        p_time = complexity * (volume ** 0.33) * p_coeff
        p_machining = p_time * p_rate
        p_setup_cost = num_ops * p_setup
        p_total = (material_cost + p_machining + p_setup_cost + inspection_cost) * defect_factor
        process_comparison.append({
            "process": proc,
            "material": round(material_cost),
            "machining": round(p_machining),
            "setup": round(p_setup_cost),
            "total": round(p_total),
            "current": proc == process,
        })

    return {
        "success": True,
        "total_cost": round(total_cost),
        "unit_cost": round(unit_cost),
        "base_cost": round(base_cost),
        "batch_size": batch_size,
        "discount_rate": discount,
        "breakdown": {
            "material": round(material_cost),
            "machining": round(machining_cost),
            "setup": round(setup_cost),
            "inspection": round(inspection_cost),
        },
        "details": {
            "volume_mm3": round(volume, 1),
            "mass_kg": round(mass_kg, 3),
            "complexity": round(complexity, 2),
            "machining_time_min": round(machining_time, 1),
            "defect_factor": round(defect_factor, 3),
            "faces": faces,
            "holes": holes,
            "fillets": fillets,
        },
        "batch_curve": batch_curve,
        "dfm_savings": dfm_savings,
        "process_comparison": process_comparison,
    }


def main():
    try:
        raw = sys.stdin.read()
        config = json.loads(raw)
    except Exception as e:
        respond_error("Failed to parse input", str(e))

    try:
        result = estimate_cost(config)
        respond(result)
    except Exception as e:
        respond_error("Cost estimation failed", str(e))


if __name__ == "__main__":
    main()
