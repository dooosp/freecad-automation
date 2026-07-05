#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRuntimeDiagnostics,
  CONDITIONAL_COMMANDS,
  detectRuntimeDetails,
  FREECAD_BACKED_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
  redactRuntimeDiagnosticsPaths,
  SUPPORT_BOUNDARY_NOTE,
} from '../lib/runtime-diagnostics.js';
import { getFreeCADRuntime } from '../lib/paths.js';
import {
  buildRuntimeFingerprint,
  collectRuntimeFingerprintRepoContext,
} from '../src/services/runtime/runtime-fingerprint-service.js';
import {
  parseCheckRuntimeOptions,
  resolveRuntimeFingerprintOutputPath,
} from '../src/cli/check-runtime-options.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), '..');

function formatValue(value, fallback = 'not set') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  return String(value);
}

function logSection(logger, title) {
  logger('');
  logger(`${title}:`);
}

function logList(logger, entries, { empty = '  - none' } = {}) {
  if (!entries || entries.length === 0) {
    logger(empty);
    return;
  }
  for (const entry of entries) {
    logger(`  - ${entry}`);
  }
}

function logIndentedCommandList(logger, entries) {
  if (!entries || entries.length === 0) {
    logger('    - none');
    return;
  }
  for (const entry of entries) {
    logger(`    - ${entry}`);
  }
}

function renderOverrideEntries(diagnostics) {
  return diagnostics.env_overrides.values.map((entry) => {
    const suffix = entry.selected ? ' [selected]' : '';
    return `${entry.name}: ${formatValue(entry.value)}${suffix}`;
  });
}

function renderCandidateEntries(diagnostics) {
  const selected = new Set(diagnostics.detected_runtime_paths.selected_candidates || []);
  return (diagnostics.detected_runtime_paths.checked_candidates || [])
    .map((candidate) => `${candidate}${selected.has(candidate) ? ' [selected]' : ''}`);
}

function commandCoverageFromDiagnostics(diagnostics = {}) {
  const directCoverage = diagnostics.command_coverage;
  if (Array.isArray(directCoverage)) {
    return directCoverage
      .map((entry) => entry?.command)
      .filter(Boolean);
  }

  const classes = diagnostics.command_classes || {};
  return [
    ...(classes.diagnostics || []),
    ...(classes.freecad_backed || []),
    ...(classes.plain_python_or_node || []),
    ...(classes.mixed_or_conditional || []).map((entry) => (
      typeof entry === 'string' ? entry : entry?.name
    )),
  ].filter(Boolean);
}

function writeRuntimeFingerprint(diagnostics, fingerprintOut, { projectRoot = PROJECT_ROOT } = {}) {
  if (!fingerprintOut) return;
  const outputPath = resolveRuntimeFingerprintOutputPath(fingerprintOut, { projectRoot });
  const fingerprint = buildRuntimeFingerprint({
    repo: diagnostics.repo || collectRuntimeFingerprintRepoContext(projectRoot),
    runtime: {
      platform: diagnostics.platform,
      freecad_status: diagnostics.status,
      freecad_version: diagnostics.version_details?.freecad?.version ?? null,
      freecad_executable_detected: diagnostics.executable_detected ?? null,
    },
    commands: commandCoverageFromDiagnostics(diagnostics),
  });
  writeFileSync(outputPath, `${JSON.stringify(fingerprint, null, 2)}\n`);
}

export function printRuntimeDiagnostics({
  logger = console.log,
  runtime = getFreeCADRuntime(),
  platform = process.platform,
  env = process.env,
  detectDetails = detectRuntimeDetails,
  format = 'text',
  redactPaths = false,
  fingerprintOut = null,
  projectRoot = PROJECT_ROOT,
} = {}) {
  const diagnostics = buildRuntimeDiagnostics({
    runtime,
    platform,
    env,
    detectDetails,
  });
  writeRuntimeFingerprint(diagnostics, fingerprintOut, { projectRoot });

  if (format === 'json') {
    const output = redactPaths ? redactRuntimeDiagnosticsPaths(diagnostics) : diagnostics;
    logger(JSON.stringify(output, null, 2));
    return diagnostics.available ? 0 : 1;
  }

  logger('FreeCAD Automation runtime diagnostics');
  logger(`Status: ${diagnostics.status === 'ready' ? 'ready' : diagnostics.status === 'runtime_probe_failed' ? 'runtime probe failed' : 'runtime not detected'}`);
  logger(`Platform: ${diagnostics.platform}`);

  logSection(logger, 'Selected runtime');
  logger(`  - Summary: ${diagnostics.selected_runtime.summary}`);
  logger(`  - Resolution source: ${formatValue(diagnostics.selected_runtime.source, 'auto-detect')}`);
  logger(`  - Runtime mode: ${formatValue(diagnostics.selected_runtime.mode, 'unknown')}`);
  logger(`  - Script executable: ${formatValue(diagnostics.selected_runtime.executable, 'not found')}`);
  if (diagnostics.selected_runtime.bundle_root) logger(`  - Bundle root: ${diagnostics.selected_runtime.bundle_root}`);
  if (diagnostics.selected_runtime.install_root) logger(`  - Install root: ${diagnostics.selected_runtime.install_root}`);
  if (diagnostics.selected_runtime.runtime_executable) logger(`  - FreeCAD runtime executable: ${diagnostics.selected_runtime.runtime_executable}`);
  if (diagnostics.selected_runtime.python_executable) logger(`  - FreeCAD Python executable: ${diagnostics.selected_runtime.python_executable}`);
  if (diagnostics.selected_runtime.gui_executable) logger(`  - FreeCAD GUI launcher: ${diagnostics.selected_runtime.gui_executable}`);

  logSection(logger, 'Environment overrides');
  logger(`  Resolution order: ${diagnostics.env_overrides.resolution_order.join(' -> ')}`);
  logList(logger, renderOverrideEntries(diagnostics));

  logSection(logger, 'Searched paths');
  logList(logger, renderCandidateEntries(diagnostics), {
    empty: '  - no candidate paths were generated for this platform',
  });

  logSection(logger, 'Detected runtime details');
  logger(`  - Python executable: ${formatValue(diagnostics.version_details.python.executable)}`);
  logger(`  - Python version: ${formatValue(diagnostics.version_details.python.version, 'unavailable')}`);
  if (diagnostics.version_details.python.platform) logger(`  - Python platform: ${diagnostics.version_details.python.platform}`);
  if (diagnostics.version_details.python.error) logger(`  - Python probe note: ${diagnostics.version_details.python.error}`);
  logger(`  - FreeCAD executable: ${formatValue(diagnostics.version_details.freecad.executable)}`);
  logger(`  - FreeCAD version: ${formatValue(diagnostics.version_details.freecad.version, 'unavailable')}`);
  if (diagnostics.version_details.freecad.home_path) logger(`  - FreeCAD home: ${diagnostics.version_details.freecad.home_path}`);
  if (diagnostics.version_details.freecad.module_path) logger(`  - FreeCAD module: ${diagnostics.version_details.freecad.module_path}`);
  if (diagnostics.version_details.freecad.error) logger(`  - FreeCAD probe note: ${diagnostics.version_details.freecad.error}`);

  logSection(logger, 'Command coverage');
  logger('  Commands that require FreeCAD:');
  logIndentedCommandList(logger, FREECAD_BACKED_COMMANDS);
  logger('  Commands that can run in plain Python / Node mode:');
  logIndentedCommandList(logger, PLAIN_PYTHON_COMMANDS);
  logger('  Mixed / conditional commands:');
  logIndentedCommandList(logger, CONDITIONAL_COMMANDS.map((entry) => `${entry.name}: ${entry.note}`));

  logSection(logger, 'Verification note');
  logger('  - Repository-owned live runtime verification currently exists for macOS + FreeCAD 1.1.x.');
  logger(`  - ${SUPPORT_BOUNDARY_NOTE}`);

  if (diagnostics.available) {
    logSection(logger, 'Next steps');
    logList(logger, diagnostics.next_steps);
    return 0;
  }

  logSection(logger, 'Remediation');
  logList(logger, diagnostics.remediation);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const options = parseCheckRuntimeOptions(process.argv.slice(2), { projectRoot: PROJECT_ROOT });
  process.exit(printRuntimeDiagnostics({
    format: options.useJson ? 'json' : 'text',
    redactPaths: options.redactPaths,
    fingerprintOut: options.fingerprintOut,
    projectRoot: PROJECT_ROOT,
  }));
}
