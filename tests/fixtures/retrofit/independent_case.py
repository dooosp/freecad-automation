"""Generate a synthetic holdout fixture from drawing dimensions in mm."""

from copy import deepcopy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from _bootstrap import init_freecad, read_input, respond

root = Path(read_input()["output_directory"])
root.mkdir(parents=True, exist_ok=True)
if any(root.iterdir()):
    raise ValueError("Independent case directory must be empty")
init_freecad()
import Part
from FreeCAD import Vector


def export_plate(name, origin, size, points, diameters):
    plate = Part.makeBox(*size, Vector(*origin))
    for (x, y), diameter in zip(points, diameters, strict=True):
        tool = Part.makeCylinder(diameter / 2, size[2] + 2, Vector(x, y, origin[2] - 1))
        plate = plate.cut(tool)
    assert len(plate.Solids) == 1 and plate.isValid()
    plate.Solids[0].exportStep(str(root / name))


def hints(points, z):
    return [
        {"id": f"h{i}", "center_mm": [x, y, z], "axis": [0, 0, 1]}
        for i, (x, y) in enumerate(points, start=1)
    ]


pattern = [(16, 14), (50, 14), (16, 32), (50, 32)]
second_pattern = [(x + 5, y + 4) for x, y in pattern]
export_plate("frame.step", (0, 0, 0), (80, 56, 3), pattern, [4] * 4)
for name, points, bores in [
    ("piece-61.step", pattern, [4] * 4),
    ("piece-29.step", second_pattern, [4] * 4),
    ("piece-83.step", pattern, [3, 4, 4, 4]),
]:
    export_plate(name, (10, 8, 0), (48, 32, 4), points, bores)
Part.makeCompound([
    Part.read(str(root / "piece-61.step")),
    Part.makeBox(1, 1, 1, Vector(62, 12, 0)),
]).exportStep(str(root / "piece-45.step"))

template = {
    "step_file": "piece-61.step",
    "mount_plane": {"z_mm": 0, "normal": [0, 0, -1]},
    "translation_mm": [0, 0, 3],
    "holes": hints(pattern, 0),
    "hole_pairs": [{"base_hole": f"h{i}", "candidate_hole": f"h{i}"} for i in range(1, 5)],
    "connector_box": {"min_mm": [59, 18, 1], "max_mm": [66, 26, 3]},
}


def candidate(identifier, **fields):
    return {**deepcopy(template), "id": identifier, **fields}


def save(name, value):
    (root / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


case = {
    "case_id": "fixture-27",
    "units": "mm",
    "mount_plate": {
        "step_file": "frame.step", "mount_plane": {"z_mm": 3, "normal": [0, 0, 1]},
        "holes": hints(pattern, 3),
    },
    "obstacles": [{"id": "wall", "min_mm": [72, 17, 0], "max_mm": [75, 27, 16]}],
    "requirements": {
        "max_hole_offset_mm": 0.20, "min_hole_diameter_mm": 3.40, "min_connector_clearance_mm": 5,
        "min_adapter_hole_web_mm": 2, "min_adapter_edge_web_mm": 5,
    },
    "candidates": [],
}
items = case["candidates"]
items.append(candidate("K76"))
for key, offset in [("U11", 0.19), ("M59", 0.20), ("P38", 0.21)]:
    items.append(candidate(key, translation_mm=[offset, 0, 3]))
for key, clearance in [("N72", 4.99), ("V14", 5.00), ("D85", 5.01)]:
    item = candidate(key)
    item["connector_box"]["max_mm"][0] = 72 - clearance
    items.append(item)
items.append(candidate("S43", step_file="piece-83.step"))
swapped = candidate("Q26")
swapped["hole_pairs"][0]["candidate_hole"] = "h2"
swapped["hole_pairs"][1]["candidate_hole"] = "h1"
items.append(swapped)
items.append(candidate("T52", translation_mm=[0, 0, 2]))
items.append(candidate("A37", step_file="piece-29.step", holes=hints(second_pattern, 0), adapter={
    "bounds": {"min_mm": [8, 6, 3], "max_mm": [64, 47, 8]}, "translation_mm": [0, 0, 8],
}))
items.append(candidate("F94"))
del items[-1]["connector_box"]
items.append(candidate("L69", step_file="piece-45.step"))
save("case.json", case)

case["candidates"] = [candidate("J67")]
del case["obstacles"]
case["case_id"] = "fixture-41"
save("obstacles-missing.json", case)
case["case_id"] = "fixture-82"
case["obstacles"] = []
save("obstacles-empty.json", case)
respond({"success": True})
