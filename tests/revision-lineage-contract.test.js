import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  REVISION_LINEAGE_FIELD,
  REVISION_LINEAGE_MODE,
  REVISION_LINEAGE_REASON_CODES,
  REVISION_LINEAGE_SCHEMA,
  REVISION_LINEAGE_SCHEMA_VERSION,
  RevisionLineageError,
  assertRevisionLineage,
  assertRevisionLineageIdentity,
  assertRevisionLineageIdentityAgreement,
  assertRevisionLineagePackageSelection,
  assertRevisionLineageParentAgreement,
  assertRevisionLineageSnapshotCurrent,
  assertSelectedRevisionLineagePath,
  buildRevisionLineage,
  buildRevisionLineageParent,
  buildRevisionLineageParentFromSnapshot,
  extractRevisionLineageIdentity,
  extractRevisionLineageIdentityFromConfig,
  isLowercaseSha256,
  isRevisionLineage,
  readAuthoritativeConfigSnapshot,
  readRevisionLineageFileSnapshot,
  revisionLineageIdentitiesAgree,
  validateRevisionLineage,
  validateRevisionLineageIdentity,
  verifyRevisionLineageParentReference,
} from '../lib/revision-lineage-contract.js';
import {
  REVISION_LINEAGE_PROOF_PACKAGE_ALLOWLIST,
  SELECTED_REVISION_LINEAGE_PACKAGE,
} from '../lib/revision-lineage-proof-package.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ROOT = mkdtempSync(join(tmpdir(), 'fcad-revision-lineage-contract-'));
const SELECTED_PATH = SELECTED_REVISION_LINEAGE_PACKAGE.authoritative_config_path;
const CONFIG_PATH = join(ROOT, SELECTED_PATH);

function tomlConfig(overrides = {}) {
  const values = {
    name: 'hinge_block',
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    ...overrides,
  };
  return `config_version = 1
name = ${JSON.stringify(values.name)}

[product]
package_slug = ${JSON.stringify(values.package_slug)}
part_id = ${JSON.stringify(values.part_id)}
revision = ${JSON.stringify(values.revision)}
`;
}

function configObject(overrides = {}) {
  const product = {
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    ...(overrides.product || {}),
  };
  return {
    config_version: 1,
    name: 'hinge_block',
    ...overrides,
    product,
  };
}

function writeSelected(text = tomlConfig()) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, text);
}

function errorCode(code, causeCode = null) {
  return (error) => {
    assert(error instanceof RevisionLineageError, `expected RevisionLineageError, got ${error}`);
    assert.equal(error.code, code);
    assert.equal(error.reason_code, code);
    if (causeCode !== null) assert.equal(error.details.cause_code, causeCode);
    return true;
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

try {
  assert.equal(REVISION_LINEAGE_FIELD, 'revision_lineage');
  assert.equal(REVISION_LINEAGE_SCHEMA_VERSION, '1.0');
  assert.equal(REVISION_LINEAGE_MODE, 'proof');
  assert.equal(REVISION_LINEAGE_SCHEMA.additionalProperties, false);
  assert.deepEqual(REVISION_LINEAGE_PROOF_PACKAGE_ALLOWLIST, [SELECTED_REVISION_LINEAGE_PACKAGE]);
  assert.deepEqual(SELECTED_REVISION_LINEAGE_PACKAGE, {
    package_directory: 'docs/examples/hinge-block',
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    authoritative_config_path: 'configs/examples/hinge_block.toml',
    generated_config_descendants: ['docs/examples/hinge-block/config.toml'],
  });
  assert.deepEqual(
    assertRevisionLineagePackageSelection(),
    SELECTED_REVISION_LINEAGE_PACKAGE
  );
  assert.equal(
    assertSelectedRevisionLineagePath(SELECTED_PATH),
    SELECTED_PATH
  );
  assert.equal(
    assertSelectedRevisionLineagePath('docs/examples/hinge-block/config.toml', {
      role: 'generated_config_descendant',
    }),
    'docs/examples/hinge-block/config.toml'
  );
  assert.throws(
    () => assertSelectedRevisionLineagePath('configs/examples/motor_mount.toml'),
    errorCode(REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_PACKAGE)
  );
  assert.throws(
    () => assertSelectedRevisionLineagePath('../hinge_block.toml'),
    errorCode(REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH)
  );
  assert.throws(
    () => assertRevisionLineagePackageSelection({
      ...SELECTED_REVISION_LINEAGE_PACKAGE,
      package_directory: 'docs/examples/not-hinge-block',
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineagePackageSelection({
      ...SELECTED_REVISION_LINEAGE_PACKAGE,
      generated_config_descendants: ['docs/examples/other/config.toml'],
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE)
  );

  const identity = {
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    config_sha256: SHA_A,
  };
  assert.equal(validateRevisionLineageIdentity(identity).ok, true);
  assert.deepEqual(assertRevisionLineageIdentity(identity), identity);
  assert.equal(isLowercaseSha256(SHA_A), true);
  assert.equal(isLowercaseSha256(SHA_A.toUpperCase()), false);

  for (const field of ['package_slug', 'part_id', 'revision']) {
    for (const missing of [undefined, null, '', '   ']) {
      const candidate = { ...identity, [field]: missing };
      if (missing === undefined) delete candidate[field];
      assert.throws(
        () => assertRevisionLineageIdentity(candidate),
        errorCode(REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY),
        `${field}=${String(missing)} must be missing_identity`
      );
    }
  }
  for (const malformed of [{}, [], 1, true]) {
    assert.throws(
      () => assertRevisionLineageIdentity({ ...identity, revision: malformed }),
      errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY)
    );
  }
  assert.throws(
    () => assertRevisionLineageIdentity({ ...identity, revision: ' A' }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineageIdentity({ ...identity, package_slug: 'Hinge_Block' }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineageIdentity({ ...identity, config_sha256: SHA_A.toUpperCase() }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineageIdentity(identity, {
      origins: { revision: 'inferred' },
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.INFERRED_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineageIdentity(identity, {
      origins: { revision: 'defaulted' },
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.DEFAULTED_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineageIdentity(identity, {
      origins: { revision: 'legacy' },
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_LEGACY)
  );

  assert.deepEqual(extractRevisionLineageIdentityFromConfig(configObject(), {
    configSha256: SHA_A,
  }), identity);
  for (const field of ['package_slug', 'part_id', 'revision']) {
    const missingConfig = configObject();
    delete missingConfig.product[field];
    assert.throws(
      () => extractRevisionLineageIdentityFromConfig(missingConfig, { configSha256: SHA_A }),
      errorCode(REVISION_LINEAGE_REASON_CODES.MISSING_IDENTITY)
    );
  }
  assert.throws(
    () => extractRevisionLineageIdentityFromConfig(configObject({ name: 'hinge-block' }), {
      configSha256: SHA_A,
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY)
  );
  assert.throws(
    () => extractRevisionLineageIdentityFromConfig(configObject({
      product: { package_slug: 'other-package' },
    }), { configSha256: SHA_A }),
    errorCode(REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY)
  );
  assert.throws(
    () => extractRevisionLineageIdentityFromConfig(configObject(), {
      configSha256: SHA_A,
      packageDirectory: 'docs/examples/other-package',
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY)
  );
  assert.throws(
    () => extractRevisionLineageIdentity({
      artifact_type: 'review_pack',
      part_id: 'hinge_block',
      revision: null,
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.UNSUPPORTED_LEGACY)
  );

  const configParent = buildRevisionLineageParent({
    artifactType: 'config',
    role: 'authoritative_config',
    path: SELECTED_PATH,
    sha256: SHA_A,
    sizeBytes: 123,
  });
  const reviewParent = buildRevisionLineageParent({
    artifact_type: 'review_pack',
    role: 'review_pack',
    path: 'output/review/review_pack.json',
    sha256: SHA_B,
    size_bytes: 456,
  });
  assert.deepEqual(configParent, {
    artifact_type: 'config',
    role: 'authoritative_config',
    path: SELECTED_PATH,
    sha256: SHA_A,
    size_bytes: 123,
  });
  const lineage = buildRevisionLineage({
    identity,
    parents: [reviewParent, configParent],
  });
  assert.deepEqual(lineage, {
    schema_version: '1.0',
    mode: 'proof',
    identity,
    parents: [configParent, reviewParent],
  });
  assert.equal(isRevisionLineage(lineage), true);
  assert.equal(validateRevisionLineage(lineage).ok, true);
  assert.deepEqual(assertRevisionLineage(lineage), lineage);
  assert.deepEqual(extractRevisionLineageIdentity(lineage), identity);
  assert.deepEqual(extractRevisionLineageIdentity({ revision_lineage: lineage }), identity);
  assert.equal(revisionLineageIdentitiesAgree(identity, lineage), true);
  assert.deepEqual(assertRevisionLineageIdentityAgreement([
    { label: 'config', identity },
    { label: 'review', lineage },
    { label: 'artifact', value: { revision_lineage: lineage } },
  ]), identity);
  assert.throws(
    () => assertRevisionLineageIdentityAgreement([
      { label: 'config', identity },
      { label: 'wrong revision', identity: { ...identity, revision: 'B' } },
    ]),
    errorCode(REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY)
  );
  assert.throws(
    () => assertRevisionLineage({ ...lineage, unexpected: true }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_IDENTITY)
  );
  assert.throws(
    () => buildRevisionLineage({ identity, parents: [reviewParent] }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MISSING_PARENT)
  );
  assert.throws(
    () => buildRevisionLineage({
      identity,
      parents: [{ ...configParent, sha256: SHA_B }],
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.DIGEST_MISMATCH)
  );
  assert.throws(
    () => buildRevisionLineage({
      identity,
      parents: [configParent, { ...configParent, path: 'other/config.toml' }],
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.CONFLICTING_IDENTITY)
  );
  for (const unsafePath of [
    '/tmp/config.toml',
    '../config.toml',
    'output/../config.toml',
    'output\\config.toml',
    'file:///tmp/config.toml',
    'output/%2e%2e/config.toml',
    'output//config.toml',
    'output/\0config.toml',
  ]) {
    assert.throws(
      () => buildRevisionLineageParent({
        artifactType: 'config',
        role: 'authoritative_config',
        path: unsafePath,
        sha256: SHA_A,
      }),
      errorCode(REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH),
      `unsafe parent locator must be rejected: ${JSON.stringify(unsafePath)}`
    );
  }
  assert.deepEqual(assertRevisionLineageParentAgreement(lineage.parents, lineage), lineage.parents);
  assert.throws(
    () => assertRevisionLineageParentAgreement(
      lineage.parents,
      [configParent, { ...reviewParent, sha256: SHA_A }]
    ),
    errorCode(REVISION_LINEAGE_REASON_CODES.DIGEST_MISMATCH)
  );

  writeSelected();
  const originalText = readFileSync(CONFIG_PATH, 'utf8');
  const snapshot = await readAuthoritativeConfigSnapshot({
    projectRoot: ROOT,
    configPath: SELECTED_PATH,
  });
  assert.equal(snapshot.path, SELECTED_PATH);
  assert.equal(snapshot.format, 'toml');
  assert.equal(snapshot.text, originalText);
  assert.equal(snapshot.sha256, sha256(Buffer.from(originalText)));
  assert.equal(snapshot.size_bytes, Buffer.byteLength(originalText));
  assert.equal(isLowercaseSha256(snapshot.sha256), true);
  assert.deepEqual(snapshot.identity, {
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    config_sha256: snapshot.sha256,
  });
  assert.deepEqual(snapshot.origin, {
    kind: 'authoritative_config',
    path: SELECTED_PATH,
    format: 'toml',
    sha256: snapshot.sha256,
    size_bytes: snapshot.size_bytes,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.config), true);
  const detachedBytes = snapshot.bytes;
  detachedBytes[0] = 0;
  assert.notEqual(snapshot.bytes[0], 0, 'snapshot bytes getter must return a detached copy');
  assert.equal(await assertRevisionLineageSnapshotCurrent(snapshot), true);

  const snapshotConfigParent = buildRevisionLineageParentFromSnapshot({
    artifactType: 'config',
    role: 'authoritative_config',
    snapshot,
  });
  assert.deepEqual(snapshotConfigParent, {
    artifact_type: 'config',
    role: 'authoritative_config',
    path: SELECTED_PATH,
    sha256: snapshot.sha256,
    size_bytes: snapshot.size_bytes,
  });
  const verified = await verifyRevisionLineageParentReference(snapshotConfigParent, {
    projectRoot: ROOT,
  });
  assert.equal(verified.sha256, snapshot.sha256);

  writeSelected(tomlConfig({ revision: 'B' }));
  assert.equal(snapshot.config.product.revision, 'A', 'snapshot document must not change with source bytes');
  await assert.rejects(
    () => assertRevisionLineageSnapshotCurrent(snapshot),
    errorCode(REVISION_LINEAGE_REASON_CODES.STALE_PARENT)
  );
  await assert.rejects(
    () => verifyRevisionLineageParentReference(snapshotConfigParent, { projectRoot: ROOT }),
    errorCode(REVISION_LINEAGE_REASON_CODES.DIGEST_MISMATCH)
  );

  writeSelected(originalText);
  const replacementSnapshot = await readAuthoritativeConfigSnapshot({
    projectRoot: ROOT,
    configPath: SELECTED_PATH,
  });
  const replacementPath = join(ROOT, 'replacement.toml');
  writeFileSync(replacementPath, originalText);
  renameSync(replacementPath, CONFIG_PATH);
  await assert.rejects(
    () => assertRevisionLineageSnapshotCurrent(replacementSnapshot),
    errorCode(REVISION_LINEAGE_REASON_CODES.STALE_PARENT),
    'same bytes through a replacement inode must still invalidate the validated snapshot generation'
  );

  const jsonSelection = {
    package_directory: 'docs/examples/json-package',
    package_slug: 'json-package',
    part_id: 'json_part',
    revision: 'R1',
    authoritative_config_path: 'configs/examples/json_part.json',
    generated_config_descendants: ['docs/examples/json-package/config.json'],
  };
  const jsonPath = join(ROOT, jsonSelection.authoritative_config_path);
  mkdirSync(dirname(jsonPath), { recursive: true });
  const jsonDocument = {
    config_version: 1,
    name: 'json_part',
    product: {
      package_slug: 'json-package',
      part_id: 'json_part',
      revision: 'R1',
    },
  };
  writeFileSync(jsonPath, JSON.stringify(jsonDocument));
  const jsonSnapshot = await readAuthoritativeConfigSnapshot({
    projectRoot: ROOT,
    configPath: jsonSelection.authoritative_config_path,
    selection: jsonSelection,
  });
  assert.equal(jsonSnapshot.format, 'json');
  assert.deepEqual(jsonSnapshot.config, jsonDocument);

  writeSelected(`\uFEFF${tomlConfig()}`);
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({ projectRoot: ROOT, configPath: SELECTED_PATH }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG, 'bom_forbidden')
  );

  writeSelected(Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({ projectRoot: ROOT, configPath: SELECTED_PATH }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG, 'invalid_utf8')
  );

  writeSelected(`${tomlConfig()}revision = "B"\n`);
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({ projectRoot: ROOT, configPath: SELECTED_PATH }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG, 'duplicate_config_key')
  );

  writeFileSync(jsonPath, '{"config_version":1,"name":"json_part","name":"duplicate","product":{"package_slug":"json-package","part_id":"json_part","revision":"R1"}}');
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({
      projectRoot: ROOT,
      configPath: jsonSelection.authoritative_config_path,
      selection: jsonSelection,
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG, 'duplicate_config_key')
  );

  writeSelected('not = [valid');
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({ projectRoot: ROOT, configPath: SELECTED_PATH }),
    errorCode(REVISION_LINEAGE_REASON_CODES.MALFORMED_CONFIG)
  );

  writeSelected(tomlConfig());
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({
      projectRoot: ROOT,
      configPath: SELECTED_PATH,
      maxBytes: 8,
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.INPUT_SIZE_OUT_OF_BOUNDS)
  );
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({
      projectRoot: ROOT,
      configPath: '/absolute/config.toml',
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH)
  );

  const externalPath = join(ROOT, 'outside-config.toml');
  writeFileSync(externalPath, tomlConfig());
  unlinkSync(CONFIG_PATH);
  symlinkSync(externalPath, CONFIG_PATH);
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({ projectRoot: ROOT, configPath: SELECTED_PATH }),
    errorCode(REVISION_LINEAGE_REASON_CODES.SYMLINK_FORBIDDEN)
  );

  unlinkSync(CONFIG_PATH);
  linkSync(externalPath, CONFIG_PATH);
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({ projectRoot: ROOT, configPath: SELECTED_PATH }),
    errorCode(REVISION_LINEAGE_REASON_CODES.HARDLINK_FORBIDDEN)
  );
  unlinkSync(CONFIG_PATH);

  const symlinkSelection = {
    ...SELECTED_REVISION_LINEAGE_PACKAGE,
    authoritative_config_path: 'configs/linked/hinge_block.toml',
  };
  const actualDirectory = join(ROOT, 'actual-config-directory');
  mkdirSync(actualDirectory, { recursive: true });
  writeFileSync(join(actualDirectory, 'hinge_block.toml'), tomlConfig());
  symlinkSync(actualDirectory, join(ROOT, 'configs', 'linked'));
  await assert.rejects(
    () => readAuthoritativeConfigSnapshot({
      projectRoot: ROOT,
      configPath: symlinkSelection.authoritative_config_path,
      selection: symlinkSelection,
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.SYMLINK_FORBIDDEN)
  );

  writeFileSync(join(ROOT, 'plain-parent.json'), '{}\n');
  const plainSnapshot = await readRevisionLineageFileSnapshot({
    projectRoot: ROOT,
    path: 'plain-parent.json',
  });
  assert.equal(plainSnapshot.sha256, sha256('{}\n'));
  assert.equal(plainSnapshot.size_bytes, 3);

  const portableRunRoot = join(ROOT, 'tmp', 'run-a');
  const decoyRunRoot = join(ROOT, 'run');
  mkdirSync(portableRunRoot, { recursive: true });
  mkdirSync(decoyRunRoot, { recursive: true });
  const portableParentBytes = Buffer.from('{"trusted":true}\n');
  writeFileSync(join(portableRunRoot, 'review_pack.json'), portableParentBytes);
  writeFileSync(join(decoyRunRoot, 'review_pack.json'), '{"decoy":true}\n');
  const portableParent = buildRevisionLineageParent({
    artifactType: 'review_pack',
    role: 'review_pack',
    path: 'run/review_pack.json',
    sha256: sha256(portableParentBytes),
    sizeBytes: portableParentBytes.length,
  });
  await assert.rejects(
    () => verifyRevisionLineageParentReference(portableParent, { projectRoot: ROOT }),
    errorCode(REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH),
    'run/ parents must never fall back to projectRoot/run'
  );
  const verifiedPortableParent = await verifyRevisionLineageParentReference(portableParent, {
    projectRoot: ROOT,
    portablePathRoot: portableRunRoot,
  });
  assert.equal(verifiedPortableParent.sha256, sha256(portableParentBytes));
  await assert.rejects(
    () => verifyRevisionLineageParentReference(portableParent, {
      projectRoot: ROOT,
      portablePathRoot: tmpdir(),
    }),
    errorCode(REVISION_LINEAGE_REASON_CODES.PATH_ESCAPE)
  );
  for (const namespace of ['input', 'runtime']) {
    const forbiddenParent = buildRevisionLineageParent({
      artifactType: 'review_pack',
      role: 'review_pack',
      path: `${namespace}/review_pack.json`,
      sha256: SHA_A,
    });
    await assert.rejects(
      () => verifyRevisionLineageParentReference(forbiddenParent, { projectRoot: ROOT }),
      errorCode(REVISION_LINEAGE_REASON_CODES.UNSAFE_PATH)
    );
  }

  console.log('revision-lineage-contract.test.js: ok');
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
