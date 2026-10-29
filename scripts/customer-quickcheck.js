#!/usr/bin/env node

import { customerQuickcheckMain } from '../lib/customer-quickcheck.js';

process.exitCode = await customerQuickcheckMain();
