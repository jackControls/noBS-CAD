/**
 * E2E runner: starts the vite dev server on port 7199 (kept clear of the
 * user's preview port 7100), waits for it, runs a Playwright suite, then
 * kills ONLY the server it started. Usage: `node scripts/run-e2e.mjs
 * [suite.mjs ...]` (default: e2e-sketch.mjs).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 7199;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const suiteFiles = process.argv.slice(2);
if (suiteFiles.length === 0) suiteFiles.push('e2e-sketch.mjs');

const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  // Own process group so the vite grandchild dies with the npm wrapper.
  detached: true,
});

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server did not come up on port ${PORT}`);
};

let code = 1;
try {
  await waitForServer();
  for (const suiteFile of suiteFiles) {
    console.log(`\n[e2e] ${suiteFile}`);
    const suite = spawn('node', [path.join(here, suiteFile)], {
      cwd: root,
      stdio: 'inherit',
    });
    const result = await new Promise((resolve) =>
      suite.on('close', (exitCode, signal) => resolve({ exitCode, signal })),
    );
    if (result.signal) {
      console.error(`[e2e] ${suiteFile} terminated by ${result.signal}`);
      code = 1;
    } else {
      code = result.exitCode ?? 1;
    }
    if (code !== 0) break;
  }
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM'); // kill the whole process group
  } catch {
    server.kill();
  }
}
process.exit(code);
