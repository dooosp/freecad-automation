import { randomUUID, createHash } from 'node:crypto';
import { constants, open, lstat, link, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { parseInspectionEvidenceJsonBytes } from './inspection-evidence-onboarding.js';

const JOURNAL = '.fcad-inspection-plan.transaction.json';
const LOCK = '.fcad-inspection-plan.lock';
const MAX_CONTROL_BYTES = 1024 * 1024;
const CONTROL_TOKEN = /^[A-Za-z0-9.-]{1,200}$/;
const PUBLICATION_TOKEN = /^([1-9][0-9]{0,19})\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

async function pinOutputDirectory(directory) {
  const requested = resolve(directory);
  const canonical = await realpath(requested);
  if (canonical !== requested) throw new Error('Output directory must not resolve through a symlink');
  const info = await lstat(canonical);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Output directory must be a real directory');
  return Object.freeze({ path: canonical, dev: info.dev, ino: info.ino });
}

async function assertPinnedDirectory(pin, phase) {
  try {
    const info = await lstat(pin.path);
    const canonical = await realpath(pin.path);
    if (
      info.isSymbolicLink()
      || !info.isDirectory()
      || info.dev !== pin.dev
      || info.ino !== pin.ino
      || canonical !== pin.path
    ) {
      throw new Error('identity mismatch');
    }
  } catch (error) {
    throw new Error(`Output directory changed after preflight during ${phase}`, { cause: error });
  }
  return pin.path;
}

async function inspectFile(path, { allowMissing = true } = {}) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`Unsafe output target: ${path}`);
    if (before.nlink !== 1) throw new Error(`Hardlink output alias is forbidden: ${path}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error(`Output target changed while being inspected: ${path}`);
    }
    return { exists: true, dev: before.dev, ino: before.ino, sha256: digest(bytes) };
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') {
      return { exists: false, dev: null, ino: null, sha256: null };
    }
    if (error?.code === 'ELOOP') throw new Error(`Unsafe output target: ${path}`, { cause: error });
    throw error;
  } finally {
    await handle?.close();
  }
}

async function writeExclusive(path, content) {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
      0o600
    );
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

function parseControlJson(bytes, label) {
  try {
    return parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
  } catch (error) {
    const wrapped = new Error(`${label} is malformed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    wrapped.code = error?.code || 'malformed_publication_control_json';
    throw wrapped;
  }
}

async function readControlJson(path, pin, label) {
  await assertPinnedDirectory(pin, `${label} read`);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_CONTROL_BYTES) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error(`${label} changed while being read`);
    }
    return {
      document: parseControlJson(bytes, label),
      identity: { dev: before.dev, ino: before.ino, nlink: before.nlink },
    };
  } finally {
    await handle?.close();
  }
}

function assertSafeToken(value, label) {
  if (typeof value !== 'string' || !CONTROL_TOKEN.test(value)) throw new Error(`${label} token is unsafe`);
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} has an unsafe shape`);
  }
}

function validateLockOwner(owner) {
  assertExactKeys(owner, ['pid', 'token'], 'Inspection-plan publication lock');
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Inspection-plan publication lock pid is unsafe');
  assertSafeToken(owner.token, 'Inspection-plan publication lock');
  return owner;
}

function validateJournal(journal, directory) {
  assertExactKeys(journal, ['schema_version', 'token', 'phase', 'entries'], 'Inspection-plan publication journal');
  assertSafeToken(journal.token, 'Inspection-plan publication journal');
  if (journal.schema_version !== '1.0' || !['prepared', 'committing', 'committed'].includes(journal.phase) || !Array.isArray(journal.entries)) {
    throw new Error('Inspection-plan publication journal is unsafe');
  }
  if (journal.entries.length > 10_000) throw new Error('Inspection-plan publication journal has too many entries');
  const targets = new Set();
  const controlPaths = new Set();
  for (const [index, entry] of journal.entries.entries()) {
    assertExactKeys(
      entry,
      ['target', 'temp', 'backup', 'original_exists', 'original_dev', 'original_ino', 'original_sha256', 'new_sha256'],
      `Inspection-plan publication journal entry ${index}`
    );
    const targetName = typeof entry.target === 'string' ? basename(entry.target) : '';
    const expectedTemp = targetName
      ? resolve(directory, `.${targetName}.${journal.token}.tmp`)
      : null;
    const expectedBackup = targetName
      ? resolve(directory, `.${targetName}.${journal.token}.bak`)
      : null;
    const originalIdentityIsValid = entry.original_exists
      ? Number.isSafeInteger(entry.original_dev)
        && entry.original_dev >= 0
        && Number.isSafeInteger(entry.original_ino)
        && entry.original_ino >= 0
        && typeof entry.original_sha256 === 'string'
        && SHA256.test(entry.original_sha256)
      : entry.original_dev === null
        && entry.original_ino === null
        && entry.original_sha256 === null;
    if (
      typeof entry.target !== 'string'
      || typeof entry.temp !== 'string'
      || typeof entry.backup !== 'string'
      || dirname(entry.target) !== directory
      || dirname(entry.temp) !== directory
      || dirname(entry.backup) !== directory
      || !targetName
      || targetName.startsWith('.')
      || [JOURNAL, LOCK].includes(targetName)
      || entry.temp !== expectedTemp
      || entry.backup !== expectedBackup
      || typeof entry.original_exists !== 'boolean'
      || !originalIdentityIsValid
      || !SHA256.test(entry.new_sha256)
      || (entry.original_sha256 !== null && !SHA256.test(entry.original_sha256))
    ) {
      throw new Error('Inspection-plan publication journal escaped its directory or contains invalid records');
    }
    if (targets.has(entry.target)) throw new Error('Inspection-plan publication journal contains duplicate targets');
    if (
      targets.has(entry.temp)
      || targets.has(entry.backup)
      || controlPaths.has(entry.target)
      || controlPaths.has(entry.temp)
      || controlPaths.has(entry.backup)
      || entry.temp === entry.backup
    ) {
      throw new Error('Inspection-plan publication journal paths collide');
    }
    targets.add(entry.target);
    controlPaths.add(entry.temp);
    controlPaths.add(entry.backup);
  }
  return journal;
}

async function writeJournal(pin, journal) {
  const directory = await assertPinnedDirectory(pin, 'journal staging');
  const target = resolve(directory, JOURNAL);
  const update = resolve(directory, `.${JOURNAL}.${journal.token}.tmp`);
  await writeExclusive(update, `${JSON.stringify(journal, null, 2)}\n`);
  await assertPinnedDirectory(pin, 'journal commit');
  await rename(update, target);
}

async function removeIfIdentityMatches(path, identity, pin, phase) {
  await assertPinnedDirectory(pin, phase);
  try {
    const current = await lstat(path);
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error(`${phase} control file changed after verification`);
    }
    await rm(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function acquireLock(pin, token) {
  const directory = await assertPinnedDirectory(pin, 'lock acquisition');
  const lock = resolve(directory, LOCK);
  const owner = resolve(directory, `.${LOCK}.${token}.owner`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assertPinnedDirectory(pin, 'lock owner staging');
    await writeExclusive(owner, `${JSON.stringify({ pid: process.pid, token })}\n`);
    try {
      await assertPinnedDirectory(pin, 'lock linking');
      await link(owner, lock);
      break;
    } catch (error) {
      await assertPinnedDirectory(pin, 'lock owner cleanup');
      await rm(owner, { force: true });
      if (error?.code !== 'EEXIST' || attempt > 0) {
        throw new Error('Another inspection-plan publication owns the output directory', { cause: error });
      }

      let lockRecord;
      try {
        lockRecord = await readControlJson(lock, pin, 'Inspection-plan publication lock');
      } catch (parseError) {
        throw new Error(`Inspection-plan publication lock is malformed: ${parseError.message}`, { cause: parseError });
      }
      const prior = validateLockOwner(lockRecord.document);
      let stale = false;
      try { process.kill(prior.pid, 0); } catch (signalError) { stale = signalError?.code === 'ESRCH'; }
      if (!stale) throw new Error('Another inspection-plan publication owns the output directory', { cause: error });
      await removeIfIdentityMatches(lock, lockRecord.identity, pin, 'stale lock cleanup');
      const priorOwner = resolve(directory, `.${LOCK}.${prior.token}.owner`);
      await removeIfIdentityMatches(priorOwner, lockRecord.identity, pin, 'stale lock owner cleanup');
    }
  }
  await assertPinnedDirectory(pin, 'lock verification');
  const identity = await lstat(lock);
  const ownerIdentity = await lstat(owner);
  if (
    !identity.isFile()
    || identity.isSymbolicLink()
    || identity.dev !== ownerIdentity.dev
    || identity.ino !== ownerIdentity.ino
  ) {
    throw new Error('Inspection-plan publication lock changed during acquisition');
  }
  return async () => {
    await assertPinnedDirectory(pin, 'lock cleanup');
    try {
      const current = await lstat(lock);
      if (current.dev === identity.dev && current.ino === identity.ino) await rm(lock);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await assertPinnedDirectory(pin, 'lock owner cleanup');
    try {
      const currentOwner = await lstat(owner);
      if (currentOwner.dev === identity.dev && currentOwner.ino === identity.ino) await rm(owner);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
}

async function removePinned(path, pin, phase, options = {}) {
  await assertPinnedDirectory(pin, phase);
  await rm(path, options);
}

async function renamePinned(from, to, pin, phase) {
  await assertPinnedDirectory(pin, phase);
  await rename(from, to);
}

async function recoverLocked(pin) {
  const directory = await assertPinnedDirectory(pin, 'recovery preflight');
  const journalPath = resolve(directory, JOURNAL);
  let journal;
  try {
    const record = await readControlJson(journalPath, pin, 'Inspection-plan publication journal');
    journal = validateJournal(record.document, directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error(`Inspection-plan publication journal is malformed: ${error.message}`, { cause: error });
  }
  for (const entry of [...journal.entries].reverse()) {
    await assertPinnedDirectory(pin, 'recovery entry preflight');
    const target = await inspectFile(entry.target);
    const backup = await inspectFile(entry.backup);
    if (journal.phase === 'committed') {
      if (!target.exists || target.sha256 !== entry.new_sha256) throw new Error('Committed inspection-plan output changed before recovery');
    } else if (backup.exists) {
      if (backup.sha256 !== entry.original_sha256) throw new Error('Inspection-plan recovery backup hash mismatch');
      if (target.exists) {
        if (target.sha256 !== entry.new_sha256) throw new Error('Inspection-plan recovery target was replaced');
        await removePinned(entry.target, pin, 'recovery target rollback');
      }
      await renamePinned(entry.backup, entry.target, pin, 'recovery backup rollback');
    } else if (!entry.original_exists && target.exists) {
      if (target.sha256 !== entry.new_sha256) throw new Error('Inspection-plan recovery found an unknown target');
      await removePinned(entry.target, pin, 'recovery new-target rollback');
    } else if (entry.original_exists && (!target.exists || target.sha256 !== entry.original_sha256)) {
      throw new Error('Inspection-plan original output cannot be recovered');
    }
    await removePinned(entry.temp, pin, 'recovery temporary cleanup', { force: true });
    await removePinned(entry.backup, pin, 'recovery backup cleanup', { force: true });
  }
  await removePinned(journalPath, pin, 'recovery journal cleanup', { force: true });
  return true;
}

function assertSafeOutputName(name) {
  if (
    !name
    || name.startsWith('.')
    || name.includes('\\')
    || /[\0-\x1f\x7f]/.test(name)
    || Buffer.byteLength(name, 'utf8') > 255
    || [JOURNAL, LOCK].includes(name)
  ) {
    throw new Error('Atomic output targets must use safe non-control filenames');
  }
}

function prepareDeclaredOutputs(directory, outputs) {
  if (!Array.isArray(outputs)) throw new Error('Atomic outputs must be an array');
  const targets = new Set();
  return outputs.map((output) => {
    if (!output || typeof output !== 'object' || typeof output.path !== 'string' || !output.path) {
      throw new Error('Atomic outputs must declare non-empty filesystem paths');
    }
    const target = resolve(output.path);
    if (dirname(target) !== directory) throw new Error('Atomic outputs must share one real directory');
    const name = basename(target);
    assertSafeOutputName(name);
    if (targets.has(target)) throw new Error('Atomic output targets must be unique');
    targets.add(target);
    const bytes = Buffer.isBuffer(output.content)
      ? Buffer.from(output.content)
      : Buffer.from(output.content, 'utf8');
    return Object.freeze({ target, name, bytes });
  });
}

function wrappedPublicationToken(name, prefix, suffix) {
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return null;
  const token = name.slice(prefix.length, name.length - suffix.length);
  return PUBLICATION_TOKEN.test(token) ? token : null;
}

function classifyPreJournalDebris(name, targetNames) {
  const ownerToken = wrappedPublicationToken(name, `.${LOCK}.`, '.owner');
  if (ownerToken) return { kind: 'owner', token: ownerToken };
  const journalToken = wrappedPublicationToken(name, `.${JOURNAL}.`, '.tmp');
  if (journalToken) return { kind: 'journal-temp', token: journalToken };

  let match = null;
  for (const targetName of targetNames) {
    const token = wrappedPublicationToken(name, `.${targetName}.`, '.tmp');
    if (!token) continue;
    if (match) throw new Error('Stale publication debris name collides with multiple output targets');
    match = { kind: 'output-temp', token };
  }
  return match;
}

async function assertSafeDebrisFile(path, pin, phase) {
  await assertPinnedDirectory(pin, phase);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
      throw new Error(`Unsafe stale publication debris: ${basename(path)}`);
    }
    return { dev: info.dev, ino: info.ino, nlink: info.nlink };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isProcessStale(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

async function cleanupPreJournalDebris(pin, declaredOutputs, currentToken) {
  const directory = await assertPinnedDirectory(pin, 'pre-journal debris scan');
  try {
    await lstat(resolve(directory, JOURNAL));
    throw new Error('Cannot clean pre-journal debris while a publication journal exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const targetNames = declaredOutputs.map((output) => output.name);
  const names = await readdir(directory);
  await assertPinnedDirectory(pin, 'pre-journal debris scan verification');
  for (const name of names) {
    const debris = classifyPreJournalDebris(name, targetNames);
    if (!debris || debris.token === currentToken) continue;
    const path = resolve(directory, name);
    let identity;
    if (debris.kind === 'owner') {
      let record;
      try {
        record = await readControlJson(path, pin, 'Stale publication owner');
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const owner = validateLockOwner(record.document);
      const tokenPid = Number.parseInt(debris.token.slice(0, debris.token.indexOf('.')), 10);
      if (owner.token !== debris.token || owner.pid !== tokenPid) {
        throw new Error('Stale publication owner does not match its control filename');
      }
      if (!isProcessStale(owner.pid)) {
        throw new Error('Another inspection-plan publication is preparing the output directory');
      }
      if (record.identity.nlink !== 1) throw new Error(`Unsafe stale publication debris: ${name}`);
      identity = record.identity;
    } else {
      identity = await assertSafeDebrisFile(path, pin, 'pre-journal debris verification');
      if (!identity) continue;
    }
    await removeIfIdentityMatches(path, identity, pin, `stale ${debris.kind} cleanup`);
  }
}

function attachSecondaryError(primary, property, secondary) {
  if (primary && secondary) primary[property] = secondary;
}

export async function publishAtomicOutputSet({ directory, outputs, hooks = {} }) {
  const pin = await pinOutputDirectory(directory);
  const declaredOutputs = prepareDeclaredOutputs(pin.path, outputs);
  const token = `${process.pid}.${randomUUID()}`;
  let release = await acquireLock(pin, token);
  let recoveryError = null;
  try {
    await recoverLocked(pin);
    await cleanupPreJournalDebris(pin, declaredOutputs, token);
  } catch (error) {
    recoveryError = error;
    throw error;
  } finally {
    try { await release(); } catch (error) {
      if (recoveryError) attachSecondaryError(recoveryError, 'releaseError', error);
      else throw error;
    }
  }

  release = await acquireLock(pin, token);
  const journal = { schema_version: '1.0', token, phase: 'prepared', entries: [] };
  let committedCount = 0;
  let mutationStarted = false;
  let cleanupSafe = false;
  let publicationError = null;
  try {
    for (const output of declaredOutputs) {
      const canonicalDirectory = await assertPinnedDirectory(pin, 'output staging');
      const target = output.target;
      if (dirname(target) !== canonicalDirectory) throw new Error('Atomic outputs must share one real directory');
      const original = await inspectFile(target);
      const temp = resolve(canonicalDirectory, `.${output.name}.${token}.tmp`);
      const backup = resolve(canonicalDirectory, `.${output.name}.${token}.bak`);
      const bytes = output.bytes;
      await writeExclusive(temp, bytes);
      await assertPinnedDirectory(pin, 'output staging verification');
      journal.entries.push({
        target,
        temp,
        backup,
        original_exists: original.exists,
        original_dev: original.dev,
        original_ino: original.ino,
        original_sha256: original.sha256,
        new_sha256: digest(bytes),
      });
    }
    await writeJournal(pin, journal);
    journal.phase = 'committing';
    await writeJournal(pin, journal);
    for (let index = 0; index < journal.entries.length; index += 1) {
      const entry = journal.entries[index];
      await assertPinnedDirectory(pin, `output ${index} pre-commit hook`);
      await hooks.beforeCommit?.({ index, entry });
      await assertPinnedDirectory(pin, `output ${index} commit`);
      const current = await inspectFile(entry.target);
      if (
        current.exists !== entry.original_exists
        || (current.exists && (
          current.dev !== entry.original_dev
          || current.ino !== entry.original_ino
          || current.sha256 !== entry.original_sha256
        ))
      ) {
        throw new Error('Output target changed after preflight');
      }
      if (entry.original_exists) {
        await renamePinned(entry.target, entry.backup, pin, `output ${index} backup`);
        mutationStarted = true;
      }
      await renamePinned(entry.temp, entry.target, pin, `output ${index} install`);
      mutationStarted = true;
      const installed = await inspectFile(entry.target);
      if (!installed.exists || installed.sha256 !== entry.new_sha256) throw new Error('Published output bytes failed verification');
      committedCount += 1;
      await hooks.afterCommit?.({ index, entry });
    }
    journal.phase = 'committed';
    await writeJournal(pin, journal);
    for (const entry of journal.entries) {
      await removePinned(entry.backup, pin, 'committed backup cleanup', { force: true });
    }
    await removePinned(resolve(pin.path, JOURNAL), pin, 'committed journal cleanup', { force: true });
    cleanupSafe = true;
  } catch (error) {
    publicationError = error;
    if (committedCount === 0 && !mutationStarted) {
      try {
        await removePinned(resolve(pin.path, JOURNAL), pin, 'failed journal cleanup', { force: true });
        cleanupSafe = true;
      } catch (cleanupError) {
        attachSecondaryError(error, 'cleanupError', cleanupError);
      }
    } else {
      try {
        await recoverLocked(pin);
        cleanupSafe = true;
      } catch (rollbackError) {
        attachSecondaryError(error, 'recoveryError', rollbackError);
      }
    }
    throw error;
  } finally {
    if (cleanupSafe) {
      try {
        for (const entry of journal.entries) {
          await removePinned(entry.temp, pin, 'temporary output cleanup', { force: true });
          await removePinned(entry.backup, pin, 'backup output cleanup', { force: true });
        }
      } catch (cleanupError) {
        if (publicationError) attachSecondaryError(publicationError, 'finalCleanupError', cleanupError);
        else throw cleanupError;
      }
    }
    try { await release(); } catch (releaseError) {
      if (publicationError) attachSecondaryError(publicationError, 'releaseError', releaseError);
      else throw releaseError;
    }
  }
}

export const INSPECTION_PLAN_PUBLICATION_FILES = Object.freeze({ journal: JOURNAL, lock: LOCK });
