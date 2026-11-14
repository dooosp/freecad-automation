"""Create the synthetic retrofit STEP files and case JSON through the FreeCAD runner."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _bootstrap import init_freecad, read_input, respond, respond_error


BASE_HOLES = [(22, 22), (123, 22), (22, 76), (123, 76)]
B_HOLES = [(32, 32), (113, 32), (32, 66), (113, 66)]


def hole_hints(points, z):
    return [
        {"id": f"h{index}", "center_mm": [x, y, z], "axis": [0, 0, 1]}
        for index, (x, y) in enumerate(points, 1)
    ]


def candidate(candidate_id, step_file, holes):
    ids = hole_hints(holes, 0)
    result = {
        "id": candidate_id,
        "step_file": step_file,
        "mount_plane": {"z_mm": 0, "normal": [0, 0, -1]},
        "translation_mm": [0, 0, 4],
        "holes": ids,
        "hole_pairs": [
            {"base_hole": hole["id"], "candidate_hole": hole["id"]} for hole in ids
        ],
    }
    if candidate_id != "D":
        result["connector_box"] = {
            "min_mm": [127, 44, 1],
            "max_mm": [141 if candidate_id == "C" else 135, 54, 3],
        }
    if candidate_id == "B":
        result["adapter"] = {
            "bounds": {"min_mm": [12, 12, 4], "max_mm": [133, 86, 10]},
            "translation_mm": [0, 0, 10],
        }
    return result


def make_demo(directory):
    from _shapes import boolean_op, make_shape

    def export(name, origin, size, holes):
        shape = make_shape({
            "type": "box", "position": origin,
            "length": size[0], "width": size[1], "height": size[2],
        })
        for x, y in holes:
            drill = make_shape({
                "type": "cylinder", "position": [x, y, -1], "radius": 2, "height": 6,
            })
            shape = boolean_op("cut", shape, drill)
        if len(shape.Solids) != 1 or not shape.isValid():
            raise RuntimeError(f"Invalid synthetic STEP fixture: {name}")
        shape.Solids[0].exportStep(str(directory / name))

    export("mount_plate.step", [0, 0, 0], [145, 98, 4], BASE_HOLES)
    export("candidate_a.step", [18, 18, 0], [109, 62, 4], BASE_HOLES)
    export("candidate_b.step", [18, 18, 0], [109, 62, 4], B_HOLES)
    case = {
        "case_id": "pcb-mount-retrofit-v01",
        "units": "mm",
        "mount_plate": {
            "step_file": "mount_plate.step",
            "mount_plane": {"z_mm": 4, "normal": [0, 0, 1]},
            "holes": hole_hints(BASE_HOLES, 4),
        },
        "obstacles": [{"id": "fixed_obstacle", "min_mm": [143, 40, 4], "max_mm": [146, 60, 20]}],
        "requirements": {
            "max_hole_offset_mm": 0.20,
            "min_hole_diameter_mm": 3.40,
            "min_connector_clearance_mm": 5,
            "min_adapter_hole_web_mm": 3,
            "min_adapter_edge_web_mm": 3,
        },
        "candidates": [
            candidate("A", "candidate_a.step", BASE_HOLES),
            candidate("B", "candidate_b.step", B_HOLES),
            candidate("C", "candidate_a.step", BASE_HOLES),
            candidate("D", "candidate_a.step", BASE_HOLES),
        ],
    }
    case_path = directory / "case.json"
    case_path.write_text(json.dumps(case, indent=2) + "\n", encoding="utf-8")
    return {"success": True, "case_path": str(case_path)}


try:
    directory = Path(read_input()["output_directory"])
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError("Demo output directory must be empty")
    init_freecad()
    respond(make_demo(directory))
except Exception as error:
    respond_error(error)
