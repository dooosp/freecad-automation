/**
 * Compatibility entrypoint for the staged integration runner.
 * External scripts can continue invoking tests/test-runner.js.
 */
import { main } from './test-runner/main.js';

await main();
