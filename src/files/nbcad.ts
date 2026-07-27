import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const NBCAD_EXTENSION = '.nbcad';
export const NBCAD_FORMAT = 'nbcad-project';
export const NBCAD_CONTAINER_VERSION = 1;
export const LEGACY_PROJECT_EXTENSION = '.tfcad';
export const LEGACY_PROJECT_FORMAT = 'tfcad-project';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;

export interface NbcadManifest {
  format: string;
  container_version: typeof NBCAD_CONTAINER_VERSION;
  model: 'model.json';
  application: string;
  application_version: string;
  saved_at: string;
}

/** Build a standards-compliant ZIP archive carrying the custom extension. */
export function createNbcadArchive(modelJson: string): Uint8Array {
  // Parse before writing so a failed engine envelope cannot become a file
  // that merely looks like a project.
  const model = JSON.parse(modelJson) as { format?: unknown; schema_version?: unknown };
  if (model.format !== NBCAD_FORMAT || !Number.isInteger(model.schema_version)) {
    throw new Error('The engine produced an invalid project model.');
  }
  const manifest: NbcadManifest = {
    format: NBCAD_FORMAT,
    container_version: NBCAD_CONTAINER_VERSION,
    model: 'model.json',
    application: 'noBS CAD',
    application_version: '0.1.0',
    saved_at: new Date().toISOString(),
  };
  return zipSync(
    {
      'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      'model.json': strToU8(modelJson.endsWith('\n') ? modelJson : `${modelJson}\n`),
    },
    { level: 6 },
  );
}

/** Validate a `.nbcad` ZIP and return its authoritative `model.json`. */
export function readNbcadArchive(bytes: Uint8Array): {
  manifest: NbcadManifest;
  modelJson: string;
} {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('The project archive is empty or exceeds the 256 MB safety limit.');
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('This is not a ZIP-based .nbcad project.');
  }
  let files: Record<string, Uint8Array>;
  let expandedBytes = 0;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        const wanted = file.name === 'manifest.json' || file.name === 'model.json';
        if (!wanted) return false;
        expandedBytes += file.originalSize;
        if (expandedBytes > MAX_EXPANDED_BYTES) {
          throw new Error('expanded project exceeds the 512 MB safety limit');
        }
        return true;
      },
    });
  } catch (error) {
    throw new Error(
      `The .nbcad ZIP is damaged: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifestBytes = files['manifest.json'];
  const modelBytes = files['model.json'];
  if (!manifestBytes || !modelBytes) {
    throw new Error('The .nbcad archive must contain manifest.json and model.json.');
  }
  let manifest: NbcadManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as NbcadManifest;
  } catch {
    throw new Error('manifest.json is not valid JSON.');
  }
  if (manifest.container_version !== NBCAD_CONTAINER_VERSION || manifest.model !== 'model.json') {
    throw new Error('This .nbcad container version is not supported.');
  }
  if (manifest.format !== NBCAD_FORMAT && manifest.format !== LEGACY_PROJECT_FORMAT) {
    throw new Error(`Unsupported project format '${manifest.format}'.`);
  }
  // The Rust model loader performs the authoritative schema validation and
  // normalizes the one explicitly supported pre-rename format identifier.
  return { manifest, modelJson: strFromU8(modelBytes) };
}
