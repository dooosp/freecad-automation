import { runScript } from './shared.js';

export function createReportCases(assert) {
  async function testEngineeringReport() {
    console.log('\n--- Test: Engineering PDF report ---');

    const result = await runScript('report_test.py', {}, {
      onStderr: (text) => process.stderr.write(`    ${text}`),
    });

    assert(result.success === true, 'Report test succeeded');
    assert(result.size_bytes > 10_000, `PDF size > 10KB (got ${result.size_bytes} bytes)`);
    assert(result.pdf_path.endsWith('_report.pdf'), `PDF path ends with _report.pdf`);
  }

  return [
    ['Engineering report', testEngineeringReport],
  ];
}
