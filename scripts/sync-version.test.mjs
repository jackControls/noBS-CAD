import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectDrift,
  containerVersion,
  documentedVersions,
  lockfileVersions,
  manifestVersion,
  npmVersion,
  readVersion,
  repositoryRoot,
  syncAll,
  versionCarriers,
  versionFile,
  withContainerVersion,
  withDocumentedVersions,
  withLockfileVersions,
  withManifestVersion,
  withNpmVersion,
  withTauriVersion,
  withWorkspaceVersion,
  workspaceVersion,
} from './sync-version.mjs';

const memberManifest = [
  '[package]',
  'name = "nbcad-core"',
  'version = "0.2.0"',
  'edition = "2021"',
  '',
  '[dependencies]',
  'serde = "1"',
  '',
].join('\n');

/** Copy `VERSION` and every carrier into `root`, the way a release bump rehearses it. */
async function copyCarriers(root) {
  await writeFile(path.join(root, versionFile), await readFile(path.join(repositoryRoot, versionFile), 'utf8'));
  for (const carrier of versionCarriers(repositoryRoot)) {
    const target = path.join(root, carrier.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(repositoryRoot, carrier.path), 'utf8'));
  }
}

test('VERSION must hold exactly one semver version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcad-version-'));
  try {
    for (const bad of ['', '0.2', 'v0.2.0', '0.2.0 with notes', '0.02.0']) {
      await writeFile(path.join(root, versionFile), bad);
      assert.throws(() => readVersion(root), /semver/);
    }
    await writeFile(path.join(root, versionFile), '0.3.0\n');
    assert.equal(readVersion(root), '0.3.0');
    await writeFile(path.join(root, versionFile), '0.3.0-rc.1\n');
    assert.equal(readVersion(root), '0.3.0-rc.1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a workspace member inherits the version instead of repeating it', () => {
  assert.equal(manifestVersion(memberManifest), '0.2.0');
  const inherited = withManifestVersion(memberManifest, { inherit: true });
  assert.equal(manifestVersion(inherited), 'workspace');
  assert.match(inherited, /^version\.workspace = true$/m);
  assert.doesNotMatch(inherited, /version = "0\.2\.0"/);
  assert.equal(withManifestVersion(inherited, { inherit: true }), inherited);
  const literal = withManifestVersion(inherited, { version: '0.3.0' });
  assert.equal(manifestVersion(literal), '0.3.0');
  assert.doesNotMatch(literal, /workspace = true/);
  assert.match(literal, /^serde = "1"$/m);
});

test('the root workspace version is the one Rust value to change', () => {
  const manifest = [
    '[workspace]',
    'resolver = "2"',
    'members = [',
    '    "crates/core",',
    ']',
    '',
    '[workspace.package]',
    'version = "0.2.0"',
    '',
  ].join('\n');
  assert.equal(workspaceVersion(manifest), '0.2.0');
  const next = withWorkspaceVersion(manifest, '0.3.0');
  assert.equal(workspaceVersion(next), '0.3.0');
  assert.match(next, /members = \[/);
  assert.throws(() => workspaceVersion('[workspace]\nresolver = "2"\n'), /workspace\.package/);
});

test('lockfiles move only the packages this repository builds', () => {
  const lock = [
    'version = 4',
    '',
    '[[package]]',
    'name = "nbcad-core"',
    'version = "0.2.0"',
    '',
    '[[package]]',
    'name = "serde"',
    'version = "1.0.200"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
  ].join('\n');
  const names = ['nbcad-core'];
  const next = withLockfileVersions(lock, '0.3.0', names);
  assert.deepEqual([...lockfileVersions(next, names)], [['nbcad-core', '0.3.0']]);
  assert.match(next, /name = "serde"\nversion = "1\.0\.200"/);
  assert.equal(lockfileVersions(next, ['serde']).get('serde'), '1.0.200');
  assert.equal(lockfileVersions(next, names).size, 1);
});

test('npm manifests keep dependency versions and refuse lossy rewrites', () => {
  const lock = [
    '{',
    '  "name": "nbcad",',
    '  "version": "0.2.0",',
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "nbcad",',
    '      "version": "0.2.0",',
    '      "dependencies": {',
    '        "vite": "^7.0.0"',
    '      }',
    '    },',
    '    "node_modules/vite": {',
    '      "version": "7.0.1"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  const next = withNpmVersion(lock, '0.3.0');
  const parsed = JSON.parse(next);
  assert.equal(parsed.version, '0.3.0');
  assert.equal(parsed.packages[''].version, '0.3.0');
  assert.equal(parsed.packages['node_modules/vite'].version, '7.0.1');
  assert.equal(parsed.packages[''].dependencies.vite, '^7.0.0');
  const compact = lock.replace('  "name": "nbcad",', '  "name": "nbcad", "extra": { "a": 1 },');
  assert.throws(() => withNpmVersion(compact, '0.3.0'), /round-trip/);
});

test('a stale npm root package record is reported as drift', async () => {
  const lock = [
    '{',
    '  "name": "nbcad",',
    '  "version": "0.2.0",',
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "nbcad",',
    '      "version": "0.2.0"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  assert.equal(npmVersion(lock), '0.2.0');
  const staleText = lock.replace('      "name": "nbcad",\n      "version": "0.2.0"', '      "name": "nbcad",\n      "version": "9.9.9"');
  assert.notEqual(staleText, lock);
  assert.throws(() => npmVersion(staleText), /root package/);

  // The guard has to surface it too: leave VERSION and the top-level field alone
  // and change only the root package record of a copied tree.
  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcad-version-lock-'));
  try {
    await copyCarriers(root);
    assert.deepEqual(collectDrift(root), []);
    const lockPath = path.join(root, 'package-lock.json');
    const data = JSON.parse(await readFile(lockPath, 'utf8'));
    data.packages[''].version = '9.9.9';
    await writeFile(lockPath, `${JSON.stringify(data, null, 2)}\n`);
    const drift = collectDrift(root);
    assert.ok(
      drift.some(problem => problem.startsWith('package-lock.json:')),
      `expected the lockfile to report drift, got ${JSON.stringify(drift)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the Tauri config keeps its compact nested JSON intact', () => {
  const config = [
    '{',
    '  "$schema": "https://schema.tauri.app/config/2",',
    '  "productName": "noBS CAD",',
    '  "version": "0.2.0",',
    '  "plugins": {',
    '    "deep-link": { "desktop": { "schemes": ["nbcad"] } }',
    '  }',
    '}',
    '',
  ].join('\n');
  const next = withTauriVersion(config, '0.3.0');
  assert.match(next, /"version": "0\.3\.0"/);
  assert.match(next, /"deep-link": \{ "desktop": \{ "schemes": \["nbcad"\] \} \}/);
  assert.doesNotMatch(next, /0\.2\.0/);
});

test('the container manifest and documented file names follow VERSION', () => {
  const source = [
    '    container_version: NBCAD_CONTAINER_VERSION,',
    "    application_version: '0.2.0',",
    '',
  ].join('\n');
  assert.equal(containerVersion(source), '0.2.0');
  assert.match(withContainerVersion(source, '0.3.0'), /application_version: '0\.3\.0'/);

  const docs = '`noBS-CAD-0.2.0-windows-x64.zip`, `noBS.CAD_0.2.0_amd64.deb`, `bench.nbcad`';
  assert.deepEqual(documentedVersions(docs), ['0.2.0', '0.2.0']);
  const synced = withDocumentedVersions(docs, '0.3.0');
  assert.match(synced, /`noBS-CAD-0\.3\.0-windows-x64\.zip`/);
  assert.match(synced, /`noBS\.CAD_0\.3\.0_amd64\.deb`/);
  assert.match(synced, /`bench\.nbcad`/);
});

test('documented file names keep a prerelease and return to stable', () => {
  const docs = [
    '`noBS-CAD-0.2.0-windows-x64.zip`',
    '`noBS-CAD-0.2.0-windows-x64.zip.sha256`',
    '`noBS-CAD-0.2.0-windows-<architecture>.zip`',
    '`noBS.CAD_0.2.0_amd64.deb`',
    '`noBS.CAD_0.2.0_aarch64.dmg`',
    '`bench.nbcad`',
  ].join(', ');
  assert.deepEqual(documentedVersions(docs), ['0.2.0', '0.2.0', '0.2.0', '0.2.0', '0.2.0']);

  const prerelease = withDocumentedVersions(docs, '0.3.0-rc.1');
  assert.match(prerelease, /`noBS-CAD-0\.3\.0-rc\.1-windows-x64\.zip`/);
  assert.match(prerelease, /`noBS-CAD-0\.3\.0-rc\.1-windows-x64\.zip\.sha256`/);
  assert.match(prerelease, /`noBS-CAD-0\.3\.0-rc\.1-windows-<architecture>\.zip`/);
  assert.match(prerelease, /`noBS\.CAD_0\.3\.0-rc\.1_amd64\.deb`/);
  assert.match(prerelease, /`noBS\.CAD_0\.3\.0-rc\.1_aarch64\.dmg`/);
  assert.deepEqual(documentedVersions(prerelease), Array(5).fill('0.3.0-rc.1'));
  // Syncing an already synced prerelease must not append the suffix again.
  assert.equal(withDocumentedVersions(prerelease, '0.3.0-rc.1'), prerelease);

  // Promoting the prerelease to the stable release drops the suffix.
  const stable = withDocumentedVersions(prerelease, '0.3.0');
  assert.doesNotMatch(stable, /rc\.1/);
  assert.deepEqual(documentedVersions(stable), Array(5).fill('0.3.0'));
});

test('the checked-in tree is in sync and re-syncs from VERSION', async () => {
  assert.deepEqual(collectDrift(repositoryRoot), []);

  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcad-version-tree-'));
  try {
    await copyCarriers(root);
    const repositoryVersion = readVersion(repositoryRoot);
    // The rehearsal starts from a copy that agrees with the repository and bumps to
    // a version that copy cannot already carry. A fixed target stopped creating
    // drift as soon as the repository itself reached it, so a correct, fully
    // synchronized release bump failed this test.
    assert.deepEqual(collectDrift(root, repositoryVersion), []);
    const rehearsal = repositoryVersion === '9.9.9' ? '9.9.8' : '9.9.9';
    await writeFile(path.join(root, versionFile), `${rehearsal}\n`);

    // Every carrier that writes the version out still carries the repository's,
    // so the bump reports drift until the sync rewrites each of them.
    const drift = collectDrift(root, rehearsal);
    for (const file of [
      'Cargo.toml',
      'Cargo.lock',
      'src-tauri/Cargo.lock',
      'mcp-server/Cargo.lock',
      'package.json',
      'package-lock.json',
      'src-tauri/tauri.conf.json',
      'vcpkg.json',
      'src/files/nbcad.ts',
      'docs/INSTALL.md',
    ]) {
      assert.ok(drift.some(problem => problem.startsWith(`${file}:`)), `${file} should report drift`);
    }
    assert.ok(!drift.some(problem => problem.startsWith('.github/workflows/desktop-packages.yml:')));

    const changed = syncAll(root, rehearsal);
    assert.ok(changed.includes('package.json'));
    assert.ok(changed.includes('Cargo.lock'));
    assert.ok(changed.includes('docs/INSTALL.md'));
    // Members already inherit the workspace version, so they need no rewrite.
    assert.ok(!changed.includes('crates/core/Cargo.toml'));
    assert.ok(!changed.includes('.github/workflows/desktop-packages.yml'));
    assert.deepEqual(collectDrift(root, rehearsal), []);
    const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(lockfile.version, rehearsal);
    assert.equal(lockfile.packages[''].version, rehearsal);
    assert.match(await readFile(path.join(root, 'crates/core/Cargo.toml'), 'utf8'), /^version\.workspace = true$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
