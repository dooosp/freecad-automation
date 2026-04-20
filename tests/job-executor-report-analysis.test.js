import assert from 'node:assert/strict';

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

console.log('job-executor-report-analysis.test.js: ok');
