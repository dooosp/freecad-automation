"""Real FreeCAD runtime checks; opt in with FCAD_MVS_RUNTIME=1."""
import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('FCAD_MVS_RUNTIME') != '1',
                                reason='requires real FreeCAD and G0 R1 artifacts')


def export(out):
    return subprocess.run([
        'node', 'scripts/export-mvs-reference.js',
        '--config', 'configs/examples/usb_hub_reference_mount.json',
        '--model', 'output/usb-hub-reference-mount/cad/usb_hub_reference_adapter_R1.brep',
        '--source-manifest', 'output/usb-hub-reference-mount/cad/usb_hub_reference_adapter_R1_manifest.json',
        '--part-id', 'USB-REF-ADAPTER', '--cad-revision', 'R1', '--out-dir', str(out),
    ], cwd=ROOT, capture_output=True, text=True, timeout=120)


def test_real_export_preserves_native_holes_and_repeats_payloads(tmp_path):
    first, second = tmp_path/'first', tmp_path/'second'
    run = export(first)
    assert run.returncode == 0, run.stdout+run.stderr
    run = export(second)
    assert run.returncode == 0, run.stdout+run.stderr
    for name in ['reference.png', 'feature-map.json', 'cad-metadata.json']:
        assert (first/name).read_bytes() == (second/name).read_bytes()
    metadata = json.loads((first/'cad-metadata.json').read_bytes())
    assert metadata['source_kind'] == 'native_freecad'
    assert [(h['feature_id'], h['center_mm'], h['radius_mm']) for h in metadata['holes']] == [
        ('hole_H1', [29, 24.4], 2), ('hole_H2', [29, 49.6], 2),
        ('hole_H3', [113, 24.4], 2), ('hole_H4', [113, 49.6], 2),
        ('hole_P1', [12, 12], 2.75), ('hole_P2', [12, 62], 2.75),
        ('hole_P3', [130, 12], 2.75), ('hole_P4', [130, 62], 2.75),
    ]
    assert metadata['physical_test'] == 'not_tested'
    assert metadata['manufacturing_release'] is False


def test_missing_native_h4_is_rejected_without_publishing_image(tmp_path):
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runScript } from './lib/runner.js';
const original = JSON.parse(readFileSync('configs/examples/usb_hub_reference_mount.json'));
const changed = structuredClone(original);
changed.shapes.find(s => s.id === 'hole_H4').position = [1000, 1000, -1];
changed.export.directory = resolve(process.argv[1]);
changed.export.formats = ['brep'];
const created = await runScript('create_model.py', changed);
const imagePath = join(resolve(process.argv[1]), 'must-not-publish.png');
await assert.rejects(runScript('export_mvs_reference.py', {
  config: original, model_path: created.exports[0].path, image_path: imagePath,
}), /hole_H4/);
assert.equal(existsSync(imagePath), false);
console.log('missing-hole-native: ok');
'''
    result = subprocess.run(['node', '--input-type=module', '-e', script, str(tmp_path)],
                            cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout+result.stderr


def test_step_input_is_read_as_native_geometry(tmp_path):
    command = [
        'node', 'scripts/export-mvs-reference.js',
        '--config', 'configs/examples/usb_hub_reference_mount.json',
        '--model', 'output/usb-hub-reference-mount/cad/usb_hub_reference_adapter_R1.step',
        '--source-manifest', 'output/usb-hub-reference-mount/cad/usb_hub_reference_adapter_R1_manifest.json',
        '--part-id', 'USB-REF-ADAPTER', '--cad-revision', 'R1', '--out-dir', str(tmp_path/'step'),
    ]
    run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, run.stdout+run.stderr
    metadata = json.loads((tmp_path/'step/cad-metadata.json').read_text())
    assert len(metadata['holes']) == 8
    assert metadata['holes'][0]['center_mm'] == [29, 24.4]
