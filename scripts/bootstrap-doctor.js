#!/usr/bin/env node

import {
  bootstrapDoctorUsage,
  parseBootstrapDoctorArgs,
  runBootstrapDoctor,
} from '../lib/bootstrap-doctor.js';

async function main() {
  const options = parseBootstrapDoctorArgs(process.argv.slice(2));
  if (options.help) {
    console.log(bootstrapDoctorUsage());
    return;
  }

  const result = await runBootstrapDoctor(options);
  const report = result.report;
  console.log(`bootstrap-doctor: ${report.summary.decision}`);
  console.log(`  output: ${report.output_dir}/bootstrap_doctor_report.json`);
  console.log(`  commands: ${report.summary.command_count}`);
  console.log(`  failed checks: ${report.summary.failed_check_count}`);
  console.log(`  next: ${report.summary.next_maintainer_action}`);
  console.log('  boundary: local only, no publish, no tag, no upload, no evidence attachment, no readiness regeneration');
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
