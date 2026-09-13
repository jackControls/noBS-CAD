import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mediaInputs, mediaAssets, stageMedia } from './stage-showcase-media.mjs';

const tag = 'preview-2026-09-12.2';
const sha = 'a'.repeat(40);
const base = `https://github.com/jackControls/noBS-CAD/releases/download/${tag}/`;
const names = ['bench-build-full.mp4', 'vise-build-full.mp4', 'turbine-build-full.mp4'];
const html = names.map(name => `<video><source src="./media/${name}" data-release-url="${base}${name}" type="video/mp4"></video>`).join('\n');
const media = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom00000000')]);
const digest = createHash('sha256').update(media).digest('hex');
const inputs = mediaInputs(html);
const manifest = { schema_version: 1, release: tag, source_commit: sha, assets: names.map(name => ({ name, bytes: media.length, sha256: digest })) };
const release = {
  tag_name: tag, draft: false, published_at: '2026-09-12T00:00:00Z',
  assets: [...names.map(name => ({ name, size: media.length, digest: `sha256:${digest}`, browser_download_url: base + name })), { name: 'release-manifest.json', browser_download_url: base + 'release-manifest.json' }],
};
const copy = value => structuredClone(value);

test('one source pin determines all three exact local video paths', () => {
  assert.equal(inputs.length, 3);
  assert.throws(() => mediaInputs(`<!-- ${html} -->`));
  for (const broken of [
    html.replace(tag, 'latest'), html.replace(tag, 'another-tag'),
    html.replace('./media/bench-build-full.mp4', './elsewhere/bench-build-full.mp4'),
    html.replace('type="video/mp4"', 'type="text/html"'),
    html + html, html.replace('src="./media/bench-build-full.mp4"', 'src="./media/bench-build-full.mp4" src="oops"'),
  ]) assert.throws(() => mediaInputs(broken));
});

test('manifest and public release must agree on provenance and unique bounded media', () => {
  assert.equal(mediaAssets(manifest, inputs, release, { sha }).length, 3);
  const badManifest = [
    m => m.schema_version = 2, m => m.release = 'other', m => m.source_commit = 'bad',
    m => m.assets.push(copy(m.assets[0])), m => m.assets[0].bytes = 128 * 1024 * 1024 + 1,
    m => m.assets[0].bytes = 1.5, m => m.assets[0].sha256 = 'bad', m => m.assets[0].name = '../bench.mp4',
  ];
  for (const mutate of badManifest) { const m = copy(manifest); mutate(m); assert.throws(() => mediaAssets(m, inputs, release, { sha })); }
  for (const mutate of [r => r.draft = true, r => r.published_at = null, r => r.assets[0].size++, r => r.assets[0].digest = `sha256:${'b'.repeat(64)}`, r => r.assets.push(copy(r.assets[0]))]) {
    const r = copy(release); mutate(r); assert.throws(() => mediaAssets(manifest, inputs, r, { sha }));
  }
  assert.throws(() => mediaAssets(manifest, inputs, release, { sha: 'b'.repeat(40) }));
});

function downloads({ corrupt, unpublished = false, moveTag = false, replaceManifest = false } = {}) {
  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    if (url.includes('/releases/tags/')) {
      const snapshot = { ...copy(release), draft: unpublished };
      if (replaceManifest && requests.length > 1) snapshot.assets.at(-1).id = 'replacement';
      return Response.json(snapshot);
    }
    if (url.endsWith('/release-manifest.json')) return Response.json(manifest);
    if (url.includes('/commits/')) return Response.json({ sha: moveTag && requests.length > 3 ? 'b'.repeat(40) : sha });
    assert(names.some(name => url === base + name), `Unexpected fetch: ${url}`);
    return new Response(corrupt && url.endsWith(names[1]) ? corrupt : media);
  };
  return { fetcher, requests };
}

test('verified staging writes exactly three playable copies; existing output is refused before fetching', async () => {
  const site = await mkdtemp(path.join(os.tmpdir(), 'nbcad-media-test-'));
  try {
    const network = downloads();
    await stageMedia({ html, site, fetcher: network.fetcher });
    assert.deepEqual((await readdir(path.join(site, 'media'))).sort(), [...names].sort());
    for (const name of names) assert.deepEqual(await readFile(path.join(site, 'media', name)), media);
    assert.equal(network.requests.length, 8);
    const again = downloads();
    await assert.rejects(stageMedia({ html, site, fetcher: again.fetcher }), /EEXIST/);
    assert.equal(again.requests.length, 0);
    assert.deepEqual(await readFile(path.join(site, 'media', names[0])), media);
  } finally { await rm(site, { recursive: true, force: true }); }
});

test('failed downloads remove partial media and staging; draft assets are never fetched', async () => {
  for (const options of [{ corrupt: Buffer.alloc(media.length) }, { corrupt: media.subarray(0, 12) }, { corrupt: Buffer.alloc(media.length + 1) }, { unpublished: true }, { moveTag: true }, { replaceManifest: true }]) {
    const site = await mkdtemp(path.join(os.tmpdir(), 'nbcad-media-test-'));
    try {
      const network = downloads(options);
      await assert.rejects(stageMedia({ html, site, fetcher: network.fetcher }));
      assert.deepEqual(await readdir(site), []);
      if (options.unpublished) assert.equal(network.requests.length, 1);
    } finally { await rm(site, { recursive: true, force: true }); }
  }
});

test('an unrelated stale media directory is preserved on refusal', async () => {
  const site = await mkdtemp(path.join(os.tmpdir(), 'nbcad-media-test-'));
  try {
    await mkdir(path.join(site, 'media'));
    await writeFile(path.join(site, 'media', 'stale.txt'), 'preserve');
    await assert.rejects(stageMedia({ html, site, fetcher: () => assert.fail('must stay offline') }));
    assert.equal(await readFile(path.join(site, 'media', 'stale.txt'), 'utf8'), 'preserve');
  } finally { await rm(site, { recursive: true, force: true }); }
});
