import { getEngine } from '../engine';
import type { NbPostAnalysisDto } from '../engine/types';
import { chooseOpenFile } from '../files/fileIO';
import { translate } from '../i18n';

const MAX_NBPOST_BYTES = 2 * 1024 * 1024;

/**
 * Select and inspect a user-owned `.nbpost`. The source is sent to the shared
 * Rust analyzer in memory and is neither executed nor added to the project.
 */
export async function inspectNbPostFile(): Promise<NbPostAnalysisDto | null> {
  const opened = await chooseOpenFile({
    description: 'noBS CAM post',
    extension: '.nbpost',
    mime: 'text/javascript',
  });
  if (!opened) return null;
  if (opened.bytes.byteLength > MAX_NBPOST_BYTES) {
    throw new Error(translate('cam.errors.errorNbpostSizeLimit'));
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(opened.bytes);
  } catch {
    throw new Error(translate('cam.errors.errorNbpostUtf8'));
  }

  return (await getEngine()).camAnalyzeNbPost({
    file_name: opened.name,
    source,
  });
}
