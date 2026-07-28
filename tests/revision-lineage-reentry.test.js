import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  buildAfArtifactContractMetadata,
  createAfArtifactIdentityRecord,
} from '../lib/af-execution-contract.js';
import { buildArtifactManifest, validateArtifactManifest } from '../lib/artifact-manifest.js';
import { getCCommandContract } from '../lib/c-artifact-schema.js';
import { buildOutputManifest, validateOutputManifest } from '../lib/output-manifest.js';
import { buildZipArchive } from '../lib/zip-archive.js';
import {
  inspectCanonicalBundle,
  resolveBundleBackedCanonicalPath,
} from '../src/services/jobs/af-reentry.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { createLocalApiJobCoordinator } from '../src/server/local-api-job-operations.js';
import {
  translateStudioJobSubmission,
  validateStudioJobSubmission,
} from '../src/server/studio-job-bridge.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'fcad-revision-lineage-reentry-')));
const JOBS_DIR = join(TMP_ROOT, 'jobs');
const CONFIG_SHA256 = 'a'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function proofLineage() {
  return {
    schema_version: '1.0',
    mode: 'proof',
    identity: {
      package_slug: 'proof-part',
      part_id: 'PROOF-001',
      revision: 'B',
      config_sha256: CONFIG_SHA256,
    },
    parents: [
      {
        artifact_type: 'config',
        role: 'authoritative_config',
        path: 'configs/proof-part.toml',
        sha256: CONFIG_SHA256,
        size_bytes: 42,
      },
    ],
  };
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function createProofBundle({ tamperManifest = false, tamperChecksums = false, tamperMember = false } = {}) {
  const readinessPath = 'canonical/readiness_report.json';
  const logPath = 'release_bundle_log.json';
  const readinessBytes = canonicalJson({ artifact_type: 'readiness_report', fixture: 'registered-proof' });
  const logBytes = canonicalJson({ status: 'fixture' });
  const baseEntries = [
    { path: readinessPath, artifact_type: 'readiness_report', role: 'primary', data: readinessBytes },
    { path: logPath, artifact_type: 'release_bundle_log', role: 'supporting', data: logBytes },
  ];
  const checksumsBytes = Buffer.from(`${baseEntries
    .map((entry) => `${sha256(entry.data)}  ${entry.path}`)
    .join('\n')}\n`);
  const manifest = {
    schema_version: '1.0',
    artifact_type: 'release_bundle_manifest',
    workflow: 'readiness_release_bundle',
    generated_at: '2026-07-27T00:00:00.000Z',
    effective_policy: { proof_lineage: tamperManifest ? false : true },
    revision_lineage: proofLineage(),
    warnings: [],
    coverage: { bundled_artifact_count: 4 },
    confidence: {
      level: 'high',
      score: 1,
      rationale: 'Deterministic proof bundle fixture.',
    },
    source_artifact_refs: [
      {
        artifact_type: 'readiness_report',
        path: readinessPath,
        role: 'input',
        label: 'Canonical readiness report JSON',
        sha256: sha256(readinessBytes),
        size_bytes: readinessBytes.length,
      },
    ],
    canonical_artifact: {
      json_is_source_of_truth: true,
      artifact_type: 'release_bundle_manifest',
      artifact_filename: 'release_bundle_manifest.json',
      derived_outputs: ['release_bundle'],
      rationale: 'Fixture packaging inventory.',
    },
    contract: getCCommandContract('pack'),
    readiness_report_ref: {
      artifact_type: 'readiness_report',
      path: readinessPath,
      role: 'input',
      label: 'Canonical readiness report JSON',
      sha256: sha256(readinessBytes),
      size_bytes: readinessBytes.length,
    },
    bundle_artifacts: [
      ...baseEntries.map((entry) => ({
        artifact_type: entry.artifact_type,
        role: entry.role,
        label: entry.path,
        path: entry.path,
        size_bytes: entry.data.length,
        sha256: sha256(entry.data),
      })),
      {
        artifact_type: 'release_bundle_checksums',
        role: 'supporting',
        label: 'Release bundle checksums',
        path: 'release_bundle_checksums.sha256',
        size_bytes: checksumsBytes.length,
        sha256: sha256(checksumsBytes),
      },
      {
        artifact_type: 'release_bundle_manifest',
        role: 'primary',
        label: 'Release bundle manifest JSON',
        path: 'release_bundle_manifest.json',
      },
    ],
    release_notes: ['Proof re-entry fixture.'],
  };
  const storedChecksums = tamperChecksums
    ? Buffer.from(checksumsBytes.toString('utf8').replace(/[a-f0-9]/, (value) => (value === '0' ? '1' : '0')))
    : checksumsBytes;
  const storedReadiness = tamperMember
    ? canonicalJson({ artifact_type: 'readiness_report', fixture: 'tampered-member' })
    : readinessBytes;
  return {
    bytes: buildZipArchive([
      { name: readinessPath, data: storedReadiness },
      { name: logPath, data: logBytes },
      { name: 'release_bundle_checksums.sha256', data: storedChecksums },
      { name: 'release_bundle_manifest.json', data: canonicalJson(manifest) },
    ]),
    readinessBytes,
  };
}

async function registerArtifact(store, {
  fileName,
  bytes,
  type,
  metadata = null,
}) {
  const job = await store.createJob({ type: 'report', config: { name: 'fixture' } });
  const artifactPath = await store.writeJobFile(job.id, `artifacts/${fileName}`, bytes);
  const manifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: job.id,
    artifacts: [{
      type,
      path: artifactPath,
      label: fileName,
      scope: 'user-facing',
      stability: 'stable',
      ...(metadata ? { metadata } : {}),
    }],
    timestamps: {
      created_at: job.created_at,
      started_at: job.created_at,
      finished_at: job.created_at,
    },
  });
  await store.completeJob(job.id, { success: true }, {}, {}, manifest);
  const [artifact] = await store.listArtifacts(job.id);
  return { job, artifact, artifactPath, manifest };
}

try {
  const store = createJobStore({ jobsDir: JOBS_DIR });
  const coordinator = createLocalApiJobCoordinator({
    jobStore: store,
    executor: {},
    studioDrawingService: {},
  });
  const originalBytes = Buffer.from('{"fixture":true}\n');
  const registered = await registerArtifact(store, {
    fileName: 'review_pack.json',
    bytes: originalBytes,
    type: 'review-pack.json',
    metadata: {
      af_contract: {
        reentry_target: 'review_pack',
        artifact_identity: { revision_lineage: proofLineage() },
      },
    },
  });

  assert.equal(registered.artifact.sha256, sha256(originalBytes));
  assert.equal(registered.artifact.size_bytes, originalBytes.length);
  assert.equal(registered.artifact.current_size_bytes, originalBytes.length);

  const ref = { job_id: registered.job.id, artifact_id: registered.artifact.id };
  const proofResolution = await coordinator.resolveArtifactRef(ref, { proofLineage: true });
  assert.equal(proofResolution.artifactBinding.sha256, registered.artifact.sha256);
  assert.equal(Object.isFrozen(proofResolution.artifactBinding), true);
  await store.verifyArtifactBinding(registered.job.id, registered.artifact.id, {
    expectedBinding: proofResolution.artifactBinding,
  });
  const detachedSnapshot = await store.readVerifiedArtifactSnapshot(
    registered.job.id,
    registered.artifact.id,
    { expectedBinding: proofResolution.artifactBinding }
  );
  writeFileSync(registered.artifactPath, Buffer.from('{"fixture":"mutated-after-read"}\n'));
  assert.deepEqual(detachedSnapshot.readDetachedBytes(), originalBytes);
  await assert.rejects(
    () => store.readVerifiedArtifactSnapshot(registered.job.id, registered.artifact.id, {
      expectedBinding: proofResolution.artifactBinding,
    }),
    (error) => error?.code === 'artifact_proof_bytes_changed'
  );
  writeFileSync(registered.artifactPath, originalBytes);

  const studioProof = await translateStudioJobSubmission({
    type: 'readiness-pack',
    artifact_ref: ref,
    options: { proof_lineage: true },
  }, { resolveArtifactRef: coordinator.resolveArtifactRef });
  assert.equal(studioProof.ok, true, studioProof.errors?.join(' | '));
  assert.equal(studioProof.request.options.effective_policy, undefined);
  assert.equal(studioProof.request.options.proof_lineage, true);
  assert.deepEqual(
    studioProof.request.options.studio.source_artifact_binding,
    proofResolution.artifactBinding
  );
  assert.equal(Object.isFrozen(studioProof.request.options.studio.source_artifact_binding), true);
  assert.throws(() => {
    studioProof.request.options.studio.source_artifact_binding.sha256 = '0'.repeat(64);
  }, TypeError);

  const studioLegacy = await translateStudioJobSubmission({
    type: 'readiness-pack',
    artifact_ref: ref,
    options: {
      studio: {
        source_artifact_binding: {
          schema_version: '1.0',
          job_id: 'spoofed',
          artifact_id: 'spoofed',
          path: '/tmp/spoofed',
          sha256: '0'.repeat(64),
          size_bytes: 1,
        },
      },
    },
  }, { resolveArtifactRef: coordinator.resolveArtifactRef });
  assert.equal(studioLegacy.ok, true);
  assert.equal(studioLegacy.request.options.studio.source_artifact_binding, undefined);
  assert.equal(
    validateStudioJobSubmission({
      type: 'readiness-pack',
      artifact_ref: ref,
      options: { proof_lineage: false },
    }).ok,
    false
  );

  writeFileSync(registered.artifactPath, Buffer.from('{"fixture":fals}\n'));
  await assert.rejects(
    () => coordinator.resolveArtifactRef(ref, { proofLineage: true }),
    (error) => error?.code === 'artifact_proof_bytes_changed'
  );
  assert.equal((await coordinator.resolveArtifactRef(ref)).artifact.exists, true);
  const rejectedStudioProof = await translateStudioJobSubmission({
    type: 'readiness-pack',
    artifact_ref: ref,
    options: { proof_lineage: true },
  }, { resolveArtifactRef: coordinator.resolveArtifactRef });
  assert.equal(rejectedStudioProof.ok, false);
  assert.match(rejectedStudioProof.errors.join(' '), /registered bytes/i);

  writeFileSync(registered.artifactPath, originalBytes);
  const outsidePath = join(TMP_ROOT, 'outside-review-pack.json');
  writeFileSync(outsidePath, originalBytes);
  unlinkSync(registered.artifactPath);
  symlinkSync(outsidePath, registered.artifactPath);
  await assert.rejects(
    () => coordinator.resolveArtifactRef(ref, { proofLineage: true }),
    (error) => error?.code === 'artifact_proof_path_outside_job'
      || error?.code === 'artifact_proof_unsafe_file_type'
  );

  unlinkSync(registered.artifactPath);
  const hardlinkSource = join(dirname(registered.artifactPath), 'hardlink-source.json');
  writeFileSync(hardlinkSource, originalBytes);
  linkSync(hardlinkSource, registered.artifactPath);
  await assert.rejects(
    () => coordinator.resolveArtifactRef(ref, { proofLineage: true }),
    (error) => error?.code === 'artifact_proof_hardlink_rejected'
  );
  unlinkSync(registered.artifactPath);
  unlinkSync(hardlinkSource);
  writeFileSync(registered.artifactPath, originalBytes);

  const registeredArtifactDir = dirname(registered.artifactPath);
  const registeredArtifactRealDir = join(dirname(registeredArtifactDir), 'artifacts-real');
  renameSync(registeredArtifactDir, registeredArtifactRealDir);
  symlinkSync(registeredArtifactRealDir, registeredArtifactDir, 'dir');
  await assert.rejects(
    () => coordinator.resolveArtifactRef(ref, { proofLineage: true }),
    (error) => error?.code === 'artifact_proof_unsafe_file_type'
  );
  assert.equal((await coordinator.resolveArtifactRef(ref)).artifact.exists, true);
  unlinkSync(registeredArtifactDir);
  renameSync(registeredArtifactRealDir, registeredArtifactDir);

  const sourceRefSha = 'b'.repeat(64);
  const artifactIdentity = createAfArtifactIdentityRecord({
    artifactType: 'review_pack',
    schemaVersion: '1.0',
    sourceArtifactRefs: [{
      artifact_type: 'config',
      path: 'configs/proof-part.toml',
      role: 'input',
      label: 'Proof config',
      sha256: sourceRefSha,
      size_bytes: 123,
    }],
    warnings: [],
    coverage: {},
    confidence: { level: 'high', score: 1, rationale: 'Fixture.' },
    lineage: {
      package_slug: 'proof-part',
      part_id: 'PROOF-001',
      revision: 'B',
      config_sha256: CONFIG_SHA256,
    },
    compatibility: { mode: 'canonical', markers: [] },
    revisionLineage: proofLineage(),
  });
  assert.equal(artifactIdentity.source_artifact_refs[0].sha256, sourceRefSha);
  assert.equal(artifactIdentity.source_artifact_refs[0].size_bytes, 123);
  assert.deepEqual(artifactIdentity.revision_lineage.identity, proofLineage().identity);

  const afLegacyPolicy = buildAfArtifactContractMetadata({
    jobType: 'review-context',
    target: 'review_pack',
    artifactIdentity,
  });
  assert.equal(afLegacyPolicy.af_contract.effective_policy, undefined);
  const afProofPolicy = buildAfArtifactContractMetadata({
    jobType: 'review-context',
    target: 'review_pack',
    artifactIdentity,
    effectivePolicy: { proof_lineage: true },
    sourceArtifactBinding: proofResolution.artifactBinding,
  });
  assert.deepEqual(afProofPolicy.af_contract.effective_policy, { proof_lineage: true });
  assert.equal(
    afProofPolicy.af_contract.source_artifact_binding.sha256,
    proofResolution.artifactBinding.sha256
  );

  const proofManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'review-context',
    jobType: 'review-context',
    status: 'succeeded',
    effectivePolicy: { proof_lineage: true },
    revisionLineage: proofLineage(),
  });
  assert.equal(validateArtifactManifest(proofManifest).ok, true);
  assert.deepEqual(proofManifest.effective_policy, { proof_lineage: true });
  await assert.rejects(
    () => buildArtifactManifest({
      projectRoot: ROOT,
      interface: 'api',
      command: 'review-context',
      jobType: 'review-context',
      status: 'succeeded',
      effectivePolicy: { proof_lineage: true },
    }),
    /revision_lineage/
  );
  const failedProofManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'review-context',
    jobType: 'review-context',
    status: 'failed',
    effectivePolicy: { proof_lineage: true },
  });
  assert.equal(validateArtifactManifest(failedProofManifest).ok, true);
  assert.deepEqual(failedProofManifest.effective_policy, { proof_lineage: true });
  assert.equal(Object.hasOwn(failedProofManifest, 'revision_lineage'), false);
  const lineageOnlyManifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'api',
    command: 'review-context',
    jobType: 'review-context',
    status: 'succeeded',
    revisionLineage: proofLineage(),
  });
  assert.equal(lineageOnlyManifest.effective_policy, undefined);

  const proofOutputManifest = await buildOutputManifest({
    projectRoot: ROOT,
    command: 'review-context',
    status: 'pass',
    effectivePolicy: { proof_lineage: true },
    revisionLineage: proofLineage(),
  });
  assert.equal(validateOutputManifest(proofOutputManifest).ok, true);
  assert.deepEqual(proofOutputManifest.revision_lineage.identity, proofLineage().identity);
  await assert.rejects(
    () => buildOutputManifest({
      projectRoot: ROOT,
      command: 'review-context',
      status: 'pass',
      effectivePolicy: { proof_lineage: true },
    }),
    /revision_lineage/
  );
  const failedProofOutputManifest = await buildOutputManifest({
    projectRoot: ROOT,
    command: 'review-context',
    status: 'fail',
    errors: ['Upstream proof validation failed.'],
    effectivePolicy: { proof_lineage: true },
  });
  assert.equal(validateOutputManifest(failedProofOutputManifest).ok, true);
  assert.deepEqual(failedProofOutputManifest.effective_policy, { proof_lineage: true });
  assert.equal(Object.hasOwn(failedProofOutputManifest, 'revision_lineage'), false);

  const portableRuntime = {
    available: true,
    executable_detected: true,
    probe_status: 'usable',
    status: 'ready',
    mode: 'macos-bundle',
    source: 'auto-detect',
    executable: '/Applications/FreeCAD.app/Contents/Resources/bin/python',
    python_executable: '/Applications/FreeCAD.app/Contents/Resources/bin/python',
    runtime_executable: '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
    gui_executable: '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
    description: 'FreeCAD runtime (/Applications/FreeCAD.app/Contents/MacOS/FreeCAD)',
    checked_candidates: ['/Applications/FreeCAD.app/Contents/MacOS/FreeCAD', '/Users/private/bin/freecad'],
    version_details: { freecad: { version: '1.1.0' } },
  };
  const portableRuns = [join(TMP_ROOT, 'portable-a'), join(TMP_ROOT, 'portable-b')];
  for (const runDir of portableRuns) {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'artifact.json'), '{"portable":true}\n');
    writeFileSync(join(runDir, 'input.json'), '{"source":true}\n');
    writeFileSync(join(runDir, 'linked.json'), '{"linked":true}\n');
  }
  const portableArtifactManifests = await Promise.all(portableRuns.map((runDir) => buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'cli',
    command: 'review-context',
    jobType: 'review-context',
    status: 'succeeded',
    configPath: join(ROOT, 'package.json'),
    effectivePolicy: { proof_lineage: true },
    revisionLineage: proofLineage(),
    portablePathRoot: runDir,
    runtimeDiagnostics: portableRuntime,
    artifacts: [{ type: 'review-pack.json', path: join(runDir, 'artifact.json') }],
    details: { source_path: join(runDir, 'input.json') },
    related: { output_path: join(runDir, 'linked.json') },
    timestamps: {
      created_at: '2026-07-27T00:00:00Z',
      started_at: '2026-07-27T00:00:00Z',
      finished_at: '2026-07-27T00:00:00Z',
    },
  })));
  assert.deepEqual(portableArtifactManifests[0], portableArtifactManifests[1]);
  assert.equal(portableArtifactManifests[0].config_path, 'repo/package.json');
  assert.equal(portableArtifactManifests[0].artifacts[0].path, 'run/artifact.json');
  assert.equal(portableArtifactManifests[0].details.source_path, 'run/input.json');
  assert.equal(portableArtifactManifests[0].runtime.node_path, 'runtime/node');
  assert.deepEqual(portableArtifactManifests[0].runtime.freecad.checked_candidates, []);
  assert.equal(JSON.stringify(portableArtifactManifests[0]).includes('/Applications/'), false);
  assert.equal(JSON.stringify(portableArtifactManifests[0]).includes(TMP_ROOT), false);

  const portableOutputManifests = await Promise.all(portableRuns.map((runDir) => buildOutputManifest({
    projectRoot: ROOT,
    repoContext: {
      root: runDir,
      branch: 'codex/revision-lineage-hardening',
      headSha: 'f'.repeat(40),
      dirtyAtStart: false,
    },
    command: 'review-context',
    commandArgs: ['--input', join(runDir, 'input.json'), '--out', join(runDir, 'artifact.json')],
    inputPath: join(runDir, 'input.json'),
    outputs: [{ kind: 'review-pack.json', path: join(runDir, 'artifact.json') }],
    linkedArtifacts: { report_summary_json: join(runDir, 'linked.json') },
    status: 'pass',
    effectivePolicy: { proof_lineage: true },
    revisionLineage: proofLineage(),
    portablePathRoot: runDir,
    runtimeDiagnostics: portableRuntime,
    timings: {
      startedAt: '2026-07-27T00:00:00Z',
      finishedAt: '2026-07-27T00:00:00Z',
    },
  })));
  assert.deepEqual(portableOutputManifests[0], portableOutputManifests[1]);
  assert.equal(portableOutputManifests[0].input.path, 'run/input.json');
  assert.equal(portableOutputManifests[0].outputs[0].path, 'run/artifact.json');
  assert.equal(portableOutputManifests[0].linked_artifacts.report_summary_json, 'run/linked.json');
  assert.match(portableOutputManifests[0].run_id, /^proof-[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(portableOutputManifests[0]).includes(TMP_ROOT), false);

  const validBundle = createProofBundle();
  const registeredBundle = await registerArtifact(store, {
    fileName: 'release_bundle.zip',
    bytes: validBundle.bytes,
    type: 'release-bundle.zip',
    metadata: { af_contract: { reentry_target: 'release_bundle' } },
  });
  const bundleRef = {
    job_id: registeredBundle.job.id,
    artifact_id: registeredBundle.artifact.id,
  };
  const bundleResolution = await coordinator.resolveArtifactRef(bundleRef, { proofLineage: true });
  const consumerJob = await store.createJob({ type: 'readiness-pack', options: { proof_lineage: true } });
  const extracted = await resolveBundleBackedCanonicalPath({
    jobStore: store,
    jobId: consumerJob.id,
    inputPath: registeredBundle.artifactPath,
    target: 'readiness_report',
    proofLineage: true,
    sourceArtifactBinding: bundleResolution.artifactBinding,
  });
  assert.deepEqual(readFileSync(extracted.path), validBundle.readinessBytes);
  assert.equal(extracted.importRecord.proof_verified, true);
  assert.equal(extracted.importRecord.bundle_sha256, sha256(validBundle.bytes));

  const bundleRealDir = join(TMP_ROOT, 'bundle-source-real');
  const bundleLinkDir = join(TMP_ROOT, 'bundle-source-link');
  const bundleAncestorSymlinkPath = join(bundleLinkDir, 'release_bundle.zip');
  mkdirSync(bundleRealDir, { recursive: true });
  writeFileSync(join(bundleRealDir, 'release_bundle.zip'), validBundle.bytes);
  symlinkSync(bundleRealDir, bundleLinkDir, 'dir');
  const rejectedConsumerJob = await store.createJob({
    type: 'readiness-pack',
    options: { proof_lineage: true },
  });
  const rejectedImportPath = join(
    store.getJobDir(rejectedConsumerJob.id),
    'imports',
    'readiness_report.json'
  );
  await assert.rejects(
    () => resolveBundleBackedCanonicalPath({
      jobStore: store,
      jobId: rejectedConsumerJob.id,
      inputPath: bundleAncestorSymlinkPath,
      target: 'readiness_report',
      proofLineage: true,
    }),
    (error) => error?.code === 'bundle_proof_path_unsafe'
  );
  assert.equal(existsSync(rejectedImportPath), false);

  for (const [label, options, expectedCode] of [
    ['manifest', { tamperManifest: true }, 'bundle_proof_policy_missing'],
    ['checksums', { tamperChecksums: true }, 'bundle_proof_checksum_binding_mismatch'],
    ['member', { tamperMember: true }, 'bundle_proof_member_digest_mismatch'],
  ]) {
    const tampered = createProofBundle(options);
    const registeredTampered = await registerArtifact(store, {
      fileName: `release_bundle_${label}.zip`,
      bytes: tampered.bytes,
      type: 'release-bundle.zip',
      metadata: { af_contract: { reentry_target: 'release_bundle' } },
    });
    const tamperedRef = {
      job_id: registeredTampered.job.id,
      artifact_id: registeredTampered.artifact.id,
    };
    const tamperedResolution = await coordinator.resolveArtifactRef(tamperedRef, { proofLineage: true });
    await assert.rejects(
      () => inspectCanonicalBundle(registeredTampered.artifactPath, {
        proofLineage: true,
        jobStore: store,
        sourceArtifactBinding: tamperedResolution.artifactBinding,
      }),
      (error) => error?.code === expectedCode,
      `${label} tampering should fail with ${expectedCode}`
    );
    const legacyInspection = await inspectCanonicalBundle(registeredTampered.artifactPath);
    assert.equal(legacyInspection.entryNames.includes('release_bundle_manifest.json'), true);
  }

  writeFileSync(registeredBundle.artifactPath, createProofBundle({ tamperMember: true }).bytes);
  await assert.rejects(
    () => inspectCanonicalBundle(registeredBundle.artifactPath, {
      proofLineage: true,
      jobStore: store,
      sourceArtifactBinding: bundleResolution.artifactBinding,
    }),
    (error) => error?.code === 'artifact_proof_bytes_changed'
  );

  console.log('revision-lineage-reentry.test.js: ok');
} finally {
  rmSync(TMP_ROOT, { recursive: true, force: true });
}
