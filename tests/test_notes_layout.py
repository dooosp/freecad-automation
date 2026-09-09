"""Pure SVG regressions for preserved notes and annotation associations."""

from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from types import SimpleNamespace
import ast

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from svg_repair import rebuild_notes, repair_text_overlaps
# Execute the real pure renderer definitions, without the stdin/FreeCAD CLI body.
_generator = Path(__file__).resolve().parents[1] / "scripts/generate_drawing.py"
_module = ast.parse(_generator.read_text())
_module.body = _module.body[:next(i for i, node in enumerate(_module.body) if isinstance(node, ast.Try))]
_namespace = {"__file__": str(_generator)}
exec(compile(_module, str(_generator), "exec"), _namespace)
compose_drawing = _namespace["compose_drawing"]


def compose_notes(intent, notes=None):
    svg = compose_drawing({}, "Note test", [], 1,
        SimpleNamespace(XLength=10, YLength=10, ZLength=4), notes_list=notes,
        drawing_intent=intent)
    tree = ET.ElementTree(ET.fromstring(svg))
    group = next(e for e in tree.getroot().iter() if e.get("class") == "general-notes")
    return tree, group


def test_required_note_body_survives_explicit_plan_and_basic_fallback():
    intent = {"required_notes": [
        {"id": "PROCESS", "text": "Process: machining", "required": True},
        {"id": "TRACEABILITY", "text": "Lot traceability label area opposite connector slot."},
        {"id": "EVIDENCE_BOUNDARY", "text": "Generated artifacts are not inspection evidence."},
    ]}
    for notes in [None, ["Keep authored plan note"]]:
        _, group = compose_notes(intent, notes)
        content = " ".join(group.itertext())
        for text in ["Process: machining", "Lot traceability label area opposite connector slot.",
                     "Generated artifacts are not inspection evidence."]:
            assert text in content
        assert ("Keep authored plan note" if notes else "DEBURR ALL EDGES") in content


def test_note_merge_preserves_categories_and_skips_optional_or_id_only_entries():
    notes = ["Process: machining"]
    intent = {"required_notes": [
        {"id":"PROCESS", "text":"  Process: machining  "},
        {"id":"OTHER_PROCESS", "category":"manufacturing", "text":"Keep coolant log."},
        {"id":"OPTIONAL", "text":"Do not add optional text", "optional":True},
        {"id":"NOT_REQUIRED", "text":"Do not add unrequired text", "required":False},
        {"id":"ID_ONLY"}, "Keep the supplied text.",
    ]}
    _, group = compose_notes(intent, notes)
    content = " ".join(group.itertext())
    assert content.count("Process: machining") == 1
    assert "Keep coolant log." in content and "Keep the supplied text." in content
    assert "Do not add" not in content and "ID_ONLY" not in content
    assert notes == ["Process: machining"], "caller-owned plan must not be mutated"


def test_wrapped_required_note_keeps_line_association_after_repair():
    text = "Retain every word of this required manufacturing note " * 20
    tree, group = compose_notes({"required_notes":[{"id":"LONG", "text":text}]}, ["Keep original"])
    assert all(e.get("data-note-index") for e in list(group)[1:])
    before = "".join("".join(group.itertext()).split())
    result = rebuild_notes(tree)
    assert "".join("".join(group.itertext()).split()) == before
    assert all(e.get("data-note-index") for e in list(group)[1:])
    assert result["summary"]["overflow"] is True


def test_extra_required_notes_fit_two_footer_columns_without_shrinking_text():
    tree, group = compose_notes({"required_notes":[
        {"id":f"NOTE_{i}", "text":f"Keep required note {i}."} for i in range(1, 9)
    ]}, ["Keep required note 1."])
    result = rebuild_notes(tree)
    assert result["summary"]["overflow"] is False
    body = list(group)[1:]
    assert {float(e.get("x")) for e in body} == {19, 129}
    assert all(256 <= float(e.get("y")) <= 272 for e in body)
    assert all(float(e.get("font-size", group.get("font-size"))) == 2 for e in body)
    assert len(body) == 8
    from qa_scorer import check_notes_overflow
    assert check_notes_overflow(tree) is False


def test_note_convention_uses_declared_width_for_second_column():
    from qa_scorer import check_note_convention
    tree, group = compose_notes({"required_notes":[{"id":"BOUNDARY",
        "text":"Generated quality and drawing artifacts are not inspection evidence."}]},
        [f"Keep original note {i}." for i in range(5)])
    rebuild_notes(tree)
    assert check_note_convention(tree) == 0
    # Legacy SVGs still use their existing x=200 convention.
    legacy, legacy_group = notes_tree(["NOTES:", "1. Retain note"])
    legacy_group[-1].set("x", "199")
    assert check_note_convention(legacy) > 0


def notes_tree(lines, region=None):
    root = ET.Element("svg", {"viewBox": "0 0 420 297"})
    group = ET.SubElement(root, "g", {"class": "general-notes", "font-size": "2"})
    if region is not None:
        group.attrib.update({f"data-layout-{key}": str(value) for key, value in region.items()})
    for index, line in enumerate(lines):
        text = ET.SubElement(group, "text", {"x": "19", "y": str(248 + index * 4)})
        if index == 0:
            text.attrib.update({"font-weight": "bold", "font-size": "2.5"})
        text.text = line
    return ET.ElementTree(root), group


def text_snapshot(group):
    return [(dict(text.attrib), "".join(text.itertext())) for text in group]


def test_legacy_notes_stay_wholly_below_footer_border():
    lines = ["NOTES:", "1. Material: AL6061", "2. Deburr edges", "3. Keep holes open", "4. Project tolerance", "5. Dimensions in mm"]
    tree, group = notes_tree(lines)
    result = rebuild_notes(tree)
    assert [float(text.get("y")) for text in group] == [252, 256, 260, 264, 268, 272]
    assert all(float(text.get("y")) - float(text.get("font-size", "2")) > 247 for text in group)
    assert [text.text for text in group] == lines
    assert result["summary"]["layout_status"] == "available"
    assert result["summary"]["overflow"] is False


def test_declared_notes_region_controls_placement():
    tree, group = notes_tree(["NOTES:", "1. Use supplied material", "2. Check the drawing"],
                             {"x": 27, "y-min": 190, "y-max": 230, "width": 88})
    result = rebuild_notes(tree)
    assert [float(text.get("x")) for text in group] == [27, 27, 27]
    assert [float(text.get("y")) for text in group] == [190, 194, 198]
    assert result["summary"]["layout_status"] == "available"


def test_long_notes_are_retained_and_overflow_is_reported():
    lines = ["NOTES:"] + [f"{index}. Retain note number {index}" for index in range(1, 21)]
    tree, group = notes_tree(lines, {"x": 19, "y-min": 252, "y-max": 272, "width": 212})
    result = rebuild_notes(tree)
    assert [text.text for text in group] == lines
    assert result["summary"]["lines_rendered"] == len(lines)
    assert result["summary"]["truncated"] is False
    assert result["summary"]["overflow"] is True
    assert result["summary"]["layout_status"] == "unavailable"
    assert any(risk["severity"] == "warning" and "overflow" in risk["code"] for risk in result["risks"])


def test_wrapping_preserves_all_characters_and_is_idempotent():
    lines = ["NOTES:", "1. Keep every word of this long engineering note intact while wrapping.", "2. " + "X" * 90]
    tree, group = notes_tree(lines, {"x": 19, "y-min": 180, "y-max": 272, "width": 38})
    # Text held by a tspan must survive the reflow as well.
    span = ET.SubElement(group[-1], "tspan")
    span.text = " continued"
    original = "".join("".join(group.itertext()).split())
    rebuild_notes(tree)
    first = text_snapshot(group)
    assert "".join("".join(group.itertext()).split()) == original
    assert len(group) > len(lines), "long notes must actually wrap"
    rebuild_notes(tree)
    assert text_snapshot(group) == first
    assert "".join("".join(group.itertext()).split()) == original


def test_malformed_region_does_not_silently_reposition_notes():
    tree, group = notes_tree(["NOTES:", "1. Retain this note"], {"x": 19, "y-min": "nan"})
    before = text_snapshot(group)
    result = rebuild_notes(tree)
    assert text_snapshot(group) == before
    assert result["summary"]["layout_status"] == "unavailable"
    assert any(risk["severity"] == "warning" for risk in result["risks"])


def test_region_too_narrow_for_a_character_reports_overflow_without_dropping_it():
    tree, group = notes_tree(["X"], {"x": 19, "y-min": 252, "y-max": 272, "width": 0.5})
    result = rebuild_notes(tree)
    assert [text.text for text in group] == ["X"]
    assert result["summary"]["overflow"] is True
    assert result["summary"]["layout_status"] == "unavailable"


def test_dimension_labels_do_not_move_away_from_their_leaders():
    tree = ET.ElementTree(ET.fromstring('''<svg viewBox="0 0 420 297">
      <g class="drawing-view drawing-view-top"><g class="dimensions-top">
        <g class="annotation"><line x1="70" y1="60" x2="80" y2="60"/>
          <text x="80" y="60">8</text></g>
        <g class="annotation"><line x1="90" y1="60" x2="80" y2="60"/>
          <text x="80" y="60" data-dim-id="PIN_DIA" data-value-mm="8">8</text></g>
      </g></g></svg>'''))
    before = ET.tostring(tree.getroot())
    result = repair_text_overlaps(tree)
    assert ET.tostring(tree.getroot()) == before
    assert result["summary"]["texts_moved"] == 0
    assert any(risk["code"] == "annotation_overlap_requires_layout" for risk in result["risks"])


def test_dimension_identity_on_group_or_text_class_also_preserves_association():
    for body in [
        '<g data-dim-id="PIN_DIA"><g class="label"><text x="80" y="60">8</text><text x="80" y="60">8</text></g></g>',
        '<text class="dimensions-top" x="80" y="60">8</text><text class="dimensions-top" x="80" y="60">8</text>',
    ]:
        tree = ET.ElementTree(ET.fromstring(f'<svg viewBox="0 0 420 297">{body}</svg>'))
        before = ET.tostring(tree.getroot())
        result = repair_text_overlaps(tree)
        assert ET.tostring(tree.getroot()) == before
        assert result["summary"]["texts_moved"] == 0


def test_deliberately_bound_notes_are_not_nudged_by_text_repair():
    tree, group = notes_tree(["NOTES:", "NOTES:"], {"x": 19, "y-min": 190, "y-max": 230, "width": 212})
    for text in group:
        text.set("y", "200")
    before = text_snapshot(group)
    result = repair_text_overlaps(tree)
    assert text_snapshot(group) == before
    assert result["summary"]["texts_moved"] == 0


def test_unbound_free_text_can_still_be_repaired():
    tree = ET.ElementTree(ET.fromstring('''<svg viewBox="0 0 420 297">
      <text x="80" y="60">Note</text><text x="80" y="60">Note</text></svg>'''))
    result = repair_text_overlaps(tree)
    assert result["summary"]["texts_moved"] > 0
