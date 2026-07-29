import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
}

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const target of localMarkdownLinks(content)) {
    const absolute = path.resolve(path.dirname(file), target);
    if (!(await exists(absolute))) fail(file, `broken local link: ${target}`);
  }
}

const homeFile = path.join(bundleRoot, 'home.html');
const homeContent = await readFile(homeFile, 'utf8');
for (const match of homeContent.matchAll(/href=["']([^"']+)["']/g)) {
  const target = match[1].split('#', 1)[0];
  if (!target || /^https?:\/\//.test(target) || target.startsWith('mailto:')) {
    continue;
  }
  const absolute = path.resolve(bundleRoot, target);
  if (!(await exists(absolute))) fail(homeFile, `broken local link: ${target}`);
}

if (failures.length > 0) {
  console.error('Knowledge bundle validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Knowledge bundle validation passed (${conceptFiles.length} concepts, OKF v0.2).`,
);
