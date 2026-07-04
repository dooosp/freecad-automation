import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { adaptQifLiteInspectionXml } from '../src/services/inspection-evidence-intake/qif-lite-adapter-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const QIF_LITE_REPORT_SCHEMA = JSON.parse(readFileSync(
  join(ROOT, 'schemas/qif-lite-inspection-adapter-report.schema.json'),
  'utf8'
));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateQifLiteReport = ajv.compile(QIF_LITE_REPORT_SCHEMA);

test('adaptQifLiteInspectionXml returns inspection evidence shaped payload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fcad-qif-lite-'));
  const input = join(dir, 'supplier.xml');
  await writeFile(input, '<QIFDocument><Inspection><PackageId>quality-pass-bracket</PackageId><InspectedPart>part-a</InspectedPart><InspectedAt>2026-07-01T09:00:00Z</InspectedAt><SourceType>supplier_inspection_report</SourceType><OverallResult>pass</OverallResult><Units>mm</Units><Feature><FeatureId>HOLE_DIA</FeatureId><MeasuredValue>6.01</MeasuredValue><Result>pass</Result><MeasurementMethod>CMM</MeasurementMethod></Feature></Inspection></QIFDocument>', 'utf8');

  const report = await adaptQifLiteInspectionXml({
    inputPath: input,
    sourceRef: 'docs/examples/quality-pass-bracket/inspection/supplier.xml',
  });

  assert.equal(report.adapter, 'qif-lite');
  assert.equal(report.inspection_evidence.package_id, 'quality-pass-bracket');
  assert.equal(report.classification.attachment_ready_candidate, true);
  assert.equal(
    validateQifLiteReport(report),
    true,
    `adapter report should satisfy schema: ${ajv.errorsText(validateQifLiteReport.errors)}`
  );
});

test('adaptQifLiteInspectionXml rejects candidate when only feature is not measured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fcad-qif-lite-'));
  const input = join(dir, 'supplier.xml');
  await writeFile(input, '<QIFDocument><Inspection><PackageId>quality-pass-bracket</PackageId><InspectedPart>part-a</InspectedPart><InspectedAt>2026-07-01T09:00:00Z</InspectedAt><SourceType>supplier_inspection_report</SourceType><OverallResult>pass</OverallResult><Units>mm</Units><Feature><FeatureId>HOLE_DIA</FeatureId><Result>not_measured</Result><MeasurementMethod>CMM</MeasurementMethod></Feature></Inspection></QIFDocument>', 'utf8');

  const report = await adaptQifLiteInspectionXml({
    inputPath: input,
    sourceRef: 'docs/examples/quality-pass-bracket/inspection/supplier.xml',
  });

  assert.equal(report.classification.attachment_ready_candidate, false);
  assert.equal(report.classification.rejection_reasons.includes('missing_measured_features'), true);
  assert.equal(
    validateQifLiteReport(report),
    true,
    `adapter report should satisfy schema: ${ajv.errorsText(validateQifLiteReport.errors)}`
  );
});

test('adaptQifLiteInspectionXml rejects candidate with missing required metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fcad-qif-lite-'));
  const input = join(dir, 'supplier.xml');
  await writeFile(input, '<QIFDocument><Inspection><SourceType>supplier_inspection_report</SourceType><OverallResult>pass</OverallResult><Units>mm</Units><Feature><FeatureId>HOLE_DIA</FeatureId><MeasuredValue>6.01</MeasuredValue><Result>pass</Result><MeasurementMethod>CMM</MeasurementMethod></Feature></Inspection></QIFDocument>', 'utf8');

  const report = await adaptQifLiteInspectionXml({
    inputPath: input,
    sourceRef: 'docs/examples/quality-pass-bracket/inspection/supplier.xml',
  });

  assert.equal(report.classification.attachment_ready_candidate, false);
  assert.equal(report.classification.rejection_reasons.includes('missing_package_id'), true);
  assert.equal(report.classification.rejection_reasons.includes('missing_inspected_part'), true);
  assert.equal(report.classification.rejection_reasons.includes('missing_inspected_at'), true);
  assert.equal(
    validateQifLiteReport(report),
    true,
    `adapter report should satisfy schema: ${ajv.errorsText(validateQifLiteReport.errors)}`
  );
});

test('adaptQifLiteInspectionXml rejects ignored local inbox source refs before invoking Python', async () => {
  await assert.rejects(
    adaptQifLiteInspectionXml({
      inputPath: '/tmp/should-not-be-read.xml',
      sourceRef: 'local/stage5b-candidate-evidence-inbox/supplier.xml',
    }),
    /sourceRef must be a safe repo-relative path/i
  );
});

test('qif-lite adapter schema rejects ignored local inbox source refs', () => {
  const report = {
    schema_version: '1.0',
    adapter: 'qif-lite',
    source_ref: 'local/stage5b-candidate-evidence-inbox/supplier.xml',
    classification: {
      attachment_ready_candidate: false,
      rejection_reasons: ['unsafe_source_ref'],
    },
    inspection_evidence: null,
  };

  assert.equal(validateQifLiteReport(report), false);
});
