// Case-specific input preparation for existing review/compare/plan commands.
// No generated artifact identity or inspection result is edited after generation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'smol-toml';

export function reproduceRevisionCase({ repo, out, caseDir, cli }) {
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const write = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const local = (path) => relative(repo, path).split('\\').join('/');
  const contractPath = join(caseDir, 'inputs/revision-contract.json');
  const contract = read(contractPath);
  const measurements = read(join(out, 'measurements.json'));
  assert.equal(measurements.pass, true, 'Review requirements need saved STEP measurements.');
  const folder = join(out, 'revision-review');
  mkdirSync(folder);
  const generatedAt = new Date().toISOString();
  const revisions = {};

  for (const rev of ['A', 'B']) {
    const dir = join(folder, `rev-${rev.toLowerCase()}`);
    mkdirSync(dir);
    const sourceConfig = join(out, `rev-${rev.toLowerCase()}/config.toml`);
    const model = join(out, `rev-${rev.toLowerCase()}/usb_hub_surrogate_${rev}.step`);
    const config = parse(readFileSync(sourceConfig, 'utf8'));
    const originalShapes = JSON.stringify(config.shapes);
    const measured = measurements.revisions[rev];
    const measuredValues = {
      'PLATE.LENGTH': measured.bbox_mm[0], 'PLATE.WIDTH': measured.bbox_mm[1],
      'PLATE.THICKNESS': measured.bbox_mm[2],
    };
    for (const name of ['D1', 'D2', 'H1', 'H2']) {
      const shape = config.shapes.find((s) => s.id === `hole_${name}`);
      const matches = measured.holes.filter((h) => Math.abs(h.x - shape.position[0]) <= 1e-5
        && Math.abs(h.y - shape.position[1]) <= 1e-5);
      assert.equal(matches.length, 1, `${rev}/${name}: stable case identity must match one measured hole.`);
      measuredValues[`${name}.X`] = matches[0].x;
      measuredValues[`${name}.Y`] = matches[0].y;
      measuredValues[`${name}.DIAMETER`] = matches[0].diameter;
    }
    measuredValues['HORIZONTAL.PITCH'] = measuredValues['H1.X'] - measuredValues['D1.X'];
    measuredValues['RIGHT.CENTER_MARGIN'] = measuredValues['PLATE.LENGTH'] - measuredValues['H1.X'];
    assert.equal(measuredValues['HORIZONTAL.PITCH'], measuredValues['H2.X'] - measuredValues['D2.X']);
    assert.equal(measuredValues['H1.X'], measuredValues['H2.X']);
    for (const c of contract.characteristics) {
      assert.ok(Object.hasOwn(measuredValues, c.characteristic_id), `Unknown case characteristic ${c.characteristic_id}`);
      assert.ok(Math.abs(measuredValues[c.characteristic_id] - c.nominal_mm[rev]) <= 1e-5,
        `${rev}/${c.characteristic_id} requirement differs from saved STEP measurement.`);
    }
    // The existing comparison contract treats config.name as a part-ID alias.
    // Normalize it on this separate comparison input; original CAD inputs remain intact.
    config.name = contract.part_id;
    config.product = { ...config.product, part_id: contract.part_id, package_slug: contract.package_slug, revision: rev };
    config.drawing_intent = {
      part_type: 'plate',
      required_dimensions: contract.characteristics.map((c) => ({
        id: c.characteristic_id, feature: c.feature_id, label: c.label,
        nominal_mm: c.nominal_mm[rev], tolerance: null, required: true,
        reason: 'Explicit synthetic requirement; manufacturing tolerance and inspection method unverified.',
        specification_reference: c.specification_reference,
      })),
    };
    assert.equal(JSON.stringify(config.shapes), originalShapes);
    const configPath = join(dir, 'comparison-config.json');
    write(configPath, config);
    const contextPath = join(dir, 'context.json');
    write(contextPath, {
      part: { part_id: contract.part_id, package_slug: contract.package_slug, revision: rev,
        name: 'USB hub synthetic plate', description: contract.description, material: null, process: null },
      geometry_source: { path: local(model), file_type: 'step', revision: rev, source_sha256: sha256(model) },
      bom: [], inspection_results: [], quality_issues: [],
      manufacturing_context: { notes: contract.description },
      metadata: { created_at: generatedAt, source_files: [local(sourceConfig), local(model), local(contractPath)],
        provenance: { test_scope: contract.test_scope, production_trust: false,
          original_config_sha256: sha256(sourceConfig), model_sha256: sha256(model),
          requirements_sha256: sha256(contractPath), comparison_config_sha256: sha256(configPath) },
        warnings: ['SIMULATED - NOT FOR FABRICATION. No physical inspection, released tolerances, or inspection method.'] },
    });
    const requirementsPath = join(dir, 'inspection-requirements.json');
    write(requirementsPath, {
      artifact_type: 'inspection_requirements', schema_version: '1.0',
      package_slug: contract.package_slug, part_id: contract.part_id, revision: rev,
      test_scope: contract.test_scope, production_trust: false, description: contract.description,
      items: contract.characteristics.map((c) => ({
        characteristic_id: c.characteristic_id, feature_id: c.feature_id, characteristic_name: c.label,
        nominal_value: c.nominal_mm[rev], unit: 'mm', tolerance: null, datum_reference: null,
        inspection_method: null, equipment_class: null, sampling: null,
        specification_reference: c.specification_reference,
      })),
    });
    const reviewPath = join(dir, 'review-pack.json');
    cli(`review-${rev.toLowerCase()}`, ['review-context', '--context', local(contextPath), '--out', local(reviewPath)]);
    const review = read(reviewPath);
    assert.equal(review.part_id, contract.part_id);
    assert.equal(review.revision, rev);
    assert.equal(review.part.package_slug, contract.package_slug);
    assert.equal(review.inspection_linkage.records.length, 0, 'No inspection results were supplied.');
    assert.ok(!JSON.stringify(review.warnings).includes('No JSON found'), 'STEP detector still failed.');
    revisions[rev] = { configPath, reviewPath, requirementsPath, modelSha256: sha256(model), configSha256: sha256(configPath) };
  }

  const impactPath = join(folder, 'revision-impact.json');
  cli('compare-revisions', ['compare-rev', local(revisions.A.reviewPath), local(revisions.B.reviewPath),
    '--out', local(join(folder, 'revision-comparison.json')), '--impact-out', local(impactPath),
    '--baseline-config', local(revisions.A.configPath), '--candidate-config', local(revisions.B.configPath),
    '--generated-at', generatedAt]);
  const impact = read(impactPath);
  const changed = impact.changes.filter((change) => change.change_type === 'nominal_dimension_change');
  const expectedChanges = contract.characteristics.filter((c) => c.nominal_mm.A !== c.nominal_mm.B);
  assert.deepEqual(changed.map((c) => c.affected_entity_id).sort(), expectedChanges.map((c) => c.characteristic_id).sort());
  for (const expected of expectedChanges) {
    const actual = changed.find((c) => c.affected_entity_id === expected.characteristic_id);
    assert.equal(actual.before_value, expected.nominal_mm.A);
    assert.equal(actual.after_value, expected.nominal_mm.B);
    assert.equal(actual.determinability, 'determined');
  }
  const assessments = impact.evidence_applicability.assessments;
  const fixedIds = contract.characteristics.filter((c) => ['plate', 'hole_D1', 'hole_D2'].includes(c.feature_id)).map((c) => c.characteristic_id);
  for (const id of fixedIds) assert.equal(assessments.find((a) => a.evidence_or_characteristic_id === id)?.applicability_status, 'unaffected');
  assert.equal(impact.evidence_applicability.authoritative_evidence_state_changed, false);

  const plans = {};
  for (const scope of ['full', 'delta']) {
    const planPath = join(folder, `inspection-${scope}.json`);
    cli(`inspection-${scope}`, ['inspection-plan', '--review-pack', local(revisions.B.reviewPath),
      '--config', local(revisions.B.configPath), '--requirements', local(revisions.B.requirementsPath),
      ...(scope === 'delta' ? ['--revision-impact', local(impactPath)] : []),
      '--scope', scope, '--out', local(planPath), '--checksheet-out', local(join(folder, `checksheet-${scope}.csv`)),
      '--generated-at', generatedAt]);
    const plan = read(planPath);
    assert.equal(plan.status, 'review_required');
    assert.equal(plan.boundaries.inspection_evidence, false);
    assert.equal(plan.boundaries.measured_results_present, false);
    assert.equal(plan.boundaries.human_release_required, true);
    assert.ok(plan.items.length > 0);
    for (const item of plan.items) {
      assert.equal(item.current_status, 'not_started');
      assert.equal(item.lower_limit, null);
      assert.equal(item.upper_limit, null);
      assert.equal(item.required_method, null);
      assert.equal(item.evidence_state_changed, false);
    }
    if (scope === 'full') assert.equal(plan.items.length, contract.characteristics.length);
    if (scope === 'delta') {
      const ids = plan.items.map((item) => item.characteristic_id);
      for (const expected of expectedChanges) assert.ok(ids.includes(expected.characteristic_id));
      assert.ok(fixedIds.every((id) => !ids.includes(id)), 'Fixed plate/D-hole requirements must remain outside delta.');
    }
    plans[scope] = { file: local(planPath), status: plan.status, items: plan.items.map((item) => item.characteristic_id),
      unresolved_codes: [...new Set(plan.unresolved_requirements.map((u) => u.code))].sort() };
  }
  const result = { scope: contract.test_scope, production_trust: false,
    package_slug: contract.package_slug, part_id: contract.part_id, revisions: ['A', 'B'],
    original_model_sha256: Object.fromEntries(Object.entries(revisions).map(([rev, data]) => [rev, data.modelSha256])),
    comparison_config_sha256: Object.fromEntries(Object.entries(revisions).map(([rev, data]) => [rev, data.configSha256])),
    nominal_changes: changed.map((c) => ({ id: c.affected_entity_id, before: c.before_value, after: c.after_value, change_id: c.change_id })),
    unchanged_characteristics: fixedIds, impact: local(impactPath), plans,
    physical_inspection_performed: false, inspection_evidence_attached: false, pass: true };
  write(join(folder, 'case-review-result.json'), result);
  return result;
}
