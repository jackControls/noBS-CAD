import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createNbcadArchive, readNbcadArchive } from './nbcad';

const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(name);
  console.log(`  [ok] ${name}`);
};
const modelJson = JSON.stringify({ format: 'nbcad-project', schema_version: 3 });
const bytes = createNbcadArchive(modelJson);
const roundtrip = readNbcadArchive(bytes);
check('new archive keeps container v1 and advertises model schema v3',
  roundtrip.manifest.container_version === 1 && roundtrip.manifest.model_schema_version === 3);
check('archive roundtrip preserves the authoritative model',
  roundtrip.modelJson.trim() === modelJson);

const files = unzipSync(bytes);
const manifest = JSON.parse(strFromU8(files['manifest.json']));
delete manifest.model_schema_version;
const legacyModel = JSON.stringify({ format: 'nbcad-project', schema_version: 2 });
const legacy = zipSync({
  'manifest.json': strToU8(JSON.stringify(manifest)),
  'model.json': strToU8(legacyModel),
});
check('legacy archives without the optional schema metadata remain readable',
  readNbcadArchive(legacy).modelJson === legacyModel);

manifest.model_schema_version = 2;
let mismatchRejected = false;
try {
  readNbcadArchive(zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) }));
} catch (error) {
  mismatchRejected = error instanceof Error && error.message.includes('do not match');
}
check('conflicting manifest/model schema versions are rejected', mismatchRejected);
