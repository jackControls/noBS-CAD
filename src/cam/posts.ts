import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../engine';
import type { CamMachineAssignmentDto } from '../engine/types';

export interface PrivatePostEntry {
  file_name: string;
  bytes: number;
  kind: 'native_profile' | 'reference_only' | 'invalid';
  message: string;
  machine: CamMachineAssignmentDto | null;
}
export interface PrivatePostCatalog { directory: string; entries: PrivatePostEntry[] }
export async function privatePosts(): Promise<PrivatePostCatalog | null> {
  return isTauriRuntime() ? invoke('cam_posts_list') : null;
}
export const importPrivatePost = (source: string): Promise<PrivatePostCatalog> => invoke('cam_posts_import', { source });
export const openPrivatePostFolder = (): Promise<void> => invoke('cam_posts_open_folder');
export const savePrivatePostProfile = (fileName: string, machine: CamMachineAssignmentDto): Promise<PrivatePostCatalog> =>
  invoke('cam_posts_save_profile', { fileName, machine });
