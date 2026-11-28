"""A positional reference is explicit, bounded, and separate from geometry proof."""
from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from plan_validator import validate_plan


REFERENCE = {'axis': 'Y', 'from': {'feature': 'plate', 'boundary': 'y_min'},
             'to': {'feature': 'slot', 'boundary': 'y_min'}}


def plan(reference):
    return {'schema_version': '0.1', 'part_type': 'generic',
            'views': {'enabled': ['top']}, 'dim_intents': [
                {'id': 'CONNECTOR_SLOT_POSITION', 'feature': 'slot', 'view': 'top',
                 'style': 'linear', 'value_mm': 42, 'reference': reference}]}


def test_explicit_slot_reference_is_known_and_valid():
    result = validate_plan(plan(deepcopy(REFERENCE)))
    assert result['valid']
    assert not any("unknown dim_intent key 'reference'" in warning for warning in result['warnings'])


@pytest.mark.parametrize('reference', [None, [], {}, {**REFERENCE, 'axis': 'X'},
    {**REFERENCE, 'to': {'feature': 'slot', 'boundary': 'center'}},
    {**REFERENCE, 'from': {'feature': 'hole1', 'boundary': 'y_min'}},
    {**REFERENCE, 'extra': 'unknown'}])
def test_unsupported_slot_reference_is_rejected(reference):
    result = validate_plan(plan(reference))
    assert not result['valid']
    assert any('reference' in error for error in result['errors'])


def test_legacy_plan_without_reference_is_still_structurally_valid():
    config = plan(deepcopy(REFERENCE))
    del config['dim_intents'][0]['reference']
    assert validate_plan(config)['valid']  # Runtime binding remains unproven.
