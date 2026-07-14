#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordPreliminaryRfqOutreachAuthorization } from '../src/services/preliminary-rfq-outreach/preliminary-rfq-outreach-authorization-service.js';

const ROOT = resolve(import.meta.dirname, '..');

function usage() {
  return [
    'Usage: node scripts/record-preliminary-rfq-outreach-authorization.js --packet <packet.json> --decision <approval.txt> --out <ignored-authorization.json> [--timestamp <RFC3339>] [--project-root <repo>]',
    '',
    'Records one immutable Gate A decision only. It does not send email, submit a form, authorize dispatch, or satisfy procurement, technical-release, evidence, or readiness gates.',
  ].join('\n');
}

export function parseRecordOutreachArgs(argv) {
  const options = { projectRoot: ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}\n\n${usage()}`);
    if (arg === '--packet') options.packetPath = value;
    else if (arg === '--decision') options.decisionPath = value;
    else if (arg === '--out') options.outputPath = value;
    else if (arg === '--timestamp') options.authorizedAt = value;
    else if (arg === '--project-root') options.projectRoot = resolve(value);
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    index += 1;
  }
  for (const [key, flag] of [['packetPath', '--packet'], ['decisionPath', '--decision'], ['outputPath', '--out']]) {
    if (!options[key]) throw new Error(`${flag} is required\n\n${usage()}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseRecordOutreachArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await recordPreliminaryRfqOutreachAuthorization(options);
  console.log(JSON.stringify({
    outcome: 'authorization_recorded',
    output_path: result.output_path,
    authorization_sha256: result.authorization_sha256,
    packet_sha256: result.packet_sha256,
    approved_recipient_count: result.authorization.approved_recipient_ids.length,
    dispatch_authorized: false,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`record-preliminary-rfq-outreach-authorization: ${error.code || 'error'}: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  });
}
