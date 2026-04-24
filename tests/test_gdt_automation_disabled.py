import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from _gdt_automation import auto_assign_gdt, auto_select_datums, render_gdt_frame_svg
from _gdt_symbols import generate_gdt_for_mates, mate_type_to_gdt, render_fcf_svg


class FakeFeatureGraph:
    groups = []

    def by_type(self, _feature_type):
        return [
            type(
                "Feature",
                (),
                {"id": "hole_1", "diameter": 8, "position": (10, 20, 0)},
            )()
        ]


def test_auto_gdt_helpers_are_disabled_noops():
    graph = FakeFeatureGraph()

    assert auto_select_datums(graph, shape_bbox=(100, 80, 10)) == []
    assert auto_assign_gdt(graph, [{"label": "A", "type": "plane"}]) == []


def test_explicit_gdt_rendering_still_works():
    svg, size = render_gdt_frame_svg(
        {
            "symbol": "P",
            "value": "EXPLICIT",
            "modifier": "",
            "datum_refs": ["A"],
        },
        10,
        20,
    )

    assert size == (36, 6)
    assert "EXPLICIT" in svg
    assert ">A<" in svg


def test_mate_gdt_generation_is_disabled_but_explicit_fcf_rendering_works():
    mates = [{"type": "coaxial", "part1": "shaft", "part2": "bore"}]

    assert mate_type_to_gdt("coaxial") is None
    assert generate_gdt_for_mates(mates, {"shaft/bore": "H7/g6"}) == []

    svg = render_fcf_svg("position", tolerance_value="EXPLICIT", datum="A")
    assert "EXPLICIT" in svg
    assert ">A<" in svg
