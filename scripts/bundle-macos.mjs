/**
 * Reproducible macOS app bundle entry point.
 *
 * Stage portable OCCT libraries first, then point the Rust link step at
 * those @rpath-normalized copies before Tauri copies/signs them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('The macOS app bundle must be built on macOS');
}

const projectRoot = realpathSync(join(import.meta.dirname, '..'));
execFileSync('npm', ['run', 'build:wasm'], {
  cwd: projectRoot,
  stdio: 'inherit',
});
execFileSync(process.execPath, [join(projectRoot, 'scripts/stage-occt-macos.mjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
});
execFileSync(
  'npx',
  [
    'tauri',
    'build',
    '--bundles',
    'app,dmg',
    '--config',
    'src-tauri/tauri.occt.conf.json',
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      NBCAD_OCCT_LIB_DIR: join(projectRoot, 'src-tauri/occt-libs'),
    },
    stdio: 'inherit',
  },
);

const appBundle = join(
  projectRoot,
  'src-tauri/target/release/bundle/macos/noBS CAD.app',
);
const requiredNotices = [
  'noBS-CAD-LICENSE.txt',
  'THIRD_PARTY_NOTICES.md',
  'OCCT-LGPL-2.1.txt',
  'OCCT_LGPL_EXCEPTION.txt',
  'OPENCASCADE_JS_LICENSE.txt',
];
for (const notice of requiredNotices) {
  const bundledPath = join(appBundle, 'Contents/Resources/licenses', notice);
  if (!existsSync(bundledPath)) {
    throw new Error(`Required license notice is missing from the app: ${bundledPath}`);
  }
}
if (!process.env.APPLE_SIGNING_IDENTITY) {
  // Rust emits a linker-level ad-hoc signature for the executable, not a
  // sealed app bundle. Seal the complete local bundle (including staged
  // dylibs) so Gatekeeper-style verification is meaningful in development.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], {
    stdio: 'inherit',
  });
}
execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle], {
  stdio: 'inherit',
});
const dmgDirectory = join(
  projectRoot,
  'src-tauri/target/release/bundle/dmg',
);
const dmgBundle = readdirSync(dmgDirectory)
  .filter((name) => name.endsWith('.dmg'))
  .map((name) => join(dmgDirectory, name))
  .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
  .at(-1);
if (!dmgBundle) {
  throw new Error(`Tauri did not create a DMG under ${dmgDirectory}`);
}
execFileSync('hdiutil', ['verify', dmgBundle], { stdio: 'inherit' });
console.log(`Verified portable app bundle: ${appBundle}`);
console.log(`Verified disk image: ${dmgBundle}`);
