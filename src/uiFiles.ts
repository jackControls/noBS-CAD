import { invoke } from '@tauri-apps/api/core';
import { openProject, saveProject, renameProject } from './files/projectFiles';
import { translate } from './i18n';

export interface UiFileRequest {
  command?: 'open' | 'save' | 'rename';
  path?: string;
  name?: string;
  overwrite?: boolean;
  discard_changes?: boolean;
}

/** Same native file/engine pipeline as the File menu, with explicit paths in
 * place of OS dialogs that cannot be driven through the application's DOM. */
export async function operateUiFile(request: UiFileRequest): Promise<boolean> {
  if (request.command === 'rename') {
    if (!request.name) throw new Error(translate('ui.errorRenameRequiresName'));
    return renameProject(request.name);
  }
  if (!request.path || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(request.path)) throw new Error(translate('ui.errorAbsoluteFilePath'));
  if (!request.path.toLowerCase().endsWith('.nbcad')) throw new Error(translate('ui.errorProjectPathExtension'));
  if (request.command === 'open') return openProject({ filePath: request.path, discardChanges: request.discard_changes });
  if (request.command === 'save') {
    if (!request.overwrite && await invoke<boolean>('mcp_path_exists', { path: request.path })) throw new Error(translate('ui.errorFileExistsOverwrite'));
    return saveProject(true, { kind: 'native', path: request.path, name: request.path.split(/[\\/]/).pop()! });
  }
  throw new Error(translate('ui.errorUnknownFileCommand'));
}
