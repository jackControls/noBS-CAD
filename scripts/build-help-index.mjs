#!/usr/bin/env node
// Build search index over knowledge/machine-design markdown articles.
// Skips pages with searchable: false (SOURCES, taxonomy).
// Usage: node scripts/build-help-index.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mdRoot = path.join(root, 'knowledge', 'machine-design');
const outFile = path.join(mdRoot, 'search-index.json');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(abs);
      return entry.isFile() && entry.name.endsWith('.md') ? [abs] : [];
    }),
  );
  return nested.flat();
}

function frontmatter(content) {
  content = content.replaceAll('\r\n', '\n');
  if (!content.startsWith('---\n')) return { fields: new Map(), body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return { fields: new Map(), body: content };
  const fields = new Map();
  for (const line of content.slice(4, end).split('\n')) {
    const sep = line.indexOf(':');
    if (sep < 1 || /^\s/.test(line)) continue;
    fields.set(
      line.slice(0, sep).trim(),
      line.slice(sep + 1).trim().replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, ''),
    );
  }
  return { fields, body: content.slice(end + 5) };
}

function csvList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().replace(/^`|`$/g, ''))
    .filter(Boolean);
}

function snippet(body, limit = 220) {
  const plain = body
    .replace(/^#.+$/gm, '')
    .replace(/^>.+$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length <= limit ? plain : `${plain.slice(0, limit - 1)}…`;
}

const files = await walk(mdRoot);
const entries = [];

for (const abs of files) {
  const rel = path.relative(path.join(root, 'knowledge'), abs).replaceAll('\\', '/');
  const raw = await readFile(abs, 'utf8');
  const { fields, body } = frontmatter(raw);
  if (fields.get('searchable') === 'false') continue;
  if (fields.get('type') !== 'Concept') continue;
  // Prefer concept articles under concepts/
  if (!rel.includes('/concepts/')) continue;

  const id = rel.replace(/\.md$/i, '').replaceAll('/', '.');
  const title =
    fields.get('title') ||
    (body.match(/^#\s+(.+)$/m) || [, path.basename(abs, '.md')])[1];
  entries.push({
    id,
    path: `knowledge/${rel}`,
    title,
    description: fields.get('description') || '',
    status: fields.get('status') || '',
    topics: csvList(fields.get('topics')),
    keywords: csvList(fields.get('keywords')),
    related_recipes: csvList(fields.get('related_recipes')),
    sources: csvList(fields.get('sources')),
    snippet: snippet(body),
  });
}

entries.sort((a, b) => a.id.localeCompare(b.id));

const index = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  count: entries.length,
  entries,
};

await writeFile(outFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`Wrote ${entries.length} help entries to ${path.relative(root, outFile)}`);
