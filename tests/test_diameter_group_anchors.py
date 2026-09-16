"""Explicit hole groups must choose and deduplicate their own annotations."""

from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from _dim_plan import render_plan_dimensions_svg


def render_group(*, centers=None, auto=None, policy='smart', circles=None, grouped=True, view='top'):
    intent = {'id': 'PANEL_HOLE_DIA', 'feature': 'mounting_hole_diameter',
              'view': view, 'style': 'diameter', 'value_mm': 5.5, 'required': True}
    if grouped:
        intent['member_feature_ids'] = ['hole_P4']
    telemetry = {}
    svg, _, _ = render_plan_dimensions_svg(
        [intent], view, (0, 0, 142, 74),
        circles if circles is not None else [[12, 12, 2.75], [130, 62, 2.75]],
        [], 100, 100, 1, 0, 0,
        existing_auto_dims=auto, existing_dim_values=[5.5], dedupe_policy=policy,
        diameter_group_centers=centers, telemetry=telemetry,
    )
    return svg, telemetry['plan_dimensions'][0]


def diameter_annotation(center, identifier='outside'):
    return {'dim_id': identifier, 'source': 'auto', 'view': 'top',
            'category': 'hole_diameter', 'value_mm': 5.5, 'status': 'rendered',
            'rendered': True, 'svg_element_id': identifier, 'center_uv': center}


@pytest.mark.parametrize('policy', ['smart', 'value_only', 'off'])
def test_external_same_diameter_cannot_suppress_group_label(policy):
    svg, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]},
                               auto=[diameter_annotation([12, 12])], policy=policy)
    assert record['status'] == 'rendered'
    assert record['center_uv'] == [130, 62]
    text = ET.fromstring(svg).find('text')
    assert text.attrib['id'] == record['svg_element_id']
    assert [float(text.attrib['data-center-u']), float(text.attrib['data-center-v'])] == [130, 62]


@pytest.mark.parametrize('centers', [None, {}, {'PANEL_HOLE_DIA': []}])
def test_explicit_group_without_measured_centers_does_not_fall_back(centers):
    svg, record = render_group(centers=centers, auto=[diameter_annotation([12, 12])])
    assert svg == ''
    assert not record['rendered']
    assert record['status'] != 'skipped_duplicate'


def test_numeric_only_legacy_dedupe_is_disabled_for_groups():
    _, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]})
    assert record['status'] == 'rendered'
    assert record['center_uv'] == [130, 62]


def test_in_group_auto_annotation_is_the_only_dedupe_candidate():
    svg, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]}, auto=[
        diameter_annotation([12, 12]), diameter_annotation([130, 62], 'inside')])
    assert svg == ''
    assert record['dedupe_match']['auto_dim_id'] == 'inside'


def test_wrong_projected_radius_cannot_represent_verified_group():
    svg, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]},
                               circles=[[130, 62, 2]], auto=[diameter_annotation([130, 62])])
    assert svg == ''
    assert not record['rendered']
    assert record['status'] != 'skipped_duplicate'


def test_non_diameter_auto_record_cannot_suppress_group_even_with_value_only_policy():
    auto = diameter_annotation([130, 62])
    auto['category'] = 'chain_horizontal'
    _, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]},
                             auto=[auto], policy='value_only')
    assert record['status'] == 'rendered'


def test_unscoped_intent_preserves_legacy_numeric_dedupe():
    svg, record = render_group(grouped=False)
    assert svg == ''
    assert record['status'] == 'skipped_duplicate'
    assert record['dedupe_match']['source'] == 'legacy_values'


def test_top_plane_centers_do_not_authorize_a_different_projection():
    svg, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]}, view='front')
    assert svg == ''
    assert not record['rendered']
    assert record['status'] != 'skipped_duplicate'


def test_nearby_auto_value_does_not_suppress_exact_group_value():
    auto = diameter_annotation([130, 62])
    auto['value_mm'] = 5.4
    _, record = render_group(centers={'PANEL_HOLE_DIA': [[130, 62]]}, auto=[auto])
    assert record['status'] == 'rendered'
