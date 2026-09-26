import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projects = [
  { recipe: 'garden-bench', name: 'bench.nbcad' },
  { recipe: 'd-screw-vise', name: 'vise.nbcad' },
  { recipe: 'vertical-axis-turbine', name: 'turbine.nbcad' },
];

export async function stageProjects({ source, destination, sourceCommit, applicationVersion }) {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(typeof applicationVersion, 'string');
  assert(applicationVersion.length > 0, 'Missing application version');
  // Validate every input before creating a publishable directory. The caller
  // downloads only this run's three successful platform/shard artifacts.
  const assets = await Promise.all(projects.map(async project => {
    const file = path.join(source, `${project.recipe}.nbcad`);
    const info = await lstat(file);
    assert(info.isFile() && info.size > 0, `Missing, empty or non-regular project: ${file}`);
    const bytes = await readFile(file);
    return { ...project, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  // Refuse stale output instead of mixing artifacts from different attempts.
  await mkdir(destination);
  for (const asset of assets) {
    await copyFile(path.join(source, `${asset.recipe}.nbcad`), path.join(destination, asset.name));
  }
  const manifest = { schema_version: 1, source_commit: sourceCommit, application_version: applicationVersion, assets };
  await writeFile(path.join(destination, 'demo-projects.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  await stageProjects({ source: 'target/mcp-recipe-evidence', destination: 'target/demo-projects',
    sourceCommit: process.env.GITHUB_SHA, applicationVersion: version });
}
