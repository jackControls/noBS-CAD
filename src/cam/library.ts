import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../engine';
import type { CamDocumentDto, CamToolDto } from '../engine/types';
import { useAppStore } from '../store/appStore';

/**
 * Centralized, per-OS-user CAM tool library.
 *
 * The tool library follows the operator, not the project: tools are mirrored
 * to a platform config file (`cam-tool-library.json` in the app's per-user
 * config directory) on every mutation, and merged back into the machining
 * document when a project loads. Setups, operations, units, and post
 * defaults remain project data; only `tools` / `next_tool_id` centralize.
 * Outside the Tauri desktop runtime (browser dev, tests) the library stays
 * project-local and every call below is a no-op.
 */

export interface CentralCamLibrary {
  next_tool_id: number;
  tools: CamToolDto[];
}

async function loadCentralLibrary(): Promise<CentralCamLibrary | null> {
  if (!isTauriRuntime()) return null;
  try {
    const raw = await invoke<string | null>('cam_library_load');
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as CentralCamLibrary;
    if (!Array.isArray(parsed.tools) || !Number.isFinite(parsed.next_tool_id)) return null;
    return parsed;
  } catch {
    // A missing/corrupt library must never block project work; the
    // project-local tools remain the fallback.
    return null;
  }
}

async function saveCentralLibrary(tools: CamToolDto[], nextToolId: number): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('cam_library_save', {
      json: JSON.stringify({ next_tool_id: nextToolId, tools } satisfies CentralCamLibrary),
    });
  } catch {
    // Mirroring is best-effort; the project file still carries the tools.
  }
}

/** Union by tool id: central entries win (they are always freshest thanks to
 *  write-through), project-only entries are absorbed into the library. */
function mergeLibrary(project: CamDocumentDto, central: CentralCamLibrary): CentralCamLibrary {
  const tools = new Map<number, CamToolDto>();
  for (const tool of project.tools) tools.set(tool.id, tool);
  for (const tool of central.tools) tools.set(tool.id, tool);
  const merged = [...tools.values()].sort((a, b) => a.id - b.id);
  return {
    tools: merged,
    next_tool_id: Math.max(project.next_tool_id, central.next_tool_id),
  };
}

/** Mirror the document's tool library to the per-user store. Called after
 *  every tool-library mutation. */
export function mirrorCamLibraryToCentral(cam: CamDocumentDto): void {
  void saveCentralLibrary(cam.tools, cam.next_tool_id);
}

/** Merge the per-user library into the loaded document. The engine document
 *  is only rewritten when the merge actually changes the tool set, so steady
 *  state never dirties a freshly opened project. */
export async function syncCamLibraryFromCentral(): Promise<void> {
  const central = await loadCentralLibrary();
  const state = useAppStore.getState();
  const cam = state.camDocument;
  if (central === null) {
    // First run on this machine: adopt the project's library as the seed.
    if (cam.tools.length > 0) mirrorCamLibraryToCentral(cam);
    return;
  }
  const merged = mergeLibrary(cam, central);
  // Content comparison (not identity): the same tool set must not rewrite
  // the document, or every project open would dirty immediately.
  const projectSorted = [...cam.tools].sort((a, b) => a.id - b.id);
  const changed =
    merged.next_tool_id !== cam.next_tool_id ||
    JSON.stringify(merged.tools) !== JSON.stringify(projectSorted);
  if (changed) {
    await state.setCamDocument({ ...cam, tools: merged.tools, next_tool_id: merged.next_tool_id });
  }
  mirrorCamLibraryToCentral({ ...cam, tools: merged.tools, next_tool_id: merged.next_tool_id });
}
