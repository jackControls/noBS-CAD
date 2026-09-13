// Pages serves these verified copies as video/mp4; release URLs remain downloads.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'jackControls/noBS-CAD';
const api = `https://api.github.com/repos/${repository}`;
const names = ['bench-build-full.mp4', 'vise-build-full.mp4', 'turbine-build-full.mp4'];
const maxMediaBytes = 128 * 1024 * 1024;
const maxJsonBytes = 1024 * 1024;
const sha256 = /^[a-f0-9]{64}$/;
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

// Pure and shared with the offline link checker. Only these three exact local
// sources may be absent from the checkout; all come from one pinned release.
export function mediaInputs(html) {
  const sources = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<source\b[^>]*>/gi)].map(([tag]) => {
    const attributes = {};
    for (const [, key, , value] of tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      requireThat(!(key in attributes), `Duplicate source attribute: ${key}`);
      attributes[key] = value;
    }
    const match = attributes['data-release-url']?.match(/^https:\/\/github\.com\/jackControls\/noBS-CAD\/releases\/download\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([a-z-]+\.mp4)$/);
    requireThat(match && !['latest', 'main', 'master'].includes(match[1]), 'Video source needs an exact pinned release URL');
    const [, release, name] = match;
    requireThat(names.includes(name) && attributes.src === `./media/${name}` && attributes.type === 'video/mp4', 'Video source must use its matching local MP4 path');
    return { name, release, src: attributes.src, url: attributes['data-release-url'] };
  });
  requireThat(sources.length === names.length && new Set(sources.map(s => s.name)).size === names.length, 'Showcase needs exactly one source for each flagship');
  requireThat(new Set(sources.map(s => s.release)).size === 1, 'Showcase media must use one release');
  return sources;
}

export function mediaAssets(manifest, inputs, release, commit) {
  const tag = inputs[0].release;
  requireThat(release.tag_name === tag && release.draft === false && Number.isFinite(Date.parse(release.published_at)), 'Showcase release is not published');
  requireThat(manifest.schema_version === 1 && manifest.release === tag, 'Manifest schema or release differs from source pin');
  requireThat(/^[a-f0-9]{40}$/.test(manifest.source_commit) && commit.sha === manifest.source_commit, 'Manifest source commit differs from release tag');
  requireThat(Array.isArray(manifest.assets) && Array.isArray(release.assets), 'Missing release asset inventory');
  for (const [label, assets] of [['manifest', manifest.assets], ['release', release.assets]]) {
    requireThat(assets.length <= 1000 && new Set(assets.map(a => a.name)).size === assets.length, `Duplicate or oversized ${label} inventory`);
    requireThat(assets.every(a => typeof a.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.name)), `Invalid ${label} asset name`);
  }
  return inputs.map(input => {
    const asset = manifest.assets.find(a => a.name === input.name);
    const published = release.assets.find(a => a.name === input.name);
    requireThat(asset && published, `Missing media: ${input.name}`);
    requireThat(Number.isSafeInteger(asset.bytes) && asset.bytes >= 12 && asset.bytes <= maxMediaBytes && sha256.test(asset.sha256), `Invalid media metadata: ${input.name}`);
    requireThat(published.size === asset.bytes && published.browser_download_url === input.url, `Published media differs from manifest: ${input.name}`);
    requireThat(!published.digest || published.digest === `sha256:${asset.sha256}`, `Published media digest differs: ${input.name}`);
    return { ...input, bytes: asset.bytes, sha256: asset.sha256 };
  });
}

async function response(url, fetcher) {
  const result = await fetcher(url, { signal: AbortSignal.timeout(120_000), headers: { Accept: '*/*', 'User-Agent': 'noBS-CAD-Pages-media' } });
  requireThat(result.ok && result.body, `Download failed (${result.status}): ${url}`);
  return result;
}

async function readJson(url, fetcher) {
  const result = await response(url, fetcher);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of result.body) {
    bytes += chunk.length;
    requireThat(bytes <= maxJsonBytes, `JSON download exceeds limit: ${url}`);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function download(asset, destination, fetcher) {
  const result = await response(asset.url, fetcher);
  const length = result.headers.get('content-length');
  requireThat(length === null || Number(length) === asset.bytes, `Content length differs: ${asset.name}`);
  const file = await open(destination, 'wx');
  const hash = createHash('sha256');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  try {
    for await (const chunk of result.body) {
      bytes += chunk.length;
      requireThat(bytes <= asset.bytes, `Media exceeds declared size: ${asset.name}`);
      if (prefix.length < 12) prefix = Buffer.concat([prefix, chunk]).subarray(0, 12);
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    requireThat(bytes === asset.bytes && hash.digest('hex') === asset.sha256, `Media hash or size differs: ${asset.name}`);
    requireThat(prefix.toString('ascii', 4, 8) === 'ftyp', `Media is not an MP4: ${asset.name}`);
  } finally {
    await file.close();
  }
}

export async function stageMedia({ html, site, fetcher = fetch }) {
  const inputs = mediaInputs(html);
  const tag = inputs[0].release;
  // Reserve the destination first: stale files must never pass as this build.
  const destination = path.join(site, 'media');
  await mkdir(destination);
  let staging;
  try {
    const release = await readJson(`${api}/releases/tags/${tag}`, fetcher);
    requireThat(release.tag_name === tag && release.draft === false, 'Showcase release is not public');
    const manifestUrl = `https://github.com/${repository}/releases/download/${tag}/release-manifest.json`;
    requireThat(release.assets?.filter(a => a.name === 'release-manifest.json' && a.browser_download_url === manifestUrl).length === 1, 'Missing public release manifest');
    const manifest = await readJson(manifestUrl, fetcher);
    const commit = await readJson(`${api}/commits/${tag}`, fetcher);
    const assets = mediaAssets(manifest, inputs, release, commit);
    staging = await mkdtemp(path.join(site, '.media-stage-'));
    for (const asset of assets) await download(asset, path.join(staging, asset.name), fetcher);
    // A release can be edited while its files download. Reject a moved tag or
    // replaced media/manifest instead of publishing a mixed release snapshot.
    const latestRelease = await readJson(`${api}/releases/tags/${tag}`, fetcher);
    const latestCommit = await readJson(`${api}/commits/${tag}`, fetcher);
    mediaAssets(manifest, inputs, latestRelease, latestCommit);
    const identity = value => JSON.stringify({
      id: value.id,
      assets: [...names, 'release-manifest.json'].map(name => {
        const asset = value.assets.find(a => a.name === name);
        return asset && [asset.name, asset.id, asset.size, asset.updated_at, asset.digest, asset.browser_download_url];
      }),
    });
    requireThat(identity(release) === identity(latestRelease), 'Release assets changed during download; retry after publication finishes');
    // All files are validated before the artifact receives playable media.
    await rmdir(destination);
    await rename(staging, destination);
    staging = undefined;
    return assets;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assets = await stageMedia({ html: await readFile(path.join(root, 'knowledge/showcase.html'), 'utf8'), site: path.join(root, '_site') });
  console.log(`Staged ${assets.length} verified showcase MP4s from ${assets[0].release}.`);
}
