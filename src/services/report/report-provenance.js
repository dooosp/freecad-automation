import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { parseConfigText, validateConfigDocument } from '../../../lib/config-schema.js';
import { validateOutputManifest } from '../../../lib/output-manifest.js';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

export function reportConfigFingerprint(config) {
  return digest(JSON.stringify(stableJson(validateConfigDocument(config).config)));
}

export function reportDfmInputFingerprint(config, {
  process = config?.manufacturing?.process || config?.process || 'machining',
  standard = config?.standard || 'KS',
} = {}) {
  return reportConfigFingerprint({
    ...config, standard,
    manufacturing: { ...(config?.manufacturing || {}), process },
  });
}

export function bindReportAnalysis(result, configFingerprint, effectiveInputFingerprint) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const { report_provenance: ignored, ...assessment } = result;
  return { ...assessment, report_provenance: {
    schema_version: '1.0', run_id: randomUUID(),
    config_sha256: configFingerprint,
    effective_input_sha256: effectiveInputFingerprint,
    result_sha256: digest(JSON.stringify(stableJson(assessment))),
  } };
}

export function verifyReportAnalysis(result, config, effectiveOptions = {}) {
  const { report_provenance: provenance, ...assessment } = result || {};
  const rejected = (reason) => ({ status: 'unverified', reason, reported_status: result?.status || null });
  if (!provenance) return rejected('analysis_provenance_missing');
  if (provenance.schema_version !== '1.0' || typeof provenance.run_id !== 'string' || !provenance.run_id.trim()) {
    return rejected('analysis_provenance_invalid');
  }
  if (provenance.config_sha256 !== reportConfigFingerprint(config)) return rejected('analysis_input_mismatch');
  if (provenance.effective_input_sha256 !== reportDfmInputFingerprint(config, effectiveOptions)) {
    return rejected('analysis_effective_input_mismatch');
  }
  if (provenance.result_sha256 !== digest(JSON.stringify(stableJson(assessment)))) return rejected('analysis_result_mismatch');
  return {
    status: 'verified', reason: 'verified', run_id: provenance.run_id,
    config_sha256: provenance.config_sha256, result_sha256: provenance.result_sha256,
    effective_input_sha256: provenance.effective_input_sha256,
  };
}

function validRecord(record) {
  return typeof record?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256)
    && Number.isSafeInteger(record.size_bytes) && record.size_bytes >= 0;
}

// Compare the bytes actually read, not a later stat/hash of a potentially replaced file.
export async function captureReportInput(configPath, config) {
  if (!configPath) return { reason: 'input_unverifiable' };
  try {
    const bytes = await readFile(configPath);
    const parsed = parseConfigText(bytes.toString('utf8'), configPath).parsed;
    if (!isDeepStrictEqual(validateConfigDocument(parsed).config, validateConfigDocument(config).config)) {
      return { reason: 'input_config_mismatch' };
    }
    return { path: resolve(configPath), sha256: digest(bytes), size_bytes: bytes.length };
  } catch {
    return { reason: 'input_unverifiable' };
  }
}

async function readJsonSnapshot(path) {
  try {
    const bytes = await readFile(path);
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { reason: 'invalid' };
      return { value, sha256: digest(bytes), size_bytes: bytes.length };
    } catch {
      return { reason: 'invalid' };
    }
  } catch (error) {
    return { reason: error.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

function outputMatchesPath(recordPath, qualityPath, manifestPath) {
  if (typeof recordPath !== 'string' || !recordPath.trim()) return false;
  // A copied Studio artifact keeps the original absolute path in its manifest.
  // Its basename plus exact content hash identifies the copied output; input
  // hashes, command and run identity are checked independently below.
  return isAbsolute(recordPath)
    ? basename(recordPath) === basename(qualityPath)
    : resolve(dirname(manifestPath), recordPath) === resolve(qualityPath);
}

export async function readVerifiedReportQuality({ qualityPath, manifestPath, command, inputRecord }) {
  const [quality, source] = await Promise.all([readJsonSnapshot(qualityPath), readJsonSnapshot(manifestPath)]);
  const manifest = source.value;
  const provenance = {
    status: 'unverified', reason: null, manifest_path: manifestPath,
    manifest_status: manifest?.status || null,
    manifest_errors: Array.isArray(manifest?.errors) ? manifest.errors : [],
    quality_path: qualityPath, reported_status: quality.value?.status || null,
    run_id: typeof manifest?.run_id === 'string' ? manifest.run_id : null,
    input_sha256: manifest?.input?.sha256 || null,
    quality_sha256: quality.sha256 || null,
  };
  const reject = (reason) => ({ quality: null, manifest: null, provenance: { ...provenance, reason } });
  if (!quality.value) return reject(`quality_${quality.reason}`);
  if (!manifest) return reject(`manifest_${source.reason}`);
  if (!validateOutputManifest(manifest).ok) return reject('manifest_invalid');
  if (manifest.command !== command) return reject('manifest_command_mismatch');
  if (manifest.status === 'fail' || manifest.errors.length > 0) return reject('manifest_run_failed');
  if (!validRecord(inputRecord)) return reject(inputRecord?.reason || 'input_unverifiable');
  if (!validRecord(manifest.input)) return reject('manifest_input_unverifiable');
  if (manifest.input.sha256 !== inputRecord.sha256 || manifest.input.size_bytes !== inputRecord.size_bytes) {
    return reject('input_sha256_mismatch');
  }
  const outputs = manifest.outputs.filter((record) => outputMatchesPath(record.path, qualityPath, manifestPath));
  if (outputs.length !== 1 || !outputs[0].exists || !validRecord(outputs[0])) return reject('output_record_unverifiable');
  if (outputs[0].sha256 !== quality.sha256 || outputs[0].size_bytes !== quality.size_bytes) {
    return reject('quality_sha256_mismatch');
  }
  return { quality: quality.value, manifest, provenance: { ...provenance, status: 'verified', reason: 'verified' } };
}

export async function readReportQualityEvidence(paths, inputRecord) {
  const [create, drawing] = await Promise.all([
    readVerifiedReportQuality({ qualityPath: paths.create_quality, manifestPath: paths.create_manifest, command: 'create', inputRecord }),
    readVerifiedReportQuality({ qualityPath: paths.drawing_quality, manifestPath: paths.drawing_manifest, command: 'draw', inputRecord }),
  ]);
  return {
    createQuality: create.quality,
    drawingQuality: drawing.quality,
    createManifest: create.manifest,
    drawingManifest: drawing.manifest,
    qualityProvenance: { create_quality: create.provenance, drawing_quality: drawing.provenance },
  };
}
