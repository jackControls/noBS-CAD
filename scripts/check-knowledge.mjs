import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaInputs } from './stage-showcase-media.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const bundleRoot = path.join(repositoryRoot, 'knowledge');
const failures = [];

const fail = (file, message) => {
  failures.push(`${path.relative(repositoryRoot, file)}: ${message}`);
};

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(absolute);
      return entry.isFile() && entry.name.endsWith('.md') ? [absolute] : [];
    }),
  );
  return nested.flat();
}

function frontmatter(content) {
  // Git may check Markdown out with CRLF on Windows.
  content = content.replaceAll('\r\n', '\n');
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const fields = new Map();
  for (const line of content.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1 || /^\s/.test(line)) continue;
    fields.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim().replace(/^["']|["']$/g, ''),
    );
  }
  return fields;
}

async function exists(absolute) {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

function localMarkdownLinks(content) {
  return [...content.matchAll(/(?<!!)\[[^\]]*]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#', 1)[0])
    .filter(
      (target) =>
        target &&
        !target.startsWith('#') &&
        !target.startsWith('http://') &&
        !target.startsWith('https://') &&
        !target.startsWith('mailto:'),
    );
}

const files = await markdownFiles(bundleRoot);
const indexFile = path.join(bundleRoot, 'index.md');
const logFile = path.join(bundleRoot, 'log.md');
const conceptFiles = files.filter(
  (file) => file !== indexFile && file !== logFile,
);

// Authored machine-design references live in the bundle, not a second index.
const sourcesFile = path.join(bundleRoot, 'machine-design', 'SOURCES.md');
const sourceIds = new Set();
for (const line of (await readFile(sourcesFile, 'utf8')).split(/\r?\n/)) {
  if (!line.startsWith('| `')) continue;
  const columns = line.split('|').map(column => column.trim());
  const id = columns[1]?.match(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/)?.[1];
  if (!id) { fail(sourcesFile, 'invalid source id'); continue; }
  if (sourceIds.has(id)) fail(sourcesFile, `duplicate source id: ${id}`);
  sourceIds.add(id);
  if (!/\[[^\]]+\]\(https:\/\/[^)]+\)/.test(columns[2] ?? '') ||
      !columns[3] || !/\[[^\]]+\]\(https:\/\/[^)]+\)/.test(columns[4] ?? '')) {
    fail(sourcesFile, `source ${id} requires a primary reference, author and license link`);
  }
}
if (sourceIds.size === 0) fail(sourcesFile, 'source inventory is empty');
const usedSources = new Set();

function referenceIds(file, fields, key) {
  const raw = fields.get(key) ?? '';
  if (raw === '[]' || !raw) return [];
  const ids = raw.split(',').map(value => value.trim());
  if (ids.some(id => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) {
    fail(file, `${key} must contain comma-separated ids or []`);
    return [];
  }
  if (new Set(ids).size !== ids.length) fail(file, `duplicate ${key} reference`);
  return ids;
}

const indexContent = await readFile(indexFile, 'utf8');
const indexFields = frontmatter(indexContent);
if (!indexFields || indexFields.get('okf_version') !== '0.2') {
  fail(indexFile, 'root index must declare okf_version: "0.2"');
} else {
  const unexpected = [...indexFields.keys()].filter(
    (key) => key !== 'okf_version',
  );
  if (unexpected.length > 0) {
    fail(indexFile, `unexpected index frontmatter: ${unexpected.join(', ')}`);
  }
}

const logContent = await readFile(logFile, 'utf8');
if (frontmatter(logContent)) {
  fail(logFile, 'reserved log.md must not use concept frontmatter');
}
const logDates = [...logContent.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gm)].map(
  (match) => match[1],
);
if (logDates.length === 0) {
  fail(logFile, 'must contain ISO-date section headings');
} else if ([...logDates].sort().reverse().join() !== logDates.join()) {
  fail(logFile, 'date sections must be newest first');
}

for (const file of conceptFiles) {
  const content = await readFile(file, 'utf8');
  const fields = frontmatter(content);
  if (!fields) {
    fail(file, 'concept must start with YAML frontmatter');
    continue;
  }
  if (!fields.get('type')) fail(file, 'concept frontmatter requires type');
  const status = fields.get('status');
  if (status && !['draft', 'stable', 'deprecated'].includes(status)) {
    fail(file, `unsupported OKF lifecycle status: ${status}`);
  }
  if (path.relative(bundleRoot, file).replaceAll('\\', '/').startsWith('machine-design/concepts/')) {
    const sources = referenceIds(file, fields, 'sources');
    if (sources.length === 0) fail(file, 'mechanical-design article requires sources');
    for (const id of sources) {
      if (!sourceIds.has(id)) fail(file, `unknown source id: ${id}`);
      usedSources.add(id);
    }
  }
  for (const id of referenceIds(file, fields, 'related_recipes')) {
    if (!await exactFile(path.join(repositoryRoot, 'examples', 'scripts', `${id}.nbcad.jsonc`))) {
      fail(file, `missing recipe: ${id}`);
    }
  }
}
for (const id of sourceIds) {
  if (!usedSources.has(id)) fail(sourcesFile, `unused source id: ${id}`);
}

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const target of localMarkdownLinks(content)) {
    const absolute = path.resolve(path.dirname(file), target);
    if (!(await exactFile(absolute))) fail(file, `missing or incorrectly cased local link: ${target}`);
  }
}

// Pages are part of the public entry path. Check each local link/asset and
// repository source link, including case so a Windows checkout cannot hide a
// link that will fail on GitHub's Linux host. Release assets are verified by
// the release promotion gate, after the draft is published.
const pageFiles = (await readdir(bundleRoot)).filter(name => name.endsWith('.html'));
async function exactFile(absolute) {
  const relative = path.relative(repositoryRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let current = repositoryRoot;
  for (const part of relative.split(path.sep)) {
    if (!(await readdir(current)).includes(part)) return false;
    current = path.join(current, part);
  }
  return exists(current);
}
for (const name of pageFiles) {
  const file = path.join(bundleRoot, name);
  const content = await readFile(file, 'utf8');
  let generatedMedia = new Set();
  if (name === 'showcase.html') {
    try { generatedMedia = new Set(mediaInputs(content).map(input => input.src)); }
    catch (error) { fail(file, error.message); }
  }
  for (const match of content.matchAll(/(?:href|src|poster)=["']([^"']+)["']/g)) {
    const [target, anchor] = match[1].split('#');
    if (!anchor && generatedMedia.has(target)) continue;
    let absolute;
    if (!target) absolute = file;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) absolute = path.resolve(bundleRoot, target);
    else {
      const repoPath = target.match(/^https:\/\/(?:github\.com\/jackControls\/noBS-CAD\/blob\/[^/]+|raw\.githubusercontent\.com\/jackControls\/noBS-CAD\/[^/]+)\/(.+)$/)?.[1];
      if (!repoPath) continue;
      absolute = path.resolve(repositoryRoot, repoPath);
    }
    if (!await exactFile(absolute)) { fail(file, `missing or incorrectly cased target: ${target}`); continue; }
    if (anchor && absolute.endsWith('.html')) {
      const linked = await readFile(absolute, 'utf8');
      if (!linked.includes(`id="${anchor}"`) && !linked.includes(`id='${anchor}'`)) fail(file, `missing page anchor: ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Knowledge bundle validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Knowledge bundle validation passed (${conceptFiles.length} concepts, OKF v0.2).`,
);
