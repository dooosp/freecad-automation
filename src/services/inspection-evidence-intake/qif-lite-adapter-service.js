import { execFile as execFileCallback } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  isUnsafeStage5bLocalPathText,
  normalizeRepoRelativePathText,
} from '../../shared/stage5b-path-boundary.js';

const execFile = promisify(execFileCallback);
const ADAPTER_SCRIPT = fileURLToPath(new URL('../../../scripts/adapters/load_qif_lite_inspection.py', import.meta.url));
const QIF_LITE_REPORT_SCHEMA = JSON.parse(readFileSync(
  new URL('../../../schemas/qif-lite-inspection-adapter-report.schema.json', import.meta.url),
  'utf8'
));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateQifLiteReport = ajv.compile(QIF_LITE_REPORT_SCHEMA);

function assertValidQifLiteReport(report) {
  if (validateQifLiteReport(report)) return report;
  const errors = (validateQifLiteReport.errors || [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join(' | ');
  throw new Error(`qif-lite adapter emitted invalid report: ${errors}`);
}

function validateSourceRef(sourceRef) {
  const raw = typeof sourceRef === 'string' ? sourceRef.trim() : '';
  const normalized = normalizeRepoRelativePathText(raw);
  if (
    !raw
    || raw.includes('\0')
    || raw.includes('\\')
    || raw.startsWith('/')
    || raw.startsWith('~')
    || /^[A-Za-z]:/.test(raw)
    || normalized.split('/').includes('..')
    || isUnsafeStage5bLocalPathText(normalized)
  ) {
    throw new Error('sourceRef must be a safe repo-relative path outside ignored local Stage 5B inbox, output/, and tmp/codex/.');
  }
  return normalized;
}

export async function adaptQifLiteInspectionXml({ inputPath, sourceRef, python = 'python3' } = {}) {
  if (!inputPath) throw new Error('inputPath is required');
  if (!sourceRef) throw new Error('sourceRef is required');
  const safeSourceRef = validateSourceRef(sourceRef);

  const { stdout } = await execFile(python, [
    ADAPTER_SCRIPT,
    '--input',
    inputPath,
    '--source-ref',
    safeSourceRef,
  ], {
    maxBuffer: 1024 * 1024,
  });

  return assertValidQifLiteReport(JSON.parse(stdout));
}
