#!/usr/bin/env node

import { startLegacyViewerServer } from '../server.js';

function parseLegacyServePort(rawPort) {
  if (rawPort === undefined) {
    return 3000;
  }
  if (!/^\d+$/.test(String(rawPort))) {
    console.error(`Error: legacy serve port must be a positive integer, received "${rawPort}"`);
    process.exit(1);
  }
  return Number.parseInt(rawPort, 10);
}

export function startLegacyServeCli(rawPort = process.argv[2]) {
  const port = parseLegacyServePort(rawPort);
  console.warn('Warning: npm run serve:legacy starts the compatibility-only legacy viewer shell from server.js. Prefer `fcad serve` for Studio and the local API.');
  return startLegacyViewerServer(port);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  startLegacyServeCli(process.argv[2]);
}
