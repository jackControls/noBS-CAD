import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stageProjects } from './stage-demo-projects.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nbcad-ci-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'inputs');
  await mkdir(source);
  for (const name of ['garden-bench', 'd-screw-vise', 'vertical-axis-turbine']) {
    await writeFile(path.join(source, `${name}.nbcad`), `test project: ${name}`);
  }
  return { source, destination: path.join(root, 'output'), sourceCommit: 'a'.repeat(40), applicationVersion: '0.2.0' };
}

test('three shards publish the existing asset names and verifiable provenance', async t => {
  const options = await fixture(t);
  const manifest = await stageProjects(options);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.source_commit, options.sourceCommit);
  assert.equal(manifest.application_version, '0.2.0');
  assert.deepEqual((await readdir(options.destination)).sort(), ['bench.nbcad', 'demo-projects.json', 'turbine.nbcad', 'vise.nbcad']);
  assert.deepEqual(JSON.parse(await readFile(path.join(options.destination, 'demo-projects.json'))), manifest);
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(options.destination, asset.name));
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
});

test('missing, empty and linked shard inputs cannot create a publishable directory', async t => {
  for (const kind of ['missing', 'empty', 'symlink']) {
    const options = await fixture(t);
    const turbine = path.join(options.source, 'vertical-axis-turbine.nbcad');
    await rm(turbine);
    if (kind === 'empty') await writeFile(turbine, '');
    if (kind === 'symlink') await symlink(path.join(options.source, 'garden-bench.nbcad'), turbine);
    await assert.rejects(stageProjects(options));
    await assert.rejects(readdir(options.destination), { code: 'ENOENT' });
  }
});

test('invalid provenance and stale output are refused without overwriting files', async t => {
  const options = await fixture(t);
  await assert.rejects(stageProjects({ ...options, sourceCommit: 'main' }));
  await assert.rejects(stageProjects({ ...options, applicationVersion: '' }));
  await mkdir(options.destination);
  const marker = path.join(options.destination, 'bench.nbcad');
  await writeFile(marker, 'keep existing output');
  await assert.rejects(stageProjects(options), { code: 'EEXIST' });
  assert.equal(await readFile(marker, 'utf8'), 'keep existing output');
});
