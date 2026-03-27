import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { OUTPUT_DIR, loadExampleConfig, runScript } from './shared.js';

export function createAnalysisCases(assert) {
  async function testFemAnalysis() {
    console.log('\n--- Test: FEM static analysis ---');

    const config = await loadExampleConfig('configs/examples/bracket_fem.toml');

    const result = await runScript('fem_analysis.py', config, {
      timeout: 300_000,
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'FEM analysis succeeded');
    assert(result.model.name === 'bracket_fem', 'Model name matches');
    assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);

    assert(result.fem !== undefined, 'FEM results present');
    assert(result.fem.analysis_type === 'static', 'Analysis type is static');
    assert(result.fem.mesh.nodes > 0, `Mesh has nodes (${result.fem.mesh.nodes})`);
    assert(result.fem.mesh.elements > 0, `Mesh has elements (${result.fem.mesh.elements})`);
    assert(result.fem.results.displacement.max > 0, `Max displacement > 0 (${result.fem.results.displacement.max})`);
    assert(result.fem.results.von_mises.max > 0, `Max von Mises > 0 (${result.fem.results.von_mises.max})`);
    assert(result.fem.results.safety_factor > 0, `Safety factor > 0 (${result.fem.results.safety_factor})`);

    const fcstdPath = resolve(OUTPUT_DIR, 'bracket_fem.FCStd');
    assert(existsSync(fcstdPath), 'FCStd file saved with results');
  }

  async function testToleranceDB() {
    console.log('\n--- Test: ISO 286 Tolerance Database ---');

    const result = await runScript('tolerance_db_test.py', {}, {
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'Tolerance DB test succeeded');

    const h7 = result.tests.h7_20;
    assert(h7.upper === 0.021, `Dia20 H7 upper = +0.021 (got ${h7.upper})`);
    assert(h7.lower === 0.0, `Dia20 H7 lower = 0.000 (got ${h7.lower})`);

    const g6 = result.tests.g6_20;
    assert(g6.upper === -0.007, `Dia20 g6 upper = -0.007 (got ${g6.upper})`);
    assert(g6.lower === -0.02, `Dia20 g6 lower = -0.020 (got ${g6.lower})`);

    const fit = result.tests.fit_h7g6_20;
    assert(fit.fit_type === 'clearance', `H7/g6 is clearance fit (got ${fit.fit_type})`);
    assert(fit.clearance_min === 0.007, `Min clearance = 0.007 (got ${fit.clearance_min})`);
    assert(fit.clearance_max === 0.041, `Max clearance = 0.041 (got ${fit.clearance_max})`);

    const fit2 = result.tests.fit_h7p6_20;
    assert(fit2.fit_type === 'interference', `H7/p6 is interference fit (got ${fit2.fit_type})`);

    assert(result.tests.fuzzy_20 === 20, `fuzzy 19.998 -> 20 (got ${result.tests.fuzzy_20})`);
  }

  async function testTolerancePairDetection() {
    console.log('\n--- Test: Tolerance pair detection from assembly ---');

    const config = await loadExampleConfig('configs/examples/ptu_assembly_mates.toml');

    const result = await runScript('tolerance_analysis.py', config, {
      timeout: 120_000,
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'Tolerance analysis succeeded');
    assert(Array.isArray(result.pairs), 'Has pairs array');

    const coaxialPairs = result.pairs.filter((pair) => pair.nominal_d > 0);
    assert(coaxialPairs.length > 0, `Found ${coaxialPairs.length} tolerance pair(s)`);

    if (coaxialPairs.length > 0) {
      const pair = coaxialPairs[0];
      assert(pair.bore_part !== undefined, 'Pair has bore_part');
      assert(pair.shaft_part !== undefined, 'Pair has shaft_part');
      assert(pair.fit_type !== undefined, `Pair has fit_type (${pair.fit_type})`);
      assert(pair.clearance_min !== undefined, 'Pair has clearance_min');
      assert(pair.spec !== undefined, `Pair has spec (${pair.spec})`);
    }
  }

  async function testToleranceFitAnalysis() {
    console.log('\n--- Test: Fit analysis accuracy ---');

    const config = await loadExampleConfig('configs/examples/ptu_assembly_mates.toml');
    config.tolerance = { specs: {}, recommend: true };

    const result = await runScript('tolerance_analysis.py', config, {
      timeout: 120_000,
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'Fit analysis succeeded');

    for (const pairResult of result.pairs || []) {
      if (pairResult.clearance_min > 0) {
        assert(pairResult.fit_type === 'clearance', `Positive min clearance -> clearance fit (${pairResult.spec})`);
      } else if (pairResult.clearance_max < 0) {
        assert(pairResult.fit_type === 'interference', `Negative max clearance -> interference fit (${pairResult.spec})`);
      } else {
        assert(pairResult.fit_type === 'transition', `Mixed clearance -> transition fit (${pairResult.spec})`);
      }
    }
  }

  async function testToleranceStackUp() {
    console.log('\n--- Test: Tolerance stack-up calculation ---');

    const result = await runScript('tolerance_stackup_test.py', {}, {
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'Stack-up test succeeded');
    const stackUp = result.stack_up;
    assert(stackUp.chain_length === 3, `Chain length = 3 (got ${stackUp.chain_length})`);
    assert(stackUp.worst_case_mm > 0, `Worst case > 0 (${stackUp.worst_case_mm})`);
    assert(stackUp.rss_3sigma_mm > 0, `RSS > 0 (${stackUp.rss_3sigma_mm})`);
    assert(stackUp.rss_3sigma_mm <= stackUp.worst_case_mm, 'RSS <= worst case');
    assert(stackUp.success_rate_pct > 95, `Success rate > 95% (${stackUp.success_rate_pct})`);
  }

  async function testToleranceMonteCarlo() {
    console.log('\n--- Test: Monte Carlo tolerance simulation ---');

    const result = await runScript('tolerance_mc_test.py', {}, {
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'MC test succeeded');
    const mc = result.mc_result;
    assert(mc.chain_length === 3, `Chain length = 3 (got ${mc.chain_length})`);
    assert(mc.num_samples === 10000, `Samples = 10000 (got ${mc.num_samples})`);
    assert(mc.mean_mm > 0, `Mean gap > 0 (${mc.mean_mm})`);
    assert(mc.fail_rate_pct < 5, `Fail rate < 5% (${mc.fail_rate_pct})`);
    assert(mc.cpk >= 0.5, `Cpk >= 0.5 (${mc.cpk})`);
    assert(mc.histogram.counts.length === 20, `Histogram 20 bins (got ${mc.histogram.counts.length})`);
    assert(mc.histogram.edges.length === 21, `Histogram 21 edges (got ${mc.histogram.edges.length})`);

    const percentiles = mc.percentiles;
    assert(percentiles.p0_1 <= percentiles.p1, 'P0.1 <= P1');
    assert(percentiles.p1 <= percentiles.p50, 'P1 <= P50');
    assert(percentiles.p50 <= percentiles.p99, 'P50 <= P99');
    assert(percentiles.p99 <= percentiles.p99_9, 'P99 <= P99.9');

    const total = mc.histogram.counts.reduce((sum, count) => sum + count, 0);
    assert(total === 10000, `Histogram sum = 10000 (got ${total})`);
  }

  return [
    ['FEM analysis', testFemAnalysis],
    ['Tolerance DB', testToleranceDB],
    ['Tolerance pair detection', testTolerancePairDetection],
    ['Tolerance fit analysis', testToleranceFitAnalysis],
    ['Tolerance stack-up', testToleranceStackUp],
    ['Tolerance Monte Carlo', testToleranceMonteCarlo],
  ];
}
