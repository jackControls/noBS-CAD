import { mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(repoRoot, 'public', '__bevy_ui__');
const outputPath = join(outputDir, 'native.png');
await mkdir(outputDir, { recursive: true });

const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const args = [
  'run',
  '--manifest-path',
  join(repoRoot, 'src-tauri', 'Cargo.toml'),
  '--features',
  'dev-ui-lab',
  '--bin',
  'bevy-ui-lab',
  '--',
  outputPath,
];

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(cargo, args, {
    cwd: repoRoot,
    env: { ...process.env, CARGO_TERM_COLOR: 'always' },
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  const capture = await stat(outputPath);
  console.log(
    `Native Bevy UI capture ready: ${outputPath} (${Math.round(capture.size / 1024)} KiB)`,
  );
  console.log('Open Vite with ?bevy-ui-lab=native or ?bevy-ui-lab=compare.');
}
