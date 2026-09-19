#!/usr/bin/env node
// One version for the whole repository.
//
// `VERSION` is the source. Every other carrier that must agree with it — the
// Cargo workspace and its members, the two standalone workspaces, the three
// lockfiles, the npm manifests, the Tauri shell, the vcpkg manifest, the
// `.nbcad` container manifest and the packaged-file examples in the docs — is
// derived from it here and verified in CI with `--check`.
//
//   node scripts/sync-version.mjs          rewrite every derived carrier
//   node scripts/sync-version.mjs --check  report carriers that disagree
//
// The desktop packaging workflow derives its artifact names from
// `package.json` at run time, so no YAML needs a literal version.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const versionFile = 'VERSION';
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function readVersion(root = repositoryRoot) {
  const raw = readFileSync(path.join(root, versionFile), 'utf8');
  const version = raw.trim();
  if (!semverPattern.test(version)) {
    throw new Error(`${versionFile} must hold one semver version, found ${JSON.stringify(raw)}`);
  }
  return version;
}

// --- Cargo manifests -------------------------------------------------------

// The text of one table, from its header up to the next top-level table.
function tableBody(text, header) {
  const start = text.indexOf(header);
  if (start < 0) return null;
  const rest = text.slice(start + header.length);
  const end = rest.search(/\n\[/);
  return end < 0 ? rest : rest.slice(0, end);
}

function replaceTableBody(text, header, next) {
  const body = tableBody(text, header);
  if (body === null) throw new Error(`no ${header} table`);
  const start = text.indexOf(header) + header.length;
  return text.slice(0, start) + next + text.slice(start + body.length);
}

/** `workspace` when the manifest inherits, otherwise the declared version. */
export function manifestVersion(text) {
  const body = tableBody(text, '[package]');
  if (body === null) throw new Error('manifest has no [package] table');
  if (/^version\.workspace = true$/m.test(body)) return 'workspace';
  const match = /^version = "([^"]*)"$/m.exec(body);
  if (!match) throw new Error('[package] declares no version');
  return match[1];
}

export function withManifestVersion(text, { inherit = false, version } = {}) {
  const body = tableBody(text, '[package]');
  const pattern = /^version(?:\.workspace = true| = "[^"]*")$/m;
  if (!pattern.test(body)) throw new Error('[package] declares no version');
  const next = body.replace(pattern, inherit ? 'version.workspace = true' : `version = "${version}"`);
  return replaceTableBody(text, '[package]', next);
}

export function workspaceVersion(text) {
  const body = tableBody(text, '[workspace.package]');
  if (body === null) throw new Error('no [workspace.package] table');
  const match = /^version = "([^"]*)"$/m.exec(body);
  if (!match) throw new Error('[workspace.package] declares no version');
  return match[1];
}

export function withWorkspaceVersion(text, version) {
  const body = tableBody(text, '[workspace.package]');
  const pattern = /^version = "[^"]*"$/m;
  if (!pattern.test(body)) throw new Error('[workspace.package] declares no version');
  return replaceTableBody(text, '[workspace.package]', body.replace(pattern, `version = "${version}"`));
}

// --- Lockfiles -------------------------------------------------------------

/** Version the lockfile records for each local package name it contains. */
export function lockfileVersions(text, names) {
  const versions = new Map();
  const pattern = new RegExp(`^name = "(${names.join('|')})"\nversion = "([^"]*)"$`, 'gm');
  for (const [, name, version] of text.matchAll(pattern)) versions.set(name, version);
  return versions;
}

export function withLockfileVersions(text, version, names) {
  const pattern = new RegExp(`(^name = "(?:${names.join('|')})"\nversion = ")[^"]*("$)`, 'gm');
  return text.replace(pattern, `$1${version}$2`);
}

// --- npm, Tauri and vcpkg manifests ---------------------------------------

function jsonDocument(text, label) {
  const data = JSON.parse(text);
  if (`${JSON.stringify(data, null, 2)}\n` !== text) {
    throw new Error(`${label} uses formatting this script cannot round-trip; edit it by hand`);
  }
  return data;
}

export function npmVersion(text) {
  return jsonDocument(text, 'npm manifest').version;
}

// A lockfile records the root package version twice: at the top level and in
// `packages[""]`. Both must be checked, or a merge resolution can leave one
// stale while the guard reports that every carrier agrees.
export function npmLockfileVersions(text) {
  const data = jsonDocument(text, 'npm lockfile');
  const root = data.packages?.[''];
  return { header: data.version, packages: root === undefined ? null : root.version };
}

export function withNpmVersion(text, version) {
  const data = jsonDocument(text, 'npm manifest');
  data.version = version;
  if (data.packages?.[''] !== undefined) data.packages[''].version = version;
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function tauriVersion(text) {
  const match = /^  "version": "([^"]*)",$/m.exec(text);
  if (!match) throw new Error('tauri.conf.json declares no top-level version');
  return match[1];
}

export function withTauriVersion(text, version) {
  const pattern = /^(  "version": ")[^"]*(",)$/m;
  if (!pattern.test(text)) throw new Error('tauri.conf.json declares no top-level version');
  return text.replace(pattern, `$1${version}$2`);
}

export function vcpkgVersion(text) {
  const data = jsonDocument(text, 'vcpkg manifest');
  if (typeof data['version-string'] !== 'string') throw new Error('vcpkg.json declares no version-string');
  return data['version-string'];
}

export function withVcpkgVersion(text, version) {
  const data = jsonDocument(text, 'vcpkg manifest');
  data['version-string'] = version;
  return `${JSON.stringify(data, null, 2)}\n`;
}

// --- Container manifest and documented package names ----------------------

export function containerVersion(text) {
  const match = /application_version: '([^']*)'/.exec(text);
  if (!match) throw new Error('nbcad.ts declares no application_version');
  return match[1];
}

export function withContainerVersion(text, version) {
  const pattern = /(application_version: ')[^']*(')/;
  if (!pattern.test(text)) throw new Error('nbcad.ts declares no application_version');
  return text.replace(pattern, `$1${version}$2`);
}

// Package file names carry the whole version, prerelease suffix included, and
// then continue with a platform segment. Match the complete version but stop at
// that boundary: a greedy prerelease pattern would otherwise swallow
// `-windows-x64.zip`, and a bare `MAJOR.MINOR.PATCH` pattern would silently drop
// the suffix on read-back.
const versionPattern = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;

function documentedPatterns() {
  return [
    new RegExp(String.raw`(noBS-CAD-)(${versionPattern})(?=-windows-|-ubuntu-)`, 'g'),
    new RegExp(String.raw`(noBS\.CAD_)(${versionPattern})(?=_)`, 'g'),
  ];
}

/** Versions quoted by packaged-file examples, which must all be the current one. */
export function documentedVersions(text) {
  return documentedPatterns().flatMap(pattern =>
    [...text.matchAll(pattern)].map(([, , version]) => version));
}

export function withDocumentedVersions(text, version) {
  return documentedPatterns().reduce(
    (current, pattern) => current.replace(pattern, (_match, prefix) => `${prefix}${version}`),
    text,
  );
}

// --- Carriers --------------------------------------------------------------

function scalarCarrier({ file, description, read, write }) {
  return {
    path: file,
    description,
    verify(text, version) {
      const found = read(text);
      return found === version ? null : `${description} is ${JSON.stringify(found)}, expected ${version}`;
    },
    sync(text, version) {
      const next = write(text, version);
      const found = read(next);
      if (found !== version) throw new Error(`${file} still reads ${JSON.stringify(found)} after rewriting`);
      return next;
    },
  };
}

function memberCarrier(file) {
  return {
    path: file,
    description: 'member version must inherit the workspace',
    verify(text) {
      const found = manifestVersion(text);
      return found === 'workspace'
        ? null
        : `declares version = ${JSON.stringify(found)}; use version.workspace = true`;
    },
    sync(text) {
      return withManifestVersion(text, { inherit: true });
    },
  };
}

const documentedDocs = [
  'docs/DEVELOPMENT.md',
  'docs/INSTALL.md',
  'docs/OCCT_PACKAGING.md',
  'docs/WINDOWS_PACKAGING.md',
];

/** Paths the root workspace owns, in the order the members are declared. */
export function workspaceMembers(root = repositoryRoot) {
  const manifest = readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
  const body = tableBody(manifest, '[workspace]');
  const members = /members = \[([^\]]*)\]/.exec(body ?? '');
  if (!members) throw new Error('root Cargo.toml declares no workspace members');
  return [...members[1].matchAll(/"([^"]+)"/g)].map(([, member]) => member);
}

/** Package names the repository builds itself, used to rewrite lockfiles. */
export function localPackageNames(root = repositoryRoot) {
  const manifests = [
    ...workspaceMembers(root).map(member => path.join(member, 'Cargo.toml')),
    'src-tauri/Cargo.toml',
    'mcp-server/Cargo.toml',
  ];
  return manifests.map((manifest) => {
    const text = readFileSync(path.join(root, manifest), 'utf8');
    const body = tableBody(text, '[package]');
    const match = /^name = "([^"]+)"$/m.exec(body ?? '');
    if (!match) throw new Error(`${manifest} declares no package name`);
    return match[1];
  });
}

export function versionCarriers(root = repositoryRoot) {
  const members = workspaceMembers(root);
  const names = localPackageNames(root);
  return [
    {
      path: 'Cargo.toml',
      description: 'workspace version',
      verify: (text, version) => verifyScalar(workspaceVersion, text, version, 'workspace version'),
      sync: (text, version) => withWorkspaceVersion(text, version),
    },
    ...members.map(member => memberCarrier(path.join(member, 'Cargo.toml'))),
    scalarCarrier({
      file: 'src-tauri/Cargo.toml',
      description: 'desktop shell version',
      read: manifestVersion,
      write: (text, version) => withManifestVersion(text, { version }),
    }),
    scalarCarrier({
      file: 'mcp-server/Cargo.toml',
      description: 'MCP server version',
      read: manifestVersion,
      write: (text, version) => withManifestVersion(text, { version }),
    }),
    ...['Cargo.lock', 'src-tauri/Cargo.lock', 'mcp-server/Cargo.lock'].map(file => ({
      path: file,
      description: 'lockfile version of every local package',
      verify(text, version) {
        const versions = lockfileVersions(text, names);
        const wrong = [...versions].filter(([, found]) => found !== version);
        if (versions.size === 0) return 'records none of the local packages';
        return wrong.length === 0
          ? null
          : `records ${wrong.map(([name, found]) => `${name} ${found}`).join(', ')}, expected ${version}`;
      },
      sync: (text, version) => withLockfileVersions(text, version, names),
    })),
    scalarCarrier({
      file: 'package.json',
      description: 'npm manifest version',
      read: npmVersion,
      write: withNpmVersion,
    }),
    {
      path: 'package-lock.json',
      description: 'npm lockfile version',
      verify(text, version) {
        const { header, packages } = npmLockfileVersions(text);
        const wrong = [];
        if (header !== version) wrong.push(`top-level version is ${JSON.stringify(header)}`);
        if (packages !== null && packages !== version) {
          wrong.push(`packages[""].version is ${JSON.stringify(packages)}`);
        }
        return wrong.length === 0 ? null : `${wrong.join('; ')}, expected ${version}`;
      },
      sync: withNpmVersion,
    },
    scalarCarrier({
      file: 'src-tauri/tauri.conf.json',
      description: 'Tauri bundle version',
      read: tauriVersion,
      write: withTauriVersion,
    }),
    scalarCarrier({
      file: 'vcpkg.json',
      description: 'native dependency manifest version',
      read: vcpkgVersion,
      write: withVcpkgVersion,
    }),
    scalarCarrier({
      file: 'src/files/nbcad.ts',
      description: 'container manifest application_version',
      read: containerVersion,
      write: withContainerVersion,
    }),
    ...documentedDocs.map(file => ({
      path: file,
      description: 'documented package file names',
      verify(text, version) {
        const found = documentedVersions(text);
        // A packaged name the patterns cannot read would otherwise be skipped
        // in silence, so report a mention that carries no recognizable version.
        if (found.length === 0) {
          return /noBS-CAD-|noBS\.CAD_/.test(text)
            ? 'mentions a packaged file name this script cannot read a version from'
            : null;
        }
        const wrong = found.filter(value => value !== version);
        return wrong.length === 0 ? null : `names ${[...new Set(wrong)].join(', ')}, expected ${version}`;
      },
      sync: (text, version) => withDocumentedVersions(text, version),
    })),
    {
      path: '.github/workflows/desktop-packages.yml',
      description: 'artifact names derived from package.json',
      verify(text) {
        const literals = text.match(new RegExp(`noBS(?:-CAD-|\\.CAD_)${versionPattern}`, 'g'));
        if (literals) return `hard-codes ${[...new Set(literals)].join(', ')}`;
        return /require\('\.\/package\.json'\)\.version/.test(text)
          ? null
          : 'no step reads the version from package.json';
      },
      sync: () => null,
    },
  ];
}

function verifyScalar(read, text, version, description) {
  const found = read(text);
  return found === version ? null : `${description} is ${JSON.stringify(found)}, expected ${version}`;
}

/** Every carrier that disagrees with `VERSION`, as human-readable messages. */
export function collectDrift(root = repositoryRoot, version = readVersion(root)) {
  const drift = [];
  for (const carrier of versionCarriers(root)) {
    let problem;
    try {
      problem = carrier.verify(readFileSync(path.join(root, carrier.path), 'utf8').replace(/\r\n/g, '\n'), version);
    } catch (error) {
      problem = error.message;
    }
    if (problem) drift.push(`${carrier.path}: ${problem}`);
  }
  return drift;
}

/** Rewrite every carrier to `VERSION`; returns the paths that changed. */
export function syncAll(root = repositoryRoot, version = readVersion(root)) {
  const changed = [];
  for (const carrier of versionCarriers(root)) {
    const file = path.join(root, carrier.path);
    const original = readFileSync(file, 'utf8');
    const text = original.replace(/\r\n/g, '\n');
    const next = carrier.sync(text, version);
    if (next === null || next === text) continue;
    writeFileSync(file, original.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next);
    changed.push(carrier.path);
  }
  return changed;
}

function main() {
  const check = process.argv.includes('--check');
  const version = readVersion();
  if (check) {
    const drift = collectDrift(repositoryRoot, version);
    if (drift.length > 0) {
      console.error(`VERSION is ${version}, but these carriers disagree:`);
      for (const problem of drift) console.error(`  ${problem}`);
      console.error('Run `node scripts/sync-version.mjs` and commit the result.');
      process.exitCode = 1;
      return;
    }
    console.log(`VERSION ${version} matches every carrier.`);
    return;
  }
  const changed = syncAll(repositoryRoot, version);
  console.log(changed.length === 0
    ? `VERSION ${version} already matches every carrier.`
    : `VERSION ${version} synced into:\n  ${changed.join('\n  ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
