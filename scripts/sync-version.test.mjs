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
  npmLockfileVersions,
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

test('the npm lockfile is checked at both places it records the version', () => {
  const lock = [
    '{',
    '  "name": "nbcad",',
    '  "version": "0.2.0",',
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "nbcad",',
    '      "version": "0.2.0"',
    '    },',
    '    "node_modules/vite": {',
    '      "version": "7.0.1"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(npmLockfileVersions(lock), { header: '0.2.0', packages: '0.2.0' });
  assert.equal(npmLockfileVersions(withNpmVersion(lock, '0.3.0')).packages, '0.3.0');

  const stale = JSON.parse(lock);
  stale.packages[''].version = '9.9.9';
  const staleText = `${JSON.stringify(stale, null, 2)}\n`;
  assert.deepEqual(npmLockfileVersions(staleText), { header: '0.2.0', packages: '9.9.9' });
  const lockCarrier = versionCarriers().find(carrier => carrier.path === 'package-lock.json');
  assert.match(lockCarrier.verify(staleText, '0.2.0'), /packages\[""\]\.version/);
  assert.equal(lockCarrier.verify(lock, '0.2.0'), null);

  // A lockfile without the root package record only promises the header.
  const headerOnly = `${JSON.stringify({ name: 'nbcad', version: '0.2.0', lockfileVersion: 1 }, null, 2)}\n`;
  assert.deepEqual(npmLockfileVersions(headerOnly), { header: '0.2.0', packages: null });
  assert.equal(lockCarrier.verify(headerOnly, '0.2.0'), null);
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

test('packaged file names keep a prerelease suffix and return to stable', () => {
  const releaseCandidate = [
    '`noBS-CAD-0.3.0-rc.1-windows-x64.zip`,',
    '`noBS-CAD-0.3.0-rc.1-windows-<architecture>.zip.sha256`,',
    '`noBS.CAD_0.3.0-rc.1_amd64.deb`,',
  ].join(' ');
  assert.deepEqual(documentedVersions(releaseCandidate), ['0.3.0-rc.1', '0.3.0-rc.1', '0.3.0-rc.1']);
  assert.equal(withDocumentedVersions(releaseCandidate, '0.3.0-rc.1'), releaseCandidate);

  const stable = withDocumentedVersions(releaseCandidate, '0.3.0');
  assert.match(stable, /`noBS-CAD-0\.3\.0-windows-x64\.zip`/);
  assert.match(stable, /`noBS\.CAD_0\.3\.0_amd64\.deb`/);
  assert.doesNotMatch(stable, /rc\.1/);
  assert.deepEqual(documentedVersions(stable), ['0.3.0', '0.3.0', '0.3.0']);

  // A hyphenated prerelease identifier must not swallow the platform segment.
  assert.deepEqual(documentedVersions('noBS-CAD-0.3.0-rc-1-windows-x64.zip'), ['0.3.0-rc-1']);
  assert.deepEqual(documentedVersions('noBS.CAD_0.3.0-beta.2_amd64.AppImage'), ['0.3.0-beta.2']);
});

test('a packaged file name this script cannot read is reported, not skipped', () => {
  const install = versionCarriers().find(carrier => carrier.path === 'docs/INSTALL.md');
  assert.match(
    install.verify('Download `noBS-CAD-windows-x64.zip`.', '0.2.0'),
    /cannot read a version/,
  );
  assert.equal(install.verify('No packaged file names here.', '0.2.0'), null);
  assert.equal(install.verify('`noBS-CAD-0.2.0-windows-x64.zip`', '0.2.0'), null);
  assert.match(install.verify('`noBS-CAD-0.2.0-windows-x64.zip`', '0.3.0'), /expected 0\.3\.0/);
});

test('the checked-in tree is in sync and re-syncs from VERSION', async () => {
  assert.deepEqual(collectDrift(repositoryRoot), []);

  // The rehearsal must work whatever the repository currently says, including
  // on the pull request that performs a real bump.
  const current = readVersion(repositoryRoot);
  const target = nextVersion(current);
  assert.notEqual(target, current);

  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcad-version-tree-'));
  try {
    const carriers = versionCarriers(repositoryRoot);
    for (const carrier of carriers) {
      const file = path.join(root, carrier.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await readFile(path.join(repositoryRoot, carrier.path), 'utf8'));
    }
    await writeFile(path.join(root, versionFile), `${target}\n`);

    // The copied carriers still quote the current version wherever it is
    // written out, so a bump reports drift until the sync rewrites each one.
    const drift = collectDrift(root, target);
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
      assert.ok(drift.some(problem => problem.startsWith(`${file}:`)), `${file} should report drift for ${target}`);
    }
    assert.ok(!drift.some(problem => problem.startsWith('.github/workflows/desktop-packages.yml:')));

    const changed = syncAll(root, target);
    assert.ok(changed.includes('package.json'));
    assert.ok(changed.includes('Cargo.lock'));
    assert.ok(changed.includes('docs/INSTALL.md'));
    // Members already inherit the workspace version, so they need no rewrite.
    assert.ok(!changed.includes('crates/core/Cargo.toml'));
    assert.ok(!changed.includes('.github/workflows/desktop-packages.yml'));
    assert.deepEqual(collectDrift(root, target), []);
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, target);
    assert.equal(lock.packages[''].version, target);
    assert.match(await readFile(path.join(root, 'crates/core/Cargo.toml'), 'utf8'), /^version\.workspace = true$/m);

    // A stale root record alone must fail the check, not just the header.
    const stalePath = path.join(root, 'package-lock.json');
    lock.packages[''].version = '9.9.9';
    await writeFile(stalePath, `${JSON.stringify(lock, null, 2)}\n`);
    assert.ok(
      collectDrift(root, target).some(problem => problem.startsWith('package-lock.json:') && problem.includes('packages[""]')),
      'a stale packages[""] version must report drift',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// The next patch release, whatever the repository currently carries.
function nextVersion(version) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}
