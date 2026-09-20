#!/usr/bin/env node
// Validate machine-design concept sources: keys ⊆ SOURCES.md id column.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mdRoot = path.join(root, 'knowledge', 'machine-design');
const sourcesFile = path.join(mdRoot, 'SOURCES.md');
const failures = [];

function frontmatter(content) {
  content = content.replaceAll('\r\n', '\n');
  if (!content.startsWith('---\n')) return new Map();
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return new Map();
  const fields = new Map();
  for (const line of content.slice(4, end).split('\n')) {
    const sep = line.indexOf(':');
    if (sep < 1 || /^\s/.test(line)) continue;
    fields.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }
  return fields;
}

const sourcesMd = await readFile(sourcesFile, 'utf8');
const ids = new Set(
  [...sourcesMd.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]),
);
if (ids.size < 5) {
  console.error('SOURCES.md: expected id column like | `nist-gdt-1` |');
  process.exit(1);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(abs)));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

for (const abs of await walk(path.join(mdRoot, 'concepts'))) {
  const fields = frontmatter(await readFile(abs, 'utf8'));
  const raw = fields.get('sources') || '';
  const keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const key of keys) {
    if (!ids.has(key)) {
      failures.push(
        `${path.relative(root, abs)}: unknown sources id '${key}'`,
      );
    }
  }
}

if (failures.length) {
  console.error('Help sources validation failed:');
  for (const f of failures) console.error('-', f);
  process.exit(1);
}
console.log(`Help sources OK (${ids.size} ids in SOURCES.md).`);
