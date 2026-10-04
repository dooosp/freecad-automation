import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { prepareTrackedReportAnalysisResults } from '../src/services/jobs/job-executor.js';

{
  const explicit = {
    dfm: {
      score: 88,
    },
  };
  const result = await prepareTrackedReportAnalysisResults({
    projectRoot: '/tmp/freecad-automation',
    resolvedConfig: {
      config: {
        name: 'quality_pass_bracket',
      },
      configPath: '/tmp/freecad-automation/configs/examples/quality_pass_bracket.toml',
    },
    requestOptions: {
      include_dfm: true,
      analysis_results: explicit,
    },
    createDfmServiceFn: () => {
      throw new Error('should not run dfm when explicit analysis results already exist');
    },
  });

  assert.equal(result, explicit);
}

{
  let dfmCallCount = 0;
  const result = await prepareTrackedReportAnalysisResults({
    projectRoot: '/tmp/freecad-automation',
    resolvedConfig: {
      config: {
        name: 'quality_pass_bracket',
      },
      configPath: '/tmp/freecad-automation/configs/examples/quality_pass_bracket.toml',
    },
    requestOptions: {
      include_dfm: true,
    },
    createDfmServiceFn: () => async ({ config }) => {
      dfmCallCount += 1;
      assert.equal(config.name, 'quality_pass_bracket');
      return {
        score: 100,
        issues: [],
        summary: {
          severity_counts: {
            critical: 0,
            major: 0,
            minor: 0,
            info: 0,
          },
        },
      };
    },
  });

  assert.equal(dfmCallCount, 1);
  assert.equal(result.dfm.score, 100);
}

{
  const result = await prepareTrackedReportAnalysisResults({
    projectRoot: '/tmp/freecad-automation',
    resolvedConfig: {
      config: {
        name: 'quality_pass_bracket',
      },
      configPath: '/tmp/freecad-automation/configs/examples/quality_pass_bracket.toml',
    },
    requestOptions: {
      include_dfm: false,
    },
    createDfmServiceFn: () => {
      throw new Error('should not run dfm when include_dfm is false');
    },
  });

  assert.equal(result, null);
}

{
  const result = await prepareTrackedReportAnalysisResults({
    projectRoot: resolve(import.meta.dirname, '..'),
    resolvedConfig: {
      config: {
        name: 'casting_wall_process_probe',
        manufacturing: { process: 'casting', material: 'AL6061' },
        shapes: [
          { id: 'body', type: 'cylinder', radius: 10, height: 10 },
          { id: 'bore', type: 'cylinder', radius: 7.6, height: 12, position: [0, 0, -1] },
        ],
        operations: [{ op: 'cut', base: 'body', tool: 'bore', result: 'body' }],
      },
    },
    requestOptions: { full_quality: true, include_dfm: false, analysis_results: { dfm: { score: 100 } } },
  });
  assert.equal(result.dfm.resolved_process, 'casting');
  const wall = result.dfm.checks.find((check) => check.rule_id === 'DFM-01');
  assert.equal(wall.status, 'fail', '2.4 mm wall fails the captured casting process minimum');
  assert.equal(wall.actual_value, 2.4);
  assert.equal(wall.required_value, 3);
  assert.equal(result.dfm.summary.severity_counts.critical, 1);
  assert.equal(result.dfm.score, 80);
}

console.log('job-executor-report-analysis.test.js: ok');
