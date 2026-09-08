#!/usr/bin/env python3
"""QA signal quality gate for scorer regressions.

This suite uses compact synthetic SVG cases to verify that high-value QA
signals keep high precision/recall as rules evolve.
"""

import os
import sys
import xml.etree.ElementTree as ET
import pytest


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))

from qa_scorer import collect_metrics, extract_issue_signals, _extract_dim_entries, check_required_presence, check_notes_overflow  # noqa: E402
import svg_common  # noqa: E402


SVG_NS = "http://www.w3.org/2000/svg"
SIGNALS = [
    "notes_overflow",
    "datum_incoherent",
    "view_coverage_missing",
    "required_presence_missing",
    "note_semantic_mismatch",
    "virtual_pcd_missing",
]


def _svg_tree(*elements):
    body = "\n".join(elements)
    raw = (
        f'<svg xmlns="{SVG_NS}" width="420" height="297" viewBox="0 0 420 297">'
        f"{body}"
        "</svg>"
    )
    return ET.ElementTree(ET.fromstring(raw))


def _plan(required_view="front", required_value=10):
    return {
        "dim_intents": [
            {
                "id": "LENGTH",
                "required": True,
                "view": required_view,
                "style": "linear",
                "value_mm": required_value,
            },
            {
                "id": "BOLT_COUNT",
                "required": False,
                "view": "notes",
                "style": "note",
                "value_mm": 6,
            },
            {
                "id": "BOLT_DIA",
                "required": False,
                "view": "notes",
                "style": "diameter",
                "value_mm": 10,
            },
            {
                "id": "PCD",
                "required": True,
                "view": "front",
                "style": "diameter",
            },
        ]
    }


def _elements(
    note_text="6x Ø10 THRU",
    note_y=230,
    include_front_dim=True,
    include_pcd=True,
    include_incoherent_datums=False,
):
    parts = []
    if include_front_dim:
        parts.append('<g class="dimensions-front"><text x="40" y="160">10</text></g>')
    parts.append(
        f'<g class="general-notes"><text x="20" y="{note_y}">{note_text}</text></g>'
    )
    if include_pcd:
        parts.append('<g class="virtual-pcd"><circle cx="260" cy="80" r="20"/></g>')
    if include_incoherent_datums:
        parts.extend([
            '<line class="dimensions-front" x1="15" y1="150" x2="15" y2="165"/>',
            '<line class="dimensions-front" x1="30" y1="150" x2="30" y2="165"/>',
            '<line class="dimensions-front" x1="45" y1="150" x2="45" y2="165"/>',
            '<line class="dimensions-front" x1="60" y1="150" x2="60" y2="165"/>',
        ])
    return parts


CASES = [
    {
        "name": "clean_reference",
        "plan": _plan(),
        "elements": _elements(),
        "expected": {
            "notes_overflow": False,
            "datum_incoherent": False,
            "view_coverage_missing": False,
            "required_presence_missing": False,
            "note_semantic_mismatch": False,
            "virtual_pcd_missing": False,
        },
    },
    {
        "name": "notes_overflow_issue",
        "plan": _plan(),
        "elements": _elements(note_y=280),
        "expected": {
            "notes_overflow": True,
            "datum_incoherent": False,
            "view_coverage_missing": False,
            "required_presence_missing": False,
            "note_semantic_mismatch": False,
            "virtual_pcd_missing": False,
        },
    },
    {
        "name": "datum_incoherence_issue",
        "plan": _plan(),
        "elements": _elements(include_incoherent_datums=True),
        "expected": {
            "notes_overflow": False,
            "datum_incoherent": True,
            "view_coverage_missing": False,
            "required_presence_missing": False,
            "note_semantic_mismatch": False,
            "virtual_pcd_missing": False,
        },
    },
    {
        "name": "coverage_and_presence_issue",
        "plan": _plan(required_view="top", required_value=25),
        "elements": _elements(),
        "expected": {
            "notes_overflow": False,
            "datum_incoherent": False,
            "view_coverage_missing": True,
            "required_presence_missing": True,
            "note_semantic_mismatch": False,
            "virtual_pcd_missing": False,
        },
    },
    {
        "name": "note_semantic_issue",
        "plan": _plan(),
        "elements": _elements(note_text="8x Ø12 THRU"),
        "expected": {
            "notes_overflow": False,
            "datum_incoherent": False,
            "view_coverage_missing": False,
            "required_presence_missing": False,
            "note_semantic_mismatch": True,
            "virtual_pcd_missing": False,
        },
    },
    {
        "name": "virtual_pcd_missing_issue",
        "plan": _plan(),
        "elements": _elements(include_pcd=False),
        "expected": {
            "notes_overflow": False,
            "datum_incoherent": False,
            "view_coverage_missing": False,
            "required_presence_missing": False,
            "note_semantic_mismatch": False,
            "virtual_pcd_missing": True,
        },
    },
]


def _evaluate_cases():
    evaluated = []
    for case in CASES:
        tree = _svg_tree(*case["elements"])
        metrics = collect_metrics(tree, case["plan"])
        predicted = extract_issue_signals(metrics)
        evaluated.append({
            "name": case["name"],
            "expected": case["expected"],
            "predicted": predicted,
        })
    return evaluated


def _binary_stats(rows, signal):
    tp = fp = tn = fn = 0
    for row in rows:
        expected = row["expected"].get(signal)
        predicted = row["predicted"].get(signal)
        if expected is None or predicted is None:
            continue
        if predicted and expected:
            tp += 1
        elif predicted and not expected:
            fp += 1
        elif not predicted and expected:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn, "precision": precision, "recall": recall}


def test_signal_cases_match_expected_labels():
    rows = _evaluate_cases()
    for row in rows:
        for signal in SIGNALS:
            assert row["predicted"][signal] == row["expected"][signal], (
                f"{row['name']} {signal}: expected={row['expected'][signal]} "
                f"predicted={row['predicted'][signal]}"
            )


def test_signal_precision_recall_quality_gate():
    rows = _evaluate_cases()

    macro_precision = 0.0
    macro_recall = 0.0

    for signal in SIGNALS:
        stats = _binary_stats(rows, signal)
        macro_precision += stats["precision"]
        macro_recall += stats["recall"]
        assert stats["precision"] >= 0.95, f"{signal} precision too low: {stats}"
        assert stats["recall"] >= 0.95, f"{signal} recall too low: {stats}"

    macro_precision /= len(SIGNALS)
    macro_recall /= len(SIGNALS)
    assert macro_precision >= 0.97, f"macro precision too low: {macro_precision:.3f}"
    assert macro_recall >= 0.97, f"macro recall too low: {macro_recall:.3f}"


def _page_entries(tree):
    assert hasattr(svg_common, "iter_svg_elements"), "page-space SVG traversal required"
    return {elem.get("id"): (classes, bbox)
            for elem, classes, bbox in svg_common.iter_svg_elements(tree.getroot())}


def _annotation_layout(*elements):
    metrics = collect_metrics(_svg_tree(
        '<rect class="sheet-frame" x="15" y="15" width="390" height="267"/>',
        *elements))
    report = metrics["_details"].get("annotation_layout")
    assert report is not None, "final SVG annotation evidence required"
    return metrics, report


def test_page_boxes_apply_nested_rotation_and_inherited_text_style():
    entries = _page_entries(_svg_tree(
        '<g class="drawing-view" transform="translate(20 30)">'
        '<g class="dimensions-front" font-size="4" text-anchor="middle" transform="rotate(90)">'
        '<text id="rotated" x="0" y="0">10</text></g></g>'))
    classes, bbox = entries["rotated"]
    assert {"drawing-view", "dimensions-front"}.issubset(classes)
    assert (bbox.x, bbox.y, bbox.w, bbox.h) == pytest.approx((19.2, 27.8, 4.8, 4.4))


def test_page_boxes_reject_unsupported_context_instead_of_local_coordinates():
    entries = _page_entries(_svg_tree(
        '<g transform="skewX(20)"><text id="skewed" x="30" y="40">10</text></g>',
        '<g transform="translate(NaN 4)"><line id="nonfinite" x1="0" y1="0" x2="3" y2="4"/></g>'))
    assert entries["skewed"][1] is None
    assert entries["nonfinite"][1] is None


def test_nested_annotation_line_collision_has_page_evidence_without_geometry_overflow():
    metrics, report = _annotation_layout(
        '<g class="drawing-view" data-view-id="front" transform="translate(10 10)">'
        '<g class="dimensions-front" font-size="4">'
        '<text id="label" x="30" y="40">8</text>'
        '<line id="leader" x1="25" y1="38" x2="45" y2="38"/>'
        '</g></g>')
    matches = [f for f in report["findings"] if f["type"] == "text_line_overlap"]
    assert len(matches) == 1
    assert matches[0]["element_ids"] == ["label", "leader"]
    assert matches[0]["view"] == "front"
    assert matches[0]["bounding_boxes"][0]["x"] == 40
    assert metrics["overflow_count"] == 0


def test_final_annotation_extents_respect_explicit_frame_and_notes_region():
    _, report = _annotation_layout(
        '<g class="dimensions-top"><text id="outside" x="14" y="30">8</text></g>',
        '<g class="general-notes" data-region-bounds="19 249 212 25">'
        '<text id="note" x="20" y="247">Required note</text></g>')
    assert any(f["type"] == "annotation_frame_overflow" and "outside" in f["element_ids"] for f in report["findings"])
    assert any(f["type"] == "notes_region_overflow" and "note" in f["element_ids"] for f in report["findings"])


def test_annotation_layout_unknown_transform_is_explicit_and_clean_case_is_bounded():
    _, report = _annotation_layout(
        '<g class="dimensions-top" transform="skewY(10)"><text id="unknown" x="40" y="40">8</text></g>')
    assert report["status"] in {"partial", "unsupported"}
    assert report["unsupported_elements"][0]["element_id"] == "unknown"
    _, clean = _annotation_layout(
        '<g class="dimensions-top"><text id="clear" x="40" y="40">8</text>'
        '<line x1="35" y1="45" x2="50" y2="45"/></g>')
    assert clean["status"] == "complete"
    assert clean["findings"] == []


def test_nested_geometry_overflow_and_inherited_text_overlap_are_observed():
    metrics = collect_metrics(_svg_tree(
        '<g class="drawing-view" data-view-id="top"><g class="hard_visible">'
        '<path d="M 10 40 L 40 40 L 40 60 L 10 60 Z"/></g>'
        '<g class="dimensions-top" font-size="6"><text x="60" y="60">100</text>'
        '<text x="64" y="60">200</text></g></g>'))
    assert metrics["overflow_count"] == 1
    assert metrics["text_overlap_pairs"] == 1


@pytest.mark.parametrize("attributes", ['class="review-marker"', 'data-review-dim-id="SLOT_42"'])
def test_review_marker_numeric_ids_never_satisfy_required_dimensions(attributes):
    tree = _svg_tree(f'<text x="40" y="160" {attributes}>[REVIEW: SLOT_42]</text>')
    assert _extract_dim_entries(tree) == {}
    assert check_required_presence(tree, _plan(required_value=42)) == (0, 1, ["LENGTH"])


def test_notes_layout_overflow_hint_is_retained_as_advisory_evidence():
    metrics, report = _annotation_layout(
        '<g class="general-notes" data-region-bounds="19 249 212 25" data-layout-overflow="true">'
        '<text id="retained-note" x="20" y="254">Required text</text></g>')
    assert any(f["type"] == "notes_region_overflow" for f in report["findings"])
    assert metrics["overflow_count"] == 0


def test_stylesheet_transform_and_unclassified_curves_do_not_claim_complete():
    _, styled = _annotation_layout(
        '<style>.dimensions-top { transform: translate(0, 500px); }</style>',
        '<g class="dimensions-top"><text id="styled" x="40" y="40">8</text></g>')
    assert styled["status"] == "unsupported"
    assert any("stylesheet" in item["reason"] for item in styled["unsupported_elements"])
    _, curved = _annotation_layout(
        '<g class="dimensions-top"><text id="clear" x="40" y="40">8</text></g>',
        '<path id="curve" d="M 10 20 C 30 40 50 60 70 80"/>')
    assert curved["status"] == "partial"
    assert any(item["element_id"] == "curve" for item in curved["unsupported_elements"])


def test_notes_overflow_uses_declared_region_and_preserves_unknown_and_legacy_fallback():
    assert check_notes_overflow(_svg_tree(
        '<g class="general-notes" data-region-bounds="19 249 212 25">'
        '<text x="19" y="272" font-size="2">All dimensions in mm</text></g>')) is False
    assert check_notes_overflow(_svg_tree(
        '<g class="general-notes" data-region-bounds="19 249 10 25">'
        '<text x="19" y="260" font-size="2">Too wide for region</text></g>')) is True
    assert check_notes_overflow(_svg_tree(
        '<g class="general-notes" data-region-bounds="unknown">'
        '<text x="19" y="260">Cannot measure region</text></g>')) is None
    assert check_notes_overflow(_svg_tree(
        '<g class="general-notes"><text x="19" y="272">Legacy notes</text></g>')) is True


def test_rotated_regions_and_unsupported_other_text_cannot_establish_clear_layout():
    _, region = _annotation_layout(
        '<g class="general-notes" transform="rotate(45 40 40)" data-region-bounds="30 30 20 20">'
        '<text id="rotated-note" x="35" y="40">Note</text></g>')
    assert region["status"] == "unsupported"
    _, frame = _annotation_layout(
        '<rect class="sheet-frame" x="20" y="20" width="60" height="60" transform="rotate(45 50 50)"/>',
        '<g class="dimensions-top"><text x="25" y="25">8</text></g>')
    assert frame["status"] == "partial"
    _, other = _annotation_layout(
        '<g class="dimensions-top"><text x="40" y="40">8</text></g>',
        '<text id="other" x="40" y="40" transform="skewX(5)">Title</text>')
    assert other["status"] == "partial"


@pytest.mark.parametrize("class_name", ["radius-dimension", "baseline-dimensions"])
def test_annotation_cell_overflow_hint_is_advisory_and_preserves_notes_category(class_name):
    metrics, report = _annotation_layout(
        f'<g class="{class_name}" data-view-id="top" data-layout-overflow="true">'
        '<text id="retained-dimension" x="40" y="40">R5</text></g>',
        '<g class="general-notes" data-region-bounds="19 249 212 25" data-layout-overflow="true">'
        '<text id="retained-note" x="20" y="254">Required note</text></g>')
    cell = [finding for finding in report["findings"] if finding["type"] == "annotation_cell_overflow"]
    assert len(cell) == 1
    assert cell[0]["element_ids"] == ["retained-dimension"]
    assert cell[0]["view"] == "top"
    assert cell[0]["bounding_boxes"][0]["x"] == 40
    assert any(finding["type"] == "notes_region_overflow" for finding in report["findings"])
    assert metrics["overflow_count"] == 0
