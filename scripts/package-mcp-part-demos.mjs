import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createNbcadArchive, readNbcadArchive } from '../src/files/nbcad.ts';

const output = process.argv[2];
if (!output) throw new Error('Usage: node --import tsx scripts/package-mcp-part-demos.mjs /path/to/demo-output');
for (const name of ['mounting-plate', 'spacer', 'angle-bracket']) {
  const folder = resolve(output, name);
  const model = await readFile(resolve(folder, 'model.json'), 'utf8');
  const target = resolve(folder, `${name}.nbcad`);
  await writeFile(target, createNbcadArchive(model));
  console.log(target);
}

// The assembly runner is optional when packaging only the three part goldens.
const assemblyFolder = resolve(output, 'parametric-assembly');
let assemblyModel;
try { assemblyModel = await readFile(resolve(assemblyFolder, 'model.json'), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (assemblyModel) {
  for (const [source, name] of [['baseline.json', 'parametric-assembly-before'], ['model.json', 'parametric-assembly']]) {
    const model = await readFile(resolve(assemblyFolder, source), 'utf8');
    const target = resolve(assemblyFolder, `${name}.nbcad`);
    await writeFile(target, createNbcadArchive(model));
    assert.deepEqual(JSON.parse(readNbcadArchive(await readFile(target)).modelJson), JSON.parse(model));
    console.log(target);
  }
}
