import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const article = 'knowledge/machine-design/concepts/example.md';
const sources = 'knowledge/machine-design/SOURCES.md';
const sourceRow = '| `example-source` | [Original](https://example.org/source) | Example Author | [License](https://creativecommons.org/licenses/by/4.0/) |';

async function fixture(t, mutate = async () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcad-knowledge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'package.json': '{"type":"module"}',
    'knowledge/index.md': '---\nokf_version: "0.2"\n---\n# Knowledge\n[Example](machine-design/concepts/example.md)\n',
    'knowledge/log.md': '# Updates\n\n## 2026-09-13\n\nAdded an example.\n',
    [sources]: `---\ntype: Concept\nstatus: stable\n---\n# Sources\n\n| id | Reference | Author | License |\n|----|-----------|--------|---------|\n${sourceRow}\n`,
    [article]: '---\ntype: Concept\nstatus: stable\nsources: example-source\nrelated_recipes: example-part\n---\n# Example\n[Sources](../SOURCES.md)\n',
    'examples/scripts/example-part.nbcad.jsonc': '{"version":1,"name":"Example","steps":[]}',
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await mkdir(path.join(root, 'scripts'));
  for (const name of ['check-knowledge.mjs', 'stage-showcase-media.mjs']) {
    await copyFile(path.join(scripts, name), path.join(root, 'scripts', name));
  }
  const replace = async (relative, before, after) => {
    const file = path.join(root, relative);
    const content = await readFile(file, 'utf8');
    assert.ok(content.includes(before), `fixture missing ${before}`);
    await writeFile(file, content.replace(before, after));
  };
  await mutate({ root, replace });
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-knowledge.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
}

test('knowledge gate accepts attributed articles with real recipe files', async t => {
  const result = await fixture(t);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, relative, before, after, message] of [
  ['unknown source', article, 'sources: example-source', 'sources: missing-source', 'unknown source id: missing-source'],
  ['missing sources', article, 'sources: example-source', 'sources: []', 'article requires sources'],
  ['duplicate sources', sources, sourceRow, `${sourceRow}\n${sourceRow}`, 'duplicate source id'],
  ['missing credit', sources, '| Example Author |', '|  |', 'requires a primary reference, author and license link'],
  ['unused source', sources, sourceRow, `${sourceRow}\n${sourceRow.replace('`example-source`', '`unused-source`')}`, 'unused source id'],
  ['missing recipe', article, 'example-part', 'missing-part', 'missing recipe: missing-part'],
  ['malformed recipe reference', article, 'example-part', '../example-part', 'related_recipes must contain comma-separated ids'],
  ['duplicate recipe reference', article, 'example-part', 'example-part, example-part', 'duplicate related_recipes reference'],
  ['incorrect link case', article, '../SOURCES.md', '../sources.md', 'incorrectly cased local link'],
]) {
  test(`knowledge gate rejects ${name}`, async t => {
    const result = await fixture(t, async ({ replace }) => replace(relative, before, after));
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(message), result.stderr);
  });
}

test('knowledge gate accepts CRLF metadata and an explicitly empty recipe list', async t => {
  const result = await fixture(t, async ({ root, replace }) => {
    await replace(article, 'related_recipes: example-part', 'related_recipes: []');
    const file = path.join(root, article);
    await writeFile(file, (await readFile(file, 'utf8')).replaceAll('\n', '\r\n'));
  });
  assert.equal(result.status, 0, result.stderr);
});
