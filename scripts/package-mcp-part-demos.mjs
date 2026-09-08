import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createNbcadArchive } from '../src/files/nbcad.ts';

const output = process.argv[2];
if (!output) throw new Error('Usage: node --import tsx scripts/package-mcp-part-demos.mjs /path/to/demo-output');
for (const name of ['mounting-plate', 'spacer', 'angle-bracket']) {
  const folder = resolve(output, name);
  const model = await readFile(resolve(folder, 'model.json'), 'utf8');
  const target = resolve(folder, `${name}.nbcad`);
  await writeFile(target, createNbcadArchive(model));
  console.log(target);
}
