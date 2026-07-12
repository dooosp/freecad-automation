import { randomUUID, createHash } from 'node:crypto';
import { constants, open, lstat, link, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const JOURNAL = '.fcad-inspection-plan.transaction.json';
const LOCK = '.fcad-inspection-plan.lock';

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

async function inspectFile(path, { allowMissing = true } = {}) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Unsafe output target: ${path}`);
    if (info.nlink !== 1) throw new Error(`Hardlink output alias is forbidden: ${path}`);
    return { exists: true, dev: info.dev, ino: info.ino, sha256: digest(await readFile(path)) };
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return { exists: false, dev: null, ino: null, sha256: null };
    throw error;
  }
}

async function writeExclusive(path, content) {
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    await handle.writeFile(content);
    await handle.sync();
  } finally { await handle?.close(); }
}

async function writeJournal(directory, journal) {
  const target = resolve(directory, JOURNAL);
  const update = resolve(directory, `.${JOURNAL}.${journal.token}.tmp`);
  await writeExclusive(update, `${JSON.stringify(journal, null, 2)}\n`);
  await rename(update, target);
}

async function acquireLock(directory, token) {
  const lock = resolve(directory, LOCK);
  const owner = resolve(directory, `.${LOCK}.${token}.owner`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await writeExclusive(owner, `${JSON.stringify({ pid: process.pid, token })}\n`);
    try { await link(owner, lock); break; } catch (error) {
      await rm(owner, { force: true });
      if (error?.code !== 'EEXIST' || attempt > 0) throw new Error('Another inspection-plan publication owns the output directory', { cause: error });
      let stale = false;
      let prior;
      try {
        prior = JSON.parse(await readFile(lock, 'utf8'));
        try { process.kill(prior.pid, 0); } catch (signalError) { stale = signalError?.code === 'ESRCH'; }
      } catch {}
      if (!stale) throw new Error('Another inspection-plan publication owns the output directory', { cause: error });
      await rm(lock, { force: true });
      if (prior?.token) await rm(resolve(directory, `.${LOCK}.${prior.token}.owner`), { force: true });
    }
  }
  const identity = await lstat(lock);
  return async () => {
    try { const current = await lstat(lock); if (current.dev === identity.dev && current.ino === identity.ino) await rm(lock); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await rm(owner, { force: true });
  };
}

async function recoverLocked(directory) {
  const journalPath = resolve(directory, JOURNAL);
  let journal;
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return false; throw new Error('Inspection-plan publication journal is malformed', { cause: error }); }
  if (journal?.schema_version !== '1.0' || !['prepared', 'committing', 'committed'].includes(journal.phase) || !Array.isArray(journal.entries)) throw new Error('Inspection-plan publication journal is unsafe');
  for (const entry of [...journal.entries].reverse()) {
    if (dirname(entry.target) !== directory || dirname(entry.temp) !== directory || dirname(entry.backup) !== directory) throw new Error('Inspection-plan publication journal escaped its directory');
    const target = await inspectFile(entry.target).catch(() => null);
    const backup = await inspectFile(entry.backup).catch(() => null);
    if (journal.phase === 'committed') {
      if (!target?.exists || target.sha256 !== entry.new_sha256) throw new Error('Committed inspection-plan output changed before recovery');
    } else if (backup?.exists) {
      if (backup.sha256 !== entry.original_sha256) throw new Error('Inspection-plan recovery backup hash mismatch');
      if (target?.exists) {
        if (target.sha256 !== entry.new_sha256) throw new Error('Inspection-plan recovery target was replaced');
        await rm(entry.target);
      }
      await rename(entry.backup, entry.target);
    } else if (!entry.original_exists && target?.exists) {
      if (target.sha256 !== entry.new_sha256) throw new Error('Inspection-plan recovery found an unknown target');
      await rm(entry.target);
    } else if (entry.original_exists && (!target?.exists || target.sha256 !== entry.original_sha256)) {
      throw new Error('Inspection-plan original output cannot be recovered');
    }
    await rm(entry.temp, { force: true });
    await rm(entry.backup, { force: true });
  }
  await rm(journalPath, { force: true });
  return true;
}

export async function publishAtomicOutputSet({ directory, outputs, hooks = {} }) {
  const canonicalDirectory = await realpath(directory);
  if (canonicalDirectory !== resolve(directory)) throw new Error('Output directory must not resolve through a symlink');
  const token = `${process.pid}.${randomUUID()}`;
  let release = await acquireLock(canonicalDirectory, token);
  try {
    await recoverLocked(canonicalDirectory);
  } finally { await release(); }

  release = await acquireLock(canonicalDirectory, token);
  const journal = { schema_version: '1.0', token, phase: 'prepared', entries: [] };
  let committedCount = 0;
  let mutationStarted = false;
  let cleanupSafe = false;
  try {
    for (const output of outputs) {
      const target = resolve(output.path);
      if (dirname(target) !== canonicalDirectory) throw new Error('Atomic outputs must share one real directory');
      const original = await inspectFile(target);
      const temp = resolve(canonicalDirectory, `.${basename(target)}.${token}.tmp`);
      const backup = resolve(canonicalDirectory, `.${basename(target)}.${token}.bak`);
      const bytes = Buffer.isBuffer(output.content) ? output.content : Buffer.from(output.content, 'utf8');
      await writeExclusive(temp, bytes);
      journal.entries.push({ target, temp, backup, original_exists: original.exists, original_dev: original.dev, original_ino: original.ino, original_sha256: original.sha256, new_sha256: digest(bytes) });
    }
    await writeJournal(canonicalDirectory, journal);
    journal.phase = 'committing';
    await writeJournal(canonicalDirectory, journal);
    for (let index = 0; index < journal.entries.length; index += 1) {
      const entry = journal.entries[index];
      await hooks.beforeCommit?.({ index, entry });
      const current = await inspectFile(entry.target);
      if (current.exists !== entry.original_exists || (current.exists && (current.dev !== entry.original_dev || current.ino !== entry.original_ino))) throw new Error('Output target changed after preflight');
      if (entry.original_exists) { await rename(entry.target, entry.backup); mutationStarted = true; }
      await rename(entry.temp, entry.target);
      mutationStarted = true;
      committedCount += 1;
      await hooks.afterCommit?.({ index, entry });
    }
    journal.phase = 'committed';
    await writeJournal(canonicalDirectory, journal);
    for (const entry of journal.entries) await rm(entry.backup, { force: true });
    await rm(resolve(canonicalDirectory, JOURNAL), { force: true });
    cleanupSafe = true;
  } catch (error) {
    if (committedCount === 0 && !mutationStarted) {
      await rm(resolve(canonicalDirectory, JOURNAL), { force: true });
      cleanupSafe = true;
    } else {
      await recoverLocked(canonicalDirectory).then(() => { cleanupSafe = true; }).catch((recoveryError) => { error.recoveryError = recoveryError; });
    }
    throw error;
  } finally {
    if (cleanupSafe) for (const entry of journal.entries) { await rm(entry.temp, { force: true }); await rm(entry.backup, { force: true }); }
    await release();
  }
}

export const INSPECTION_PLAN_PUBLICATION_FILES = Object.freeze({ journal: JOURNAL, lock: LOCK });
