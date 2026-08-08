import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else files.push(path);
  }
  return files;
}

const files = await filesBelow(dist);
const wasm = files.filter((path) => path.endsWith('.wasm'));
if (wasm.length > 0) {
  throw new Error(
    `Desktop frontend unexpectedly contains browser WASM:\n${wasm
      .map((path) => `- ${relative(root, path)}`)
      .join('\n')}`,
  );
}

console.log('Desktop frontend contains no browser WASM assets.');
