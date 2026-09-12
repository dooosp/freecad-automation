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

from qa_scorer import (collect_metrics, extract_issue_signals,
                       check_required_presence, check_value_consistency)  # noqa: E402


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


@pytest.mark.parametrize("auto_first", [False, True])
@pytest.mark.parametrize("actual, presence, inconsistent", [(95, 100, 0), (92, 0, 1)])
def test_mixed_auto_and_planned_dimensions_are_order_independent(auto_first, actual, presence, inconsistent):
    # Match generated SVG semantics: planned metadata precedes auto_top_003 in another view.
    planned = '<g class="dimensions-front plan-dimensions-front"><text data-dim-id="HEIGHT" data-value-mm="38">38</text></g>'
    automatic = f'<g class="dimensions-top"><g><text id="auto_top_003">{actual}</text></g></g>'
    plan = {"dim_intents": [{"id": "BASE_W", "value_mm": 95, "required": True}]}
    tree = _svg_tree(*( [automatic, planned] if auto_first else [planned, automatic] ))
    assert check_required_presence(tree, plan) == (presence, 1, [] if presence else ["BASE_W"])
    assert check_value_consistency(tree, plan) == inconsistent


@pytest.mark.parametrize("with_metadata", [False, True])
def test_required_dimension_does_not_match_numeric_titles_notes_or_unrelated_text(with_metadata):
    elements = [
        '<text>95</text>', '<g class="title-block"><text>95</text></g>',
        '<g class="general-notes"><text>95 pieces</text></g>',
        '<g class="dimensions-top"><title>95</title><desc>95</desc><text>92</text></g>',
    ]
    if with_metadata:
        elements.append('<g class="dimensions-front"><text data-dim-id="HEIGHT" data-value-mm="38">38</text></g>')
    tree = _svg_tree(*elements)
    plan = {"dim_intents": [{"id": "BASE_W", "value_mm": 95, "required": True}]}
    assert check_required_presence(tree, plan) == (0, 1, ["BASE_W"])
    assert check_value_consistency(tree, plan) == 1


def test_dimension_metadata_is_preferred_per_element_not_for_the_whole_svg():
    tree = _svg_tree('<g class="dimensions-top"><text data-dim-id="BASE_W" data-value-mm="92">95</text></g>')
    plan = {"dim_intents": [{"id": "BASE_W", "value_mm": 95, "required": True}]}
    assert check_required_presence(tree, plan) == (0, 1, ["BASE_W"])
    assert check_value_consistency(tree, plan) == 1


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
