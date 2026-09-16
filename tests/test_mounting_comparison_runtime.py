"""Compare an independent reference pattern with live FreeCAD hole measurements."""

import json

from test_plate_runtime_traceability import draw, drawing_dir, reference_plate


def reference():
    return {
        'source': {'kind': 'manufacturer_reference', 'product_id': 'Reference hub',
                   'evidence_ref': 'manufacturer-drawing.pdf'},
        'units': 'mm', 'coordinate_frame': 'model_xy',
        'coordinate_basis': 'Lower-left plate origin', 'center_tolerance_mm': 0.1,
        'holes': [
            {'id': 'H1', 'target_feature_id': 'hole_H1', 'center_mm': [29, 24.4]},
            {'id': 'H2', 'target_feature_id': 'hole_H2', 'center_mm': [29, 49.6]},
            {'id': 'H3', 'target_feature_id': 'hole_H3', 'center_mm': [113, 24.4]},
            {'id': 'H4', 'target_feature_id': 'hole_H4', 'center_mm': [113, 49.6]},
        ],
    }


def comparison(directory, config):
    path = directory / 'output' / f"{config['name']}_mounting_comparison.json"
    assert path.is_file(), 'requested comparison must be emitted by the real draw pipeline'
    return json.loads(path.read_text())


def test_reference_compares_live_centers_and_registers_artifacts(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    _, quality = draw(drawing_dir, config, strict=True)
    report = comparison(drawing_dir, config)
    assert report['status'] == 'pass'
    assert [r['measured_center_mm'] for r in report['rows']] == [[29, 24.4], [29, 49.6], [113, 24.4], [113, 49.6]]
    assert len({r['face_ref'] for r in report['rows']}) == 4
    assert report['summary']['max_deviation_mm'] == 0
    assert report['physical_fit_result'] == 'not_tested'
    assert quality['status'] == 'pass'
    output = drawing_dir / 'output'
    html_path = output / f"{config['name']}_mounting_comparison.html"
    assert html_path.is_file()
    manifest = json.loads((output / f"{config['name']}_drawing_artifact-manifest.json").read_text())
    assert any(a['path'].endswith('_mounting_comparison.json') for a in manifest['artifacts'])
    assert any(a['path'].endswith('_mounting_comparison.html') for a in manifest['artifacts'])
    output_manifest = json.loads((output / f"{config['name']}_drawing_manifest.json").read_text())
    comparisons = [a for a in output_manifest['outputs'] if 'mounting-comparison' in a['kind']]
    assert len(comparisons) == 2
    assert all(a['exists'] and len(a['sha256']) == 64 for a in comparisons)
    run_log = json.loads((output / f"{config['name']}_run_log.json").read_text())
    assert run_log['artifacts']['mounting_comparison'].endswith('_mounting_comparison.json')


def test_shifted_center_fails_comparison_without_changing_drawing_gate(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    next(s for s in config['shapes'] if s['id'] == 'hole_H4')['position'][0] = 113.5
    draw(drawing_dir, config, strict=True)
    report = comparison(drawing_dir, config)
    assert report['status'] == 'fail'
    assert report['rows'][3]['measured_center_mm'] == [113.5, 49.6]
    assert report['rows'][3]['delta_mm'] == [0.5, 0]
    assert report['rows'][3]['distance_mm'] == 0.5


def test_missing_mapped_feature_is_not_matched_by_equal_diameter(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    config['mounting_reference']['holes'][3]['target_feature_id'] = 'absent_H4'
    draw(drawing_dir, config)
    report = comparison(drawing_dir, config)
    assert report['status'] == 'fail'
    assert report['rows'][3]['reason_codes'] == ['missing_feature']
    assert report['rows'][3]['face_ref'] is None


def test_removed_model_hole_is_reported_missing(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    config['shapes'] = [s for s in config['shapes'] if s['id'] != 'hole_H4']
    config['operations'] = [op for op in config['operations'] if op['tool'] != 'hole_H4']
    next(op for op in config['operations'] if op['base'] == 'cut_4')['base'] = 'cut_3'
    draw(drawing_dir, config)
    report = comparison(drawing_dir, config)
    assert report['status'] == 'fail'
    assert report['rows'][3]['reason_codes'] == ['missing_feature']
    assert report['rows'][3]['distance_mm'] is None


def test_unsupported_frame_remains_unknown_and_absent_input_does_not_publish_stale_results(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    config['mounting_reference']['coordinate_frame'] = 'vendor_xyz'
    draw(drawing_dir, config)
    assert comparison(drawing_dir, config)['status'] == 'unknown'
    del config['mounting_reference']
    draw(drawing_dir, config)
    output = drawing_dir / 'output'
    manifest = json.loads((output / f"{config['name']}_drawing_artifact-manifest.json").read_text())
    assert not any('mounting_comparison' in a['path'] for a in manifest['artifacts'])
    output_manifest = json.loads((output / f"{config['name']}_drawing_manifest.json").read_text())
    assert not any('mounting_comparison' in a['path'] for a in output_manifest['outputs'])
    run_log = json.loads((output / f"{config['name']}_run_log.json").read_text())
    assert 'mounting_comparison' not in run_log['artifacts']


def test_unmeasured_hole_never_uses_configured_center_as_evidence(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    next(s for s in config['shapes'] if s['id'] == 'hole_H4')['position'][0] = 142
    draw(drawing_dir, config)
    report = comparison(drawing_dir, config)
    assert report['status'] == 'unknown'
    assert all(r['measured_center_mm'] is None for r in report['rows'])


def test_strict_drawing_failure_keeps_emitted_comparison_in_output_manifest(drawing_dir):
    config = reference_plate()
    config['mounting_reference'] = reference()
    config['drawing_plan']['dim_intents'][1]['value_mm'] = 5.6
    _, quality = draw(drawing_dir, config, strict=True, expected_code=1)
    assert quality['status'] == 'fail'
    assert comparison(drawing_dir, config)['status'] == 'pass'
    manifest_path = drawing_dir / 'output' / f"{config['name']}_drawing_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    outputs = [a for a in manifest['outputs'] if 'mounting-comparison' in a['kind']]
    assert len(outputs) == 2, 'failure manifests must preserve emitted comparison files and hashes'
    assert all(a['exists'] and len(a['sha256']) == 64 for a in outputs)
