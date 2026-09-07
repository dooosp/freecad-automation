import assert from 'node:assert/strict';
import { createDesignService } from '../src/services/design/design-service.js';

// Synthetic service-boundary test: no FreeCAD or AI provider is called.
const toml = `name = "external_candidate"
[[shapes]]
id = "plate"
type = "box"
length = 40
width = 20
height = 4
`;
const calls = [];
const failAi = () => { throw new Error('AI must not be called by build'); };
const result = { success: true, model: { name: 'external_candidate' }, exports: [{ format: 'step', path: 'output/example.step' }] };
const runScript = () => { throw new Error('build must delegate to createModel'); };
const loadConfig = () => { calls.push('load'); throw new Error('invalid config must not load'); };
const run = createDesignService({
  designFromTextFn: failAi, reviewTomlFn: failAi,
  mkdirFn: async () => { calls.push('mkdir'); },
  writeFileFn: async (path, text) => { calls.push('write'); assert.equal(text, toml); },
  createModelFn: async (input) => {
    calls.push('create');
    assert.equal(input.freecadRoot, '/synthetic-root');
    assert.equal(input.runScript, runScript);
    assert.equal(input.loadConfig, loadConfig);
    assert.match(input.configPath, /^\/synthetic-root\/configs\/generated\/design_\d+\.toml$/);
    return result;
  },
});
const args = { freecadRoot: '/synthetic-root', runScript, loadConfig, mode: 'build' };
await assert.rejects(() => run({ ...args, toml: 'final = ""\n' + toml }));
assert.deepEqual(calls, [], 'empty explicit final must be rejected before build side effects');
for (const invalid of ['name = [', toml + '\n[[operations]]\nop = "cut"\nbase = "plate"\ntool = "missing_hole"\n', toml + '\n[[operations]]\nop = "cut"\nbase = "plate"\ntool = { type = "cylinder", radius = "bad", height = 8 }\n']) {
  await assert.rejects(() => run({ ...args, toml: invalid }));
  assert.deepEqual(calls, [], 'invalid build must have no write/load/runtime side effects');
}
const built = await run({ ...args, toml });
assert.deepEqual(calls, ['mkdir', 'write', 'create']);
assert.deepEqual({ ...built, configPath: undefined }, { ...result, configPath: undefined });
assert.match(built.configPath, /^configs\/generated\/design_\d+\.toml$/);

const modes = [];
const review = { issues: [], correctedToml: toml, report: { recommendation: 'draft' }, rawResponse: 'synthetic' };
const design = { toml, report: {}, rawResponse: 'synthetic' };
const adapter = createDesignService({
  designFromTextFn: async description => { modes.push(description); return design; },
  reviewTomlFn: async path => { modes.push('review'); assert.match(path, /review_\d+\.toml$/); return review; },
  mkdirFn: async () => {}, writeFileFn: async () => {},
  unlinkFn: async () => { modes.push('unlink'); },
});
assert.deepEqual(await adapter({ ...args, mode: 'design', description: 'external draft' }), design);
const reviewed = await adapter({ ...args, mode: 'review', toml });
assert.equal(reviewed.validation.valid, true);
assert.deepEqual({ ...reviewed, validation: undefined }, { ...review, validation: undefined });
assert.deepEqual(modes, ['external draft', 'review', 'unlink']);
for (const input of [{ mode: 'design' }, { mode: 'review' }, { mode: 'build' }, { mode: 'unknown' }, {}]) {
  await assert.rejects(() => adapter(input), /required|unknown mode/);
}
const brokenReview = createDesignService({ reviewTomlFn: async () => { throw new Error('review failure'); }, mkdirFn: async () => {}, writeFileFn: async () => {}, unlinkFn: async () => { modes.push('cleanup'); } });
await assert.rejects(() => brokenReview({ ...args, mode: 'review', toml }), /review failure/);
assert.equal(modes.at(-1), 'cleanup');
console.log('design-core-boundary.test.js: ok');
