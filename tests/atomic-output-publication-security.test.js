import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  INSPECTION_PLAN_PUBLICATION_FILES,
  publishAtomicOutputSet,
} from '../lib/atomic-output-publication.js';

async function sandbox(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'fcad-atomic-output-security-')));
  const directory = join(parent, 'output');
  await mkdir(directory);
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { parent, directory };
}

function output(directory, name = 'artifact.json', content = '{"new":true}\n') {
  return { path: join(directory, name), content };
}

const STALE_PID = 2147483647;

function staleToken(index) {
  return `${STALE_PID}.00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function ownerName(token) {
  return `.${INSPECTION_PLAN_PUBLICATION_FILES.lock}.${token}.owner`;
}

function journalTempName(token) {
  return `.${INSPECTION_PLAN_PUBLICATION_FILES.journal}.${token}.tmp`;
}

test('publishes a detached in-memory output set and removes transaction controls', async (t) => {
  const { directory } = await sandbox(t);
  await publishAtomicOutputSet({
    directory,
    outputs: [output(directory), output(directory, 'artifact.md', '# new\n')],
  });
  assert.equal(await readFile(join(directory, 'artifact.json'), 'utf8'), '{"new":true}\n');
  assert.equal(await readFile(join(directory, 'artifact.md'), 'utf8'), '# new\n');
  assert.deepEqual((await readdir(directory)).sort(), ['artifact.json', 'artifact.md']);
});

test('recovers a stale lock-only control before publishing', async (t) => {
  const { directory } = await sandbox(t);
  const token = staleToken(1);
  await writeFile(
    join(directory, INSPECTION_PLAN_PUBLICATION_FILES.lock),
    `${JSON.stringify({ pid: STALE_PID, token })}\n`
  );
  await publishAtomicOutputSet({ directory, outputs: [output(directory)] });
  assert.deepEqual(await readdir(directory), ['artifact.json']);
});

test('cleans a stale owner-only control when no journal exists', async (t) => {
  const { directory } = await sandbox(t);
  const token = staleToken(2);
  await writeFile(join(directory, ownerName(token)), `${JSON.stringify({ pid: STALE_PID, token })}\n`);
  await publishAtomicOutputSet({ directory, outputs: [output(directory)] });
  assert.deepEqual(await readdir(directory), ['artifact.json']);
});

test('cleans a stale declared-output temp when no journal exists', async (t) => {
  const { directory } = await sandbox(t);
  const token = staleToken(3);
  await writeFile(join(directory, `.artifact.json.${token}.tmp`), 'partial-output\n');
  await publishAtomicOutputSet({ directory, outputs: [output(directory)] });
  assert.deepEqual(await readdir(directory), ['artifact.json']);
});

test('cleans a stale journal-update temp when no journal exists', async (t) => {
  const { directory } = await sandbox(t);
  const token = staleToken(4);
  await writeFile(join(directory, journalTempName(token)), 'partial-journal\n');
  await publishAtomicOutputSet({ directory, outputs: [output(directory)] });
  assert.deepEqual(await readdir(directory), ['artifact.json']);
});

test('preserves arbitrary lookalikes, backups, undeclared temps, and unrelated files', async (t) => {
  const { directory } = await sandbox(t);
  const token = staleToken(5);
  const preserved = [
    '.artifact.json.not-a-publication-token.tmp',
    `.undeclared.json.${token}.tmp`,
    `.artifact.json.${token}.bak`,
    `.${INSPECTION_PLAN_PUBLICATION_FILES.journal}.not-a-publication-token.tmp`,
    `.${INSPECTION_PLAN_PUBLICATION_FILES.lock}.not-a-publication-token.owner`,
    'unrelated.txt',
  ];
  for (const name of preserved) await writeFile(join(directory, name), `preserve:${name}\n`);
  await publishAtomicOutputSet({ directory, outputs: [output(directory)] });
  assert.deepEqual((await readdir(directory)).sort(), [...preserved, 'artifact.json'].sort());
  for (const name of preserved) assert.equal(await readFile(join(directory, name), 'utf8'), `preserve:${name}\n`);
});

test('rejects unsafe matching stale debris without following or deleting it', async (t) => {
  const { parent, directory } = await sandbox(t);
  const token = staleToken(6);
  const victim = join(parent, 'victim.txt');
  const debris = join(directory, `.artifact.json.${token}.tmp`);
  await writeFile(victim, 'preserve-me\n');
  await symlink(victim, debris);
  await assert.rejects(
    () => publishAtomicOutputSet({ directory, outputs: [output(directory)] }),
    /Unsafe stale publication debris/
  );
  assert.equal(await readFile(victim, 'utf8'), 'preserve-me\n');
  assert.ok((await readdir(directory)).includes(`.artifact.json.${token}.tmp`));
});

test('rejects unsafe or colliding declared output names before locking', async (t) => {
  const { directory } = await sandbox(t);
  await assert.rejects(
    () => publishAtomicOutputSet({ directory, outputs: [output(directory, '.hidden.json')] }),
    /safe non-control filenames/
  );
  await assert.rejects(
    () => publishAtomicOutputSet({ directory, outputs: [output(directory), output(directory)] }),
    /must be unique/
  );
  assert.deepEqual(await readdir(directory), []);
});

test('rejects in-place target byte changes after preflight', async (t) => {
  const { directory } = await sandbox(t);
  const target = join(directory, 'artifact.json');
  await writeFile(target, '{"old":true}\n');
  await assert.rejects(
    () => publishAtomicOutputSet({
      directory,
      outputs: [output(directory)],
      hooks: {
        beforeCommit: async () => writeFile(target, '{"changedInPlace":true}\n'),
      },
    }),
    /changed after preflight/
  );
  assert.equal(await readFile(target, 'utf8'), '{"changedInPlace":true}\n');
  assert.deepEqual((await readdir(directory)).sort(), ['artifact.json']);
});

test('rejects output-directory path substitution without mutating the replacement', async (t) => {
  const { parent, directory } = await sandbox(t);
  const displaced = join(parent, 'displaced-output');
  const target = join(directory, 'artifact.json');
  await writeFile(target, '{"old":true}\n');
  await assert.rejects(
    () => publishAtomicOutputSet({
      directory,
      outputs: [output(directory)],
      hooks: {
        beforeCommit: async () => {
          await rename(directory, displaced);
          await mkdir(directory);
          await writeFile(join(directory, 'decoy.txt'), 'do-not-touch\n');
        },
      },
    }),
    /Output directory changed after preflight/
  );
  assert.equal(await readFile(join(directory, 'decoy.txt'), 'utf8'), 'do-not-touch\n');
  assert.deepEqual(await readdir(directory), ['decoy.txt']);
  assert.equal(await readFile(join(displaced, 'artifact.json'), 'utf8'), '{"old":true}\n');
});

test('rejects duplicate keys in a recovery journal', async (t) => {
  const { directory } = await sandbox(t);
  const journalPath = join(directory, INSPECTION_PLAN_PUBLICATION_FILES.journal);
  await writeFile(
    journalPath,
    '{"schema_version":"1.0","schema_version":"1.0","token":"stale","phase":"prepared","entries":[]}\n'
  );
  await assert.rejects(
    () => publishAtomicOutputSet({ directory, outputs: [output(directory)] }),
    /Duplicate JSON object keys/
  );
  assert.equal(await readFile(journalPath, 'utf8'), '{"schema_version":"1.0","schema_version":"1.0","token":"stale","phase":"prepared","entries":[]}\n');
});

test('rejects a journal that names an unrelated direct child as transaction debris', async (t) => {
  const { directory } = await sandbox(t);
  const journalPath = join(directory, INSPECTION_PLAN_PUBLICATION_FILES.journal);
  const victimPath = join(directory, 'unrelated-user-file.txt');
  const targetPath = join(directory, 'artifact.json');
  await writeFile(victimPath, 'preserve-me\n');
  await writeFile(journalPath, `${JSON.stringify({
    schema_version: '1.0',
    token: 'stale-token',
    phase: 'prepared',
    entries: [{
      target: targetPath,
      temp: victimPath,
      backup: join(directory, '.artifact.json.stale-token.bak'),
      original_exists: false,
      original_dev: null,
      original_ino: null,
      original_sha256: null,
      new_sha256: '0'.repeat(64),
    }],
  }, null, 2)}\n`);
  await assert.rejects(
    () => publishAtomicOutputSet({ directory, outputs: [output(directory)] }),
    /invalid records/
  );
  assert.equal(await readFile(victimPath, 'utf8'), 'preserve-me\n');
});

test('rejects duplicate keys in an existing lock control', async (t) => {
  const { directory } = await sandbox(t);
  const lockPath = join(directory, INSPECTION_PLAN_PUBLICATION_FILES.lock);
  await writeFile(lockPath, '{"pid":2147483647,"pid":2147483647,"token":"stale"}\n');
  await assert.rejects(
    () => publishAtomicOutputSet({ directory, outputs: [output(directory)] }),
    /Duplicate JSON object keys/
  );
  assert.equal(await readFile(lockPath, 'utf8'), '{"pid":2147483647,"pid":2147483647,"token":"stale"}\n');
});
