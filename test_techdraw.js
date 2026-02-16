import { runScript } from './lib/runner.js';
import { loadConfig } from './lib/config-loader.js';

const config = await loadConfig('./configs/examples/ks_bracket.toml');

console.log('=== TechDraw API Headless Test ===\n');

try {
  const result = await runScript('../tests/test_techdraw_projectex.py', config, {
    timeout: 60_000,
    onStderr: (line) => process.stderr.write(line),
  });

  console.log('\n=== Results ===\n');

  if (result.tests) {
    for (const t of result.tests) {
      const icon = t.pass ? 'PASS' : 'FAIL';
      console.log(`[${icon}] ${t.name}`);
      if (t.detail) console.log(`       ${JSON.stringify(t.detail, null, 2).split('\n').join('\n       ')}`);
      if (t.error) console.log(`       Error: ${t.error}`);
    }
    console.log(`\n${result.summary}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
} catch (err) {
  console.error('Test failed:', err.message);
  if (err.details) console.error(err.details);
}
