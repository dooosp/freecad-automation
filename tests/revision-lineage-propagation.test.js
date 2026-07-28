import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildArtifactManifest } from '../lib/artifact-manifest.js';
import { runPythonJsonScript } from '../lib/context-loader.js';
import { assertValidDArtifact } from '../lib/d-artifact-schema.js';
import { runReviewContextPipeline } from '../src/orchestration/review-context-pipeline.js';
import { createJobExecutor } from '../src/services/jobs/job-executor.js';
import { createJobStore } from '../src/services/jobs/job-store.js';
import { runStandardDocsWorkflow } from '../src/workflows/standard-docs-workflow.js';

const ROOT = resolve(import.meta.dirname, '..');
const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'fcad-revision-lineage-review-')));
const CONFIG_REF = 'configs/examples/proof_part.toml';
const selection = Object.freeze({
  package_directory: 'docs/examples/proof-package',
  package_slug: 'proof-package',
  part_id: 'proof_part',
  revision: 'B',
  authoritative_config_path: CONFIG_REF,
  generated_config_descendants: Object.freeze([
    'docs/examples/proof-package/config.toml',
  ]),
});

const configText = [
  'config_version = 1',
  'name = "proof_part"',
  '',
  '[product]',
  'package_slug = "proof-package"',
  'part_id = "proof_part"',
  'revision = "B"',
  '',
].join('\n');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function buildStubRunner() {
  return async (_projectRoot, scriptRelativePath, input, options = {}) => {
    if (scriptRelativePath.endsWith('analyze_part.py')) {
      return {
        geometry_intelligence: {
          generated_at: '2026-07-27T00:00:00Z',
          analysis_confidence: 'heuristic',
          confidence: {
            level: 'medium',
            score: 0.58,
            rationale: 'Synthetic proof-lineage propagation fixture.',
          },
          derived_features: [],
          metrics: {
            bounding_box_mm: { x: 12, y: 8, z: 3 },
            volume_mm3: 288,
            face_count: 6,
            edge_count: 12,
          },
          features: {
            hole_like_feature_count: 0,
            hole_pattern_count: 0,
            repeated_feature_count: 0,
            complexity_score: 0.2,
          },
          warnings: [],
        },
        manufacturing_hotspots: {
          confidence: {
            level: 'medium',
            score: 0.5,
            rationale: 'Synthetic proof-lineage propagation fixture.',
          },
          hotspots: [],
          warnings: [],
        },
      };
    }

    if (scriptRelativePath.endsWith('quality_link.py')) {
      return {
        inspection_linkage: { summary: {}, records: [] },
        inspection_outliers: { records: [] },
        quality_linkage: { summary: {}, records: [] },
        quality_hotspots: { records: [] },
        review_priorities: { records: [], recommended_actions: [] },
      };
    }

    if (scriptRelativePath.endsWith('scripts/reporting/review_pack.py')) {
      return runPythonJsonScript(ROOT, scriptRelativePath, input, options);
    }

    throw new Error(`Unexpected script request: ${scriptRelativePath}`);
  };
}

function pipelineOptions(outputPath, overrides = {}) {
  return {
    projectRoot: tempRoot,
    authoritativeConfigPath: CONFIG_REF,
    requireAuthoritativeLineage: true,
    proofLineageSelection: selection,
    contextPath: join(tempRoot, 'context.json'),
    outputPath,
    partId: 'proof_part',
    revision: 'B',
    runPythonJsonScript: buildStubRunner(),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
    ...overrides,
  };
}

async function registerTrackedArtifact(jobStore, {
  fileName,
  bytes,
  type,
  scope = 'user-facing',
  label = fileName,
}) {
  const producerJob = await jobStore.createJob({ type: 'report', config: { name: 'fixture' } });
  const artifactPath = await jobStore.writeJobFile(producerJob.id, `artifacts/${fileName}`, bytes);
  const manifest = await buildArtifactManifest({
    projectRoot: tempRoot,
    interface: 'api',
    command: 'report',
    jobType: 'report',
    status: 'succeeded',
    requestId: producerJob.id,
    artifacts: [{
      type,
      path: artifactPath,
      label,
      scope,
      stability: 'stable',
    }],
    timestamps: {
      created_at: producerJob.created_at,
      started_at: producerJob.created_at,
      finished_at: producerJob.created_at,
    },
  });
  await jobStore.completeJob(producerJob.id, { success: true }, {}, {}, manifest);
  const [artifact] = await jobStore.listArtifacts(producerJob.id);
  return { job: producerJob, artifact, artifactPath };
}

try {
  const configPath = join(tempRoot, CONFIG_REF);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, configText, 'utf8');
  writeFileSync(join(tempRoot, 'context.json'), `${JSON.stringify({
    metadata: {
      created_at: '2026-07-27T00:00:00Z',
      warnings: [],
      source_files: [],
    },
    part: {
      part_id: 'proof_part',
      name: 'proof_part',
      revision: 'B',
      material: 'AL6061',
      process: 'machining',
    },
    geometry_source: {
      path: null,
      file_type: 'fixture_metadata',
      model_metadata: {
        bounding_box: { size: [12, 8, 3] },
      },
      feature_hints: { cylinders: [], bolt_circles: [] },
    },
  }, null, 2)}\n`, 'utf8');

  const outputDir = join(tempRoot, 'output');
  const outputPath = join(outputDir, 'proof_review_pack.json');
  const stagedManifestPath = join(outputDir, 'proof_review_pack_artifact-manifest.json');
  const result = await runReviewContextPipeline(pipelineOptions(outputPath, {
    prepareProofPublicationOutputs: async ({ authoritativeConfig }) => [{
      path: stagedManifestPath,
      content: `${JSON.stringify({
        proof_lineage: {
          required: true,
          config_sha256: authoritativeConfig.sha256,
        },
      }, null, 2)}\n`,
    }],
  }));

  const reviewPack = JSON.parse(readFileSync(result.artifacts.reviewPackJson, 'utf8'));
  assertValidDArtifact('review_pack', reviewPack, { command: 'review-context' });
  const expectedConfigBytes = Buffer.from(configText, 'utf8');
  const expectedConfigSha = sha256(expectedConfigBytes);
  assert.deepEqual(reviewPack.revision_lineage, result.revisionLineage);
  assert.deepEqual(reviewPack.revision_lineage.identity, {
    package_slug: 'proof-package',
    part_id: 'proof_part',
    revision: 'B',
    config_sha256: expectedConfigSha,
  });
  assert.deepEqual(reviewPack.revision_lineage.parents, [{
    artifact_type: 'config',
    role: 'authoritative_config',
    path: CONFIG_REF,
    sha256: expectedConfigSha,
    size_bytes: expectedConfigBytes.length,
  }]);
  assert.equal(reviewPack.part_id, 'proof_part');
  assert.equal(reviewPack.part.package_slug, 'proof-package');
  assert.equal(reviewPack.part.part_id, 'proof_part');
  assert.equal(reviewPack.revision, 'B');
  assert.equal(reviewPack.part.revision, 'B');
  const configSourceRef = reviewPack.source_artifact_refs.find(
    (entry) => entry.artifact_type === 'config' && entry.path === CONFIG_REF
  );
  assert.deepEqual(configSourceRef, {
    artifact_type: 'config',
    path: CONFIG_REF,
    role: 'input',
    label: 'Authoritative proof-lineage config',
    sha256: expectedConfigSha,
    size_bytes: expectedConfigBytes.length,
  });
  assert.equal(existsSync(result.artifacts.reviewPackMarkdown), true);
  assert.equal(existsSync(result.artifacts.reviewPackPdf), true);
  assert.equal(existsSync(stagedManifestPath), true);
  assert.deepEqual(result.proofPublication.additional_artifacts, [stagedManifestPath]);

  const jobsDir = join(tempRoot, 'output', 'jobs');
  const jobStore = createJobStore({ jobsDir });
  const executor = createJobExecutor({ projectRoot: tempRoot, jobStore });
  const trackedContext = await registerTrackedArtifact(jobStore, {
    fileName: 'proof_context.json',
    bytes: readFileSync(join(tempRoot, 'context.json')),
    type: 'context.json',
  });
  const trackedContextBinding = (
    await jobStore.readVerifiedArtifactSnapshot(trackedContext.job.id, trackedContext.artifact.id)
  ).binding;
  writeFileSync(trackedContext.artifactPath, '{"broken":', 'utf8');
  const failedReviewContextJob = await jobStore.createJob({
    type: 'review-context',
    config_path: CONFIG_REF,
    context_path: trackedContext.artifactPath,
    options: {
      proof_lineage: true,
      studio: {
        source_artifact_binding: trackedContextBinding,
      },
    },
  });
  await executor.execute(failedReviewContextJob.id);
  const failedReviewContext = await jobStore.getJob(failedReviewContextJob.id);
  assert.equal(failedReviewContext.status, 'failed');
  assert.match(failedReviewContext.error.message, /registered bytes/i);
  assert.equal(
    existsSync(join(jobStore.getJobDir(failedReviewContextJob.id), 'artifacts', 'review_pack.json')),
    false
  );

  const originalReviewPackBytes = readFileSync(result.artifacts.reviewPackJson);
  const trackedReviewPack = await registerTrackedArtifact(jobStore, {
    fileName: 'proof_review_pack.json',
    bytes: originalReviewPackBytes,
    type: 'review-pack.json',
  });
  const trackedReviewPackBinding = (
    await jobStore.readVerifiedArtifactSnapshot(trackedReviewPack.job.id, trackedReviewPack.artifact.id)
  ).binding;
  const originalReadVerifiedArtifactSnapshot = jobStore.readVerifiedArtifactSnapshot;
  let mutatedAfterSnapshot = false;
  jobStore.readVerifiedArtifactSnapshot = async (...args) => {
    const snapshot = await originalReadVerifiedArtifactSnapshot(...args);
    if (
      mutatedAfterSnapshot === false
      && args[0] === trackedReviewPack.job.id
      && args[1] === trackedReviewPack.artifact.id
    ) {
      mutatedAfterSnapshot = true;
      writeFileSync(
        trackedReviewPack.artifactPath,
        '{"artifact_type":"review_pack","tampered_after_snapshot":true}\n',
        'utf8'
      );
    }
    return snapshot;
  };
  const readinessJob = await jobStore.createJob({
    type: 'readiness-pack',
    review_pack_path: trackedReviewPack.artifactPath,
    options: {
      proof_lineage: true,
      studio: {
        source_artifact_binding: trackedReviewPackBinding,
      },
    },
  });
  await executor.execute(readinessJob.id);
  jobStore.readVerifiedArtifactSnapshot = originalReadVerifiedArtifactSnapshot;
  const completedReadiness = await jobStore.getJob(readinessJob.id);
  assert.equal(completedReadiness.status, 'succeeded', completedReadiness.error?.message);
  assert.equal(mutatedAfterSnapshot, true);
  assert.notDeepEqual(readFileSync(trackedReviewPack.artifactPath), originalReviewPackBytes);
  assert.deepEqual(
    readFileSync(join(jobStore.getJobDir(readinessJob.id), 'artifacts', 'review_pack.json')),
    originalReviewPackBytes
  );
  const readinessReport = JSON.parse(readFileSync(completedReadiness.artifacts.readiness_report, 'utf8'));
  assert.deepEqual(readinessReport.revision_lineage.identity, reviewPack.revision_lineage.identity);
  assert.deepEqual(completedReadiness.manifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(completedReadiness.manifest.revision_lineage, readinessReport.revision_lineage);
  assert.equal(
    completedReadiness.diagnostics.proof_lineage_policy.config_sha256,
    expectedConfigSha
  );
  const readinessManifestEntry = completedReadiness.manifest.artifacts.find(
    (entry) => entry.type === 'readiness-report.json'
  );
  assert.deepEqual(
    readinessManifestEntry.metadata.af_contract.effective_policy,
    { proof_lineage: true }
  );
  assert.deepEqual(
    readinessReport.revision_lineage.parents.find((parent) => parent.role === 'review_pack'),
    {
      artifact_type: 'review_pack',
      role: 'review_pack',
      path: 'run/review_pack.json',
      sha256: sha256(readFileSync(result.artifacts.reviewPackJson)),
      size_bytes: readFileSync(result.artifacts.reviewPackJson).length,
    }
  );

  const readinessReportPath = completedReadiness.artifacts.readiness_report;
  const readinessReportRef = relative(tempRoot, readinessReportPath).replaceAll('\\', '/');
  const standardDocsDir = join(outputDir, 'standard-docs');
  const standardDocsGeneratedAt = '2026-07-27T01:02:03.000Z';
  const runProofStandardDocs = (overrides = {}) => runStandardDocsWorkflow({
    freecadRoot: tempRoot,
    runScript: buildStubRunner(),
    loadConfig: async () => {
      throw new Error('proof standard docs must use the authoritative config snapshot');
    },
    configPath: CONFIG_REF,
    config: null,
    options: {
      outDir: standardDocsDir,
      report: readinessReport,
      reportPath: readinessReportRef,
      generatedAt: standardDocsGeneratedAt,
      requireAuthoritativeLineage: true,
      lineageSelection: selection,
      ...overrides,
    },
  });
  const standardDocs = await runProofStandardDocs();
  assert.deepEqual(standardDocs.manifest.effective_policy, { proof_lineage: true });
  assert.equal(standardDocs.manifest.generated_at, standardDocsGeneratedAt);
  assert.deepEqual(
    standardDocs.manifest.revision_lineage.identity,
    readinessReport.revision_lineage.identity
  );
  const readinessConfigParent = readinessReport.revision_lineage.parents.find(
    (parent) => parent.role === 'authoritative_config'
  );
  const docsConfigParent = standardDocs.manifest.revision_lineage.parents.find(
    (parent) => parent.role === 'authoritative_config'
  );
  assert.deepEqual(docsConfigParent, readinessConfigParent);
  const readinessBytes = readFileSync(readinessReportPath);
  const docsReadinessParent = standardDocs.manifest.revision_lineage.parents.find(
    (parent) => parent.role === 'readiness_report'
  );
  assert.deepEqual(docsReadinessParent, {
    artifact_type: 'readiness_report',
    role: 'readiness_report',
    path: 'run/readiness_report.json',
    sha256: sha256(readinessBytes),
    size_bytes: readinessBytes.length,
  });
  assert.deepEqual(
    standardDocs.manifest.source_artifact_refs.find(
      (ref) => ref.artifact_type === 'readiness_report'
    ),
    {
      artifact_type: 'readiness_report',
      path: 'run/readiness_report.json',
      role: 'input',
      label: 'Canonical readiness report JSON',
      sha256: sha256(readinessBytes),
      size_bytes: readinessBytes.length,
    }
  );

  const trackedInspectionReviewPack = await registerTrackedArtifact(jobStore, {
    fileName: 'inspection_review_pack.json',
    bytes: readFileSync(result.artifacts.reviewPackJson),
    type: 'review-pack.json',
  });
  const trackedInspectionReviewPackBinding = (
    await jobStore.readVerifiedArtifactSnapshot(
      trackedInspectionReviewPack.job.id,
      trackedInspectionReviewPack.artifact.id
    )
  ).binding;
  writeFileSync(trackedInspectionReviewPack.artifactPath, '{"artifact_type":"review_pack","tampered":', 'utf8');
  const failedInspectionPlanJob = await jobStore.createJob({
    type: 'inspection-plan',
    review_pack_path: trackedInspectionReviewPack.artifactPath,
    readiness_report_path: readinessReportRef,
    config_path: CONFIG_REF,
    options: {
      proof_lineage: true,
      studio: {
        source_artifact_binding: trackedInspectionReviewPackBinding,
      },
    },
  });
  await executor.execute(failedInspectionPlanJob.id);
  const failedInspectionPlan = await jobStore.getJob(failedInspectionPlanJob.id);
  assert.equal(failedInspectionPlan.status, 'failed');
  assert.match(failedInspectionPlan.error.message, /registered bytes/i);
  assert.equal(
    existsSync(join(jobStore.getJobDir(failedInspectionPlanJob.id), 'artifacts', 'inspection_plan.json')),
    false
  );

  const trackedReadiness = await registerTrackedArtifact(jobStore, {
    fileName: 'tracked_readiness_report.json',
    bytes: readFileSync(readinessReportPath),
    type: 'readiness-report.json',
  });
  const trackedReadinessBinding = (
    await jobStore.readVerifiedArtifactSnapshot(trackedReadiness.job.id, trackedReadiness.artifact.id)
  ).binding;

  const trackedDocsManifest = await registerTrackedArtifact(jobStore, {
    fileName: 'tracked_standard_docs_manifest.json',
    bytes: readFileSync(standardDocs.artifacts.manifest),
    type: 'docs-manifest.json',
  });
  const trackedDocsManifestBinding = (
    await jobStore.readVerifiedArtifactSnapshot(
      trackedDocsManifest.job.id,
      trackedDocsManifest.artifact.id
    )
  ).binding;
  writeFileSync(trackedReadiness.artifactPath, '{"artifact_type":"readiness_report","tampered":', 'utf8');
  const failedBoundPackJob = await jobStore.createJob({
    type: 'pack',
    readiness_report_path: trackedReadiness.artifactPath,
    docs_manifest_path: trackedDocsManifest.artifactPath,
    options: {
      proof_lineage: true,
      studio: {
        source_artifact_binding: trackedReadinessBinding,
        docs_manifest_artifact_binding: trackedDocsManifestBinding,
      },
    },
  });
  await executor.execute(failedBoundPackJob.id);
  const failedBoundPack = await jobStore.getJob(failedBoundPackJob.id);
  assert.equal(failedBoundPack.status, 'failed');
  assert.match(failedBoundPack.error.message, /registered bytes/i);
  assert.equal(
    existsSync(join(jobStore.getJobDir(failedBoundPackJob.id), 'artifacts', 'release_bundle.zip')),
    false
  );

  const standardDocsPaths = Object.values(standardDocs.artifacts);
  const originalStandardDocsBytes = new Map(
    standardDocsPaths.map((path) => [path, readFileSync(path)])
  );
  await runProofStandardDocs();
  for (const [path, bytes] of originalStandardDocsBytes) {
    assert.deepEqual(readFileSync(path), bytes, `proof standard-docs rerun must be deterministic for ${path}`);
  }
  await assert.rejects(
    () => runProofStandardDocs({
      publicationHooks: {
        afterCommit: ({ index }) => {
          if (index === 1) throw new Error('injected standard-docs publication failure');
        },
      },
    }),
    /injected standard-docs publication failure/
  );
  for (const [path, bytes] of originalStandardDocsBytes) {
    assert.deepEqual(readFileSync(path), bytes, `standard-docs rollback must restore ${path}`);
  }

  await assert.rejects(
    () => runProofStandardDocs({
      prepareProofPublicationOutputs: async () => {
        writeFileSync(readinessReportPath, Buffer.concat([readinessBytes, Buffer.from(' ')]));
        return [];
      },
    }),
    (error) => error?.code === 'stale_parent'
  );
  for (const [path, bytes] of originalStandardDocsBytes) {
    assert.deepEqual(readFileSync(path), bytes, `stale readiness must not alter ${path}`);
  }
  writeFileSync(readinessReportPath, readinessBytes);

  const tamperedReadiness = structuredClone(readinessReport);
  tamperedReadiness.revision_lineage.parents.find(
    (parent) => parent.role === 'authoritative_config'
  ).sha256 = '0'.repeat(64);
  const tamperedReadinessPath = join(outputDir, 'tampered_readiness.json');
  writeFileSync(tamperedReadinessPath, `${JSON.stringify(tamperedReadiness, null, 2)}\n`, 'utf8');
  const tamperedDocsDir = join(outputDir, 'tampered-standard-docs');
  await assert.rejects(
    () => runProofStandardDocs({
      outDir: tamperedDocsDir,
      report: tamperedReadiness,
      reportPath: relative(tempRoot, tamperedReadinessPath).replaceAll('\\', '/'),
    }),
    (error) => error?.code === 'digest_mismatch'
  );
  assert.equal(existsSync(tamperedDocsDir), false);

  const legacyProofInputPath = join(outputDir, 'legacy_proof_input.json');
  const legacyProofInput = structuredClone(reviewPack);
  delete legacyProofInput.revision_lineage;
  writeFileSync(legacyProofInputPath, `${JSON.stringify(legacyProofInput, null, 2)}\n`, 'utf8');
  const failedReadinessJob = await jobStore.createJob({
    type: 'readiness-pack',
    review_pack_path: relative(tempRoot, legacyProofInputPath).replaceAll('\\', '/'),
    options: { proof_lineage: true },
  });
  await executor.execute(failedReadinessJob.id);
  const failedReadiness = await jobStore.getJob(failedReadinessJob.id);
  assert.equal(failedReadiness.status, 'failed');
  assert.match(failedReadiness.error.message, /revision_lineage|proof readiness/i);
  assert.deepEqual(failedReadiness.manifest.effective_policy, { proof_lineage: true });
  assert.equal(Object.hasOwn(failedReadiness.manifest, 'revision_lineage'), false);
  assert.equal(existsSync(join(jobStore.getJobDir(failedReadinessJob.id), 'artifacts', 'readiness_report.json')), false);

  const publishedPaths = [
    ...Object.values(result.artifacts).filter(Boolean),
    stagedManifestPath,
  ];
  const originalBytes = new Map(
    publishedPaths.map((path) => [path, readFileSync(path)])
  );
  await runReviewContextPipeline(pipelineOptions(outputPath, {
    prepareProofPublicationOutputs: async ({ authoritativeConfig }) => [{
      path: stagedManifestPath,
      content: `${JSON.stringify({
        proof_lineage: {
          required: true,
          config_sha256: authoritativeConfig.sha256,
        },
      }, null, 2)}\n`,
    }],
  }));
  for (const [path, bytes] of originalBytes) {
    assert.deepEqual(readFileSync(path), bytes, `proof review rerun must be deterministic for ${path}`);
  }
  await assert.rejects(
    () => runReviewContextPipeline(pipelineOptions(outputPath, {
      prepareProofPublicationOutputs: async () => [{
        path: stagedManifestPath,
        content: '{"should_not_publish":true}\n',
      }],
      proofPublicationHooks: {
        afterCommit: async ({ index }) => {
          if (index === 0) throw new Error('injected proof publication failure');
        },
      },
    })),
    /injected proof publication failure/
  );
  for (const [path, bytes] of originalBytes) {
    assert.deepEqual(readFileSync(path), bytes, `atomic rollback must restore ${path}`);
  }
  assert.equal(
    readdirSync(outputDir).some((name) => name.startsWith('.fcad-review-context-stage-')),
    false,
    'proof staging directories must be removed after rollback'
  );
  assert.equal(
    readdirSync(outputDir).some((name) => name.includes('.transaction.json') || name.endsWith('.lock')),
    false,
    'proof transaction controls must be removed after rollback'
  );

  const conflictOutput = join(outputDir, 'conflicting_review_pack.json');
  await assert.rejects(
    () => runReviewContextPipeline(pipelineOptions(conflictOutput, {
      partId: 'wrong_part',
    })),
    (error) => error?.code === 'conflicting_identity'
  );
  assert.equal(existsSync(conflictOutput), false);

  const missingPackageSlugOutput = join(outputDir, 'missing_package_slug_review_pack.json');
  const normalRunner = buildStubRunner();
  await assert.rejects(
    () => runReviewContextPipeline(pipelineOptions(missingPackageSlugOutput, {
      runPythonJsonScript: async (...args) => {
        const response = await normalRunner(...args);
        if (String(args[1]).endsWith('scripts/reporting/review_pack.py')) {
          const altered = structuredClone(response);
          delete altered.summary.part.package_slug;
          return altered;
        }
        return response;
      },
    })),
    (error) => error?.code === 'missing_identity'
  );
  assert.equal(existsSync(missingPackageSlugOutput), false);

  const staleOutput = join(outputDir, 'stale_review_pack.json');
  await assert.rejects(
    () => runReviewContextPipeline(pipelineOptions(staleOutput, {
      prepareProofPublicationOutputs: async () => {
        writeFileSync(configPath, `${configText}# injected mutation\n`, 'utf8');
        return [];
      },
    })),
    (error) => error?.code === 'stale_parent'
  );
  assert.equal(existsSync(staleOutput), false);
  writeFileSync(configPath, configText, 'utf8');

  const legacyOutput = join(outputDir, 'legacy_review_pack.json');
  const legacy = await runReviewContextPipeline({
    projectRoot: tempRoot,
    contextPath: join(tempRoot, 'context.json'),
    outputPath: legacyOutput,
    runPythonJsonScript: buildStubRunner(),
    inspectModelIfAvailable: async () => null,
    detectStepFeaturesIfAvailable: async () => null,
  });
  const legacyReviewPack = JSON.parse(readFileSync(legacy.artifacts.reviewPackJson, 'utf8'));
  assert.equal(Object.hasOwn(legacyReviewPack, 'revision_lineage'), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('revision-lineage-propagation.test.js: ok');
