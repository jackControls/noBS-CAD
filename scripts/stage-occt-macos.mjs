/**
 * Stage the recursive OCCT dylib closure for Tauri's macOS bundler.
 *
 * Tauri accepts dylibs through bundle.macOS.frameworks, but the Homebrew
 * prefix and OCCT minor version are machine-specific. This script discovers
 * the actual dependency closure with otool, copies it to a generated staging
 * directory, normalizes all non-system install names to @rpath, and writes a
 * generated Tauri config overlay consumed by `npm run bundle:macos`.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const ENTRY_LIBRARIES = [
  'TKDESTEP',
  'TKXSBase',
  'TKDE',
  'TKFillet',
  'TKHLR',
  'TKOffset',
  'TKBO',
  'TKPrim',
  'TKTopAlgo',
  'TKMesh',
  'TKBRep',
  'TKGeomAlgo',
  'TKGeomBase',
  'TKG3d',
  'TKG2d',
  'TKMath',
  'TKernel',
];

if (process.platform !== 'darwin') {
  throw new Error('OCCT macOS staging must run on macOS');
}

const projectRoot = realpathSync(join(import.meta.dirname, '..'));
const tauriRoot = join(projectRoot, 'src-tauri');
const stageRoot = join(tauriRoot, 'occt-libs');
const licenseRoot = join(stageRoot, 'licenses');
const overlayPath = join(tauriRoot, 'tauri.occt.conf.json');
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '-';
const usesAdHocSigning = signingIdentity === '-';

const occtCandidates = [
  process.env.OCCT_ROOT,
  '/opt/homebrew/opt/opencascade',
  '/usr/local/opt/opencascade',
  '/opt/opencascade',
].filter(Boolean);
const occtRoot = occtCandidates.find((candidate) =>
  existsSync(join(candidate, 'lib', 'libTKernel.dylib')),
);
if (!occtRoot) {
  throw new Error(
    'OCCT SDK not found. Set OCCT_ROOT or install Homebrew opencascade (7.9.x).',
  );
}

function toolText(tool, args) {
  return execFileSync(tool, args, { encoding: 'utf8' });
}

function installName(path) {
  const lines = toolText('otool', ['-D', path])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 1 ? lines[1] : path;
}

function dependencies(path) {
  return toolText('otool', ['-L', path])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' (compatibility version')[0])
    .filter(Boolean);
}

function isSystem(path) {
  return path.startsWith('/usr/lib/') || path.startsWith('/System/Library/');
}

function resolveDependency(path, parent) {
  if (path.startsWith('@rpath/')) {
    const name = basename(path);
    const candidates = [
      join(occtRoot, 'lib', name),
      join(dirname(parent), name),
      `/opt/homebrew/opt/tbb/lib/${name}`,
      `/usr/local/opt/tbb/lib/${name}`,
    ];
    return candidates.find(existsSync) ?? null;
  }
  if (path.startsWith('@loader_path/')) {
    const candidate = join(dirname(parent), path.slice('@loader_path/'.length));
    return existsSync(candidate) ? candidate : null;
  }
  return existsSync(path) ? path : null;
}

const queue = ENTRY_LIBRARIES.map((name) => join(occtRoot, 'lib', `lib${name}.dylib`));
const libraries = new Map();
while (queue.length > 0) {
  const source = queue.shift();
  if (!source || !existsSync(source)) {
    throw new Error(`Required OCCT library is missing: ${source}`);
  }
  const outputName = basename(installName(source));
  if (libraries.has(outputName)) continue;
  libraries.set(outputName, realpathSync(source));

  for (const dependency of dependencies(source)) {
    if (isSystem(dependency) || dependency === installName(source)) continue;
    const resolved = resolveDependency(dependency, source);
    if (!resolved) {
      throw new Error(`Cannot resolve ${dependency}, required by ${source}`);
    }
    queue.push(resolved);
  }
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });
mkdirSync(licenseRoot, { recursive: true });

const licenseSources = [
  [
    join(occtRoot, 'share/doc/opencascade/LICENSE_LGPL_21.txt'),
    join(licenseRoot, 'OCCT-LGPL-2.1.txt'),
  ],
  [
    join(occtRoot, 'share/doc/opencascade/OCCT_LGPL_EXCEPTION.txt'),
    join(licenseRoot, 'OCCT_LGPL_EXCEPTION.txt'),
  ],
  [
    join(projectRoot, 'node_modules/opencascade.js/LICENSE'),
    join(licenseRoot, 'OPENCASCADE_JS_LICENSE.txt'),
  ],
];
for (const [source, destination] of licenseSources) {
  if (!existsSync(source)) {
    throw new Error(`Required dependency license is missing: ${source}`);
  }
  copyFileSync(source, destination);
}

for (const [outputName, source] of libraries) {
  const destination = join(stageRoot, outputName);
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
  execFileSync('install_name_tool', ['-id', `@rpath/${outputName}`, destination], {
    stdio: 'ignore',
  });
  for (const dependency of dependencies(destination)) {
    if (isSystem(dependency) || dependency === `@rpath/${outputName}`) continue;
    execFileSync(
      'install_name_tool',
      ['-change', dependency, `@rpath/${basename(dependency)}`, destination],
      { stdio: 'ignore' },
    );
  }
}

// The linker searches unversioned `libTK*.dylib` names while each staged
// library's install ID intentionally retains its ABI version.
for (const library of ENTRY_LIBRARIES) {
  const versioned = [...libraries.keys()].find((name) =>
    name.startsWith(`lib${library}.`),
  );
  if (!versioned) throw new Error(`No staged ABI library found for ${library}`);
  symlinkSync(versioned, join(stageRoot, `lib${library}.dylib`));
}

const frameworks = [...libraries.keys()]
  .sort()
  .map((name) => `./${relative(tauriRoot, join(stageRoot, name))}`);
writeFileSync(
  overlayPath,
  `${JSON.stringify(
    {
      bundle: {
        resources: {
          '../LICENSE': 'licenses/noBS-CAD-LICENSE.txt',
          '../THIRD_PARTY_NOTICES.md': 'licenses/THIRD_PARTY_NOTICES.md',
          './occt-libs/licenses/OCCT-LGPL-2.1.txt':
            'licenses/OCCT-LGPL-2.1.txt',
          './occt-libs/licenses/OCCT_LGPL_EXCEPTION.txt':
            'licenses/OCCT_LGPL_EXCEPTION.txt',
          './occt-libs/licenses/OPENCASCADE_JS_LICENSE.txt':
            'licenses/OPENCASCADE_JS_LICENSE.txt',
        },
        macOS: {
          frameworks,
          // Hardened runtime enforces library validation by signing team.
          // Ad-hoc identities have no Team ID, so a hardened local build is
          // rejected by dyld when it loads the bundled OCCT dylibs. Keep
          // hardened runtime for Developer ID releases and disable it only
          // for local/test DMGs.
          signingIdentity,
          hardenedRuntime: !usesAdHocSigning,
        },
      },
    },
    null,
    2,
  )}\n`,
);

// Final portability gate: a staged library may reference only @rpath or
// Apple system locations. Tauri rewrites the app executable's direct OCCT
// loads and signs these dylibs when it consumes the generated overlay.
for (const name of libraries.keys()) {
  const bad = dependencies(join(stageRoot, name)).filter(
    (dependency) => !isSystem(dependency) && !dependency.startsWith('@rpath/'),
  );
  if (bad.length > 0) {
    throw new Error(`${name} still contains non-portable dependencies: ${bad.join(', ')}`);
  }
}

const totalBytes = [...libraries.keys()].reduce(
  (sum, name) => sum + readFileSync(join(stageRoot, name)).byteLength,
  0,
);
console.log(
  `Staged ${libraries.size} OCCT/TBB dylibs (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) from ${occtRoot}`,
);
console.log(`Generated ${relative(projectRoot, overlayPath)}`);
