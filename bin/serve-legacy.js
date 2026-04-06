#!/usr/bin/env node

import { startServer } from '../server.js';

const port = Number.parseInt(process.argv[2] || '', 10) || 3000;

startServer(port);
