import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Isolate parsing: a ZIP64 regression must fail rather than hang the test runner.
const archiveModule = new URL('../src/files/nbcad.ts', import.meta.url).href;
const source = `
  import { createNbcadArchive, readNbcadArchive } from ${JSON.stringify(archiveModule)};
  const bytes = createNbcadArchive(JSON.stringify({format: 'nbcad-project', schema_version: 3}));
  const offset = bytes.findIndex((v, i) => v === 0x50 && bytes[i + 1] === 0x4b
    && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02);
  if (offset < 0) throw new Error('Fixture has no central directory');
  // Compressed-size sentinel without the required ZIP64 extra field.
  new DataView(bytes.buffer).setUint32(offset + 20, 0xffffffff, true);
  try { readNbcadArchive(bytes); } catch { /* Rejecting malformed input is valid. */ }
`;
const probe = spawnSync(process.execPath,
  ['--import', 'tsx', '--input-type=module', '--eval', source],
  { timeout: 5000, encoding: 'utf8', windowsHide: true });
assert.ifError(probe.error);
assert.equal(probe.status, 0, probe.stderr);
console.log('  [ok] malformed ZIP64 metadata cannot hang project loading');
