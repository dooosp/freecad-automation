#!/usr/bin/env node

import {
  maintainerDoctorUsage,
  parseMaintainerDoctorArgs,
  runMaintainerDoctor,
} from '../lib/maintainer-doctor.js';

async function main() {
  const options = parseMaintainerDoctorArgs(process.argv.slice(2));
  if (options.help) {
    console.log(maintainerDoctorUsage());
    return;
  }

  const result = await runMaintainerDoctor(options);
  const report = result.report;
  console.log(`maintainer-doctor: ${report.summary.decision}`);
  console.log(`  output: ${report.output_dir}/maintainer_doctor_report.json`);
  console.log(`  commands: ${report.summary.command_count}`);
  console.log(`  failed checks: ${report.summary.failed_check_count}`);
  console.log('  boundary: local only, no publish, no tag, no upload, no evidence attachment, no readiness regeneration');
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
