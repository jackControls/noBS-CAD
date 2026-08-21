/**
 * Reproducible Ubuntu 26.04 package entry point.
 *
 * The Debian package intentionally consumes Ubuntu's OCCT 7.9 runtime. The
 * AppImage is self-contained by Tauri's linuxdeploy pass. Both packages carry
 * the project and third-party license notices.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

if (process.platform !== 'linux') {
  throw new Error('The Linux desktop packages must be built on Linux');
}

const projectRoot = realpathSync(join(import.meta.dirname, '..'));
const tauriRoot = join(projectRoot, 'src-tauri');
const licenseRoot = join(tauriRoot, 'linux-licenses');
mkdirSync(licenseRoot, { recursive: true });

function firstExisting(paths, label) {
  const found = paths.find((path) => path && existsSync(path));
  if (!found) {
    throw new Error(`${label} was not found; checked:\n${paths.join('\n')}`);
  }
  return found;
}

const occtCopyright = firstExisting(
  [
    process.env.OCCT_COPYRIGHT_FILE,
    '/usr/share/doc/libocct-foundation-7.9/copyright',
    '/usr/share/doc/libocct-data-exchange-7.9/copyright',
  ],
  'Ubuntu OCCT copyright notice',
);
const lgpl21 = firstExisting(
  ['/usr/share/common-licenses/LGPL-2.1', '/usr/share/common-licenses/LGPL-2'],
  'system LGPL 2.1 text',
);
copyFileSync(occtCopyright, join(licenseRoot, 'OCCT-copyright.txt'));
copyFileSync(lgpl21, join(licenseRoot, 'LGPL-2.1.txt'));

execFileSync('npm', ['run', 'build:wasm'], {
  cwd: projectRoot,
  stdio: 'inherit',
});
execFileSync(
  'npx',
  [
    'tauri',
    'build',
    '--bundles',
    'deb,appimage',
    '--config',
    'src-tauri/tauri.linux.conf.json',
  ],
  { cwd: projectRoot, stdio: 'inherit' },
);

function latestArtifact(directory, suffix) {
  const artifacts = readdirSync(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(directory, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
  const artifact = artifacts.at(-1);
  if (!artifact) throw new Error(`No ${suffix} artifact was created under ${directory}`);
  return artifact;
}

const targetRoot = process.env.CARGO_TARGET_DIR
  ? resolve(projectRoot, process.env.CARGO_TARGET_DIR)
  : join(tauriRoot, 'target');
const bundleRoot = join(targetRoot, 'release', 'bundle');
const deb = latestArtifact(join(bundleRoot, 'deb'), '.deb');
const appImage = latestArtifact(join(bundleRoot, 'appimage'), '.AppImage');
const requiredNotices = [
  'noBS-CAD-LICENSE.txt',
  'THIRD_PARTY_NOTICES.md',
  'OPENCASCADE_JS_LICENSE.txt',
  'OCCT-LGPL-2.1.txt',
  'OCCT-copyright.txt',
];

const debListing = execFileSync('dpkg-deb', ['--contents', deb], {
  encoding: 'utf8',
});
for (const notice of requiredNotices) {
  if (!debListing.includes(`/licenses/${notice}`)) {
    throw new Error(`Required license notice is missing from the Debian package: ${notice}`);
  }
}

chmodSync(appImage, 0o755);
const extractionRoot = mkdtempSync(join(tmpdir(), 'nbcad-appimage-'));
try {
  execFileSync(appImage, ['--appimage-extract'], {
    cwd: extractionRoot,
    stdio: 'ignore',
  });
  const extractedRoot = join(extractionRoot, 'squashfs-root');
  const allPaths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else allPaths.push(path);
    }
  };
  visit(extractedRoot);
  for (const notice of requiredNotices) {
    if (!allPaths.some((path) => basename(path) === notice)) {
      throw new Error(`Required license notice is missing from the AppImage: ${notice}`);
    }
  }
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}

function writeChecksum(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  const checksumPath = `${path}.sha256`;
  writeFileSync(checksumPath, `${hash.digest('hex')}  ${basename(path)}\n`);
  return checksumPath;
}

const debChecksum = writeChecksum(deb);
const appImageChecksum = writeChecksum(appImage);
console.log(`Verified Debian package: ${deb}`);
console.log(`Verified AppImage: ${appImage}`);
console.log(`Checksums: ${debChecksum}, ${appImageChecksum}`);
