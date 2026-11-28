"""Drawing deductions use verified measurement identity and per-view baselines."""
from html import escape
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from qa_scorer import check_datum_coherence, check_dim_redundancy, collect_metrics


def tree(*views):
    return ET.ElementTree(ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">' + ''.join(views) + '</svg>'))


def view(name, body):
    return f'<g data-view-id="{name}" id="drawing-view-{name}"><g class="dimensions-{name}">{body}</g></g>'


def linear(identity='d1', feature='plate', model_axis='X', page_axis='u', references=(0, 10),
           x=40, y=70, offset=12, family='feature_reference'):
    value = references[1] - references[0]
    a, b = ((x, y), (x + value, y)) if page_axis == 'u' else ((x, y), (x, y - value))
    key = escape(json.dumps(['final', family, feature, model_axis, *references], separators=(',', ':')), quote=True)
    attrs = (f'data-annotation-id="{identity}" data-measurement-key="{key}" '
             f'data-measurement-kind="linear" data-measurement-family="{family}" data-feature-id="{feature}" '
             f'data-model-object-id="final" data-model-axis="{model_axis}" '
             f'data-model-reference-a="{references[0]}" data-model-reference-b="{references[1]}" '
             f'data-page-axis="{page_axis}" data-scale="1" '
             f'data-dimension-source="plan" data-extension-gap-{"y" if page_axis == "u" else "x"}="2" '
             f'data-reference-a-x="{a[0]}" data-reference-a-y="{a[1]}" '
             f'data-reference-b-x="{b[0]}" data-reference-b-y="{b[1]}"')
    if page_axis == 'u':
        lines = [
            ('extension-a', a[0], y + 2, a[0], y + offset + 1.5),
            ('extension-b', b[0], y + 2, b[0], y + offset + 1.5),
            ('dimension-line', a[0], y + offset, b[0], y + offset),
        ]
    else:
        lines = [
            ('extension-a', x + 2, a[1], x - offset - 1.5, a[1]),
            ('extension-b', x + 2, b[1], x - offset - 1.5, b[1]),
            ('dimension-line', x - offset, b[1], x - offset, a[1]),
        ]
    rendered = ''.join(f'<line data-annotation-id="{identity}" data-annotation-role="{role}" data-gap-{"y" if page_axis == "u" else "x"}="2" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>'
                       for role, x1, y1, x2, y2 in lines)
    return rendered + f'<text {attrs} data-annotation-role="label" x="{x}" y="{y - 1}">{value}</text>'


def legacy_lines(xs, y=50):
    return ''.join(f'<line x1="{x}" y1="{y}" x2="{x}" y2="{y + 12}"/>' for x in xs)


def test_legacy_baselines_are_clustered_per_actual_view():
    svg = tree(view('top', legacy_lines([20, 40])), view('front', legacy_lines([100, 120], 180)))
    assert check_datum_coherence(svg) is False


def test_complete_independent_feature_dimensions_are_not_mistaken_for_datums():
    body = ''.join(linear(f'd{i}', feature=f'feature{i}', x=30 + i * 25) for i in range(4))
    assert check_datum_coherence(tree(view('top', body))) is False


def test_verified_annotation_does_not_exempt_unrelated_legacy_lines():
    svg = tree(view('top', linear() + legacy_lines([110, 130, 150, 170])))
    assert check_datum_coherence(svg) is True


@pytest.mark.parametrize('corrupt', ['missing_extension', 'duplicate_shaft', 'nonfinite_reference', 'changed_target', 'changed_gap_origin', 'wrong_axis'])
def test_corrupt_typed_reference_is_explicitly_incoherent(corrupt):
    svg = tree(view('top', linear()))
    group = next(e for e in svg.iter() if e.get('class') == 'dimensions-top')
    label = next(e for e in group if e.tag.endswith('text'))
    shaft = next(e for e in group if e.get('data-annotation-role') == 'dimension-line')
    if corrupt == 'missing_extension':
        group.remove(next(e for e in group if e.get('data-annotation-role') == 'extension-a'))
    elif corrupt == 'duplicate_shaft':
        group.append(ET.fromstring(ET.tostring(shaft)))
    elif corrupt == 'nonfinite_reference':
        label.set('data-reference-a-x', 'NaN')
    elif corrupt == 'changed_target':
        next(e for e in group if e.get('data-annotation-role') == 'extension-a').set('x1', '50')
    elif corrupt == 'changed_gap_origin':
        next(e for e in group if e.get('data-annotation-role') == 'extension-a').set('y1', '69')
    else:
        label.set('data-model-axis', 'Z')
    assert check_datum_coherence(svg) is True


def test_equal_slot_width_and_standoff_height_are_distinct_measurements():
    svg = tree(view('top', linear('slot_width', 'slot', 'Y', 'v', (42, 52), y=80)),
               view('front', linear('stand_height', 'standoff1,standoff2,standoff3,standoff4', 'Z', 'v', (4, 14), y=180)))
    assert check_dim_redundancy(svg) == 0


def test_same_feature_different_reference_pair_is_not_redundant():
    svg = tree(view('top', linear('slot_width', 'slot', 'Y', 'v', (42, 52), y=80)
                    + linear('slot_offset', 'slot', 'Y', 'v', (0, 10), x=90, y=80)))
    assert check_dim_redundancy(svg) == 0


def test_duplicate_typed_measurement_in_same_view_is_counted():
    svg = tree(view('top', linear('first') + linear('duplicate', offset=24)))
    assert check_dim_redundancy(svg) == 1


def test_exact_copy_with_same_annotation_id_still_counts_as_duplicate():
    svg = tree(view('top', linear('same_id') + linear('same_id')))
    assert check_datum_coherence(svg) is True, 'the duplicate ID cannot establish a unique reference'
    assert check_dim_redundancy(svg) == 1, 'an exact same-view copy must not disappear into legacy sets'


def test_changed_actual_datum_marker_is_incoherent():
    svg = tree('<g data-datum-name="A" data-reference-x="20" data-reference-y="30">'
               '<line data-datum-leader="true" x1="20" y1="30" x2="20" y2="40"/>'
               '<polygon data-datum-marker="true" points="22,30 23,32 21,32"/></g>')
    assert check_datum_coherence(svg) is True


def test_one_body_axis_repeated_in_two_views_is_redundant():
    svg = tree(view('top', linear('top_extent', 'final', 'X', 'u', (0, 10), family='body_extent')),
               view('front', linear('front_extent', 'final', 'X', 'u', (0, 10), y=180, family='body_extent')))
    assert check_dim_redundancy(svg) == 1


def test_incomplete_metadata_does_not_suppress_legacy_redundancy():
    svg = tree(view('top', '<text x="50" y="70" data-annotation-id="broken" data-measurement-key="fake">10</text>'),
               view('front', '<text x="50" y="180">10</text>'))
    assert check_datum_coherence(svg) is True
    assert check_dim_redundancy(svg) == 1


def test_legacy_numeric_style_and_tolerance_contract_is_preserved():
    assert check_dim_redundancy(tree(view('top', '<text x="50" y="70">10</text>'),
                                    view('front', '<text x="50" y="180">10</text>'))) == 1
    assert check_dim_redundancy(tree(view('top', '<text x="50" y="70">10 ±0.1</text>'),
                                    view('front', '<text x="50" y="180">10 ±0.2</text>'))) == 0


def test_diagnostics_show_annotation_scoping_and_remaining_baselines():
    metrics = collect_metrics(tree(view('top', linear() + legacy_lines([100, 120]))))
    details = metrics['_details']
    assert details['datum_coherence']['verified_annotations'] == 1
    assert details['datum_coherence']['excluded_line_count'] == 3
    assert details['datum_coherence']['legacy_line_count'] == 2
    assert details['dim_redundancy']['verified_annotation_count'] == 1
