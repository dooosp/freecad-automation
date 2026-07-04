import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  isUnsafeStage5bLocalPathText,
  normalizeRepoRelativePathText,
} from '../../shared/stage5b-path-boundary.js';

const execFile = promisify(execFileCallback);
const ADAPTER_SCRIPT = fileURLToPath(new URL('../../../scripts/adapters/load_qif_lite_inspection.py', import.meta.url));

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

  return JSON.parse(stdout);
}
