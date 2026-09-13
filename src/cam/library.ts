import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../engine';
import type { CamToolDto } from '../engine/types';

/**
 * Two-scope tool library model.
 *
 * The CENTRAL library follows the OS user: every tool the operator ever
 * defined lives in `cam-tool-library.json` inside the app's per-user config
 * directory by default, or a folder selected in Settings → CAM. It also owns
 * tool-id allocation within that collection; separate collections are never
 * automatically reconciled or merged.
 *
 * The PROJECT library lives inside the machining document (and therefore
 * inside the .nbcad file): it holds full-data snapshots of exactly the
 * tools this project uses. Operations reference these snapshots, so a
 * project file is self-contained and portable; editing the central library
 * never silently rewrites an existing project. Synchronisation is always an
 * explicit operator action — import (central -> project) or publish
 * (project -> central) — never a background merge.
 *
 * Outside the Tauri desktop runtime (browser dev, tests) there is no
 * central library; every central call below is a no-op and the project
 * library works standalone.
 */

export interface CentralCamLibrary {
  next_tool_id: number;
  tools: CamToolDto[];
}

interface LibrarySnapshot { json: string | null; path: string; revision: string }
const snapshots = new WeakMap<CentralCamLibrary, LibrarySnapshot>();
export interface CentralLibraryLocation {
  directory: string; path: string; is_default: boolean; exists: boolean; tool_count: number;
}
export async function centralLibraryLocation(): Promise<CentralLibraryLocation> {
  return invoke('cam_library_location');
}
export async function inspectCentralLibraryLocation(directory: string | null): Promise<CentralLibraryLocation> {
  return invoke('cam_library_inspect_location', { directory });
}
export async function setCentralLibraryLocation(directory: string | null, action: 'use_existing' | 'copy_current'): Promise<CentralLibraryLocation> {
  return invoke('cam_library_set_location', { directory, action });
}

/** Central storage only exists inside the desktop runtime. */
export function centralLibraryAvailable(): boolean {
  return isTauriRuntime();
}

export async function loadCentralLibrary(): Promise<CentralCamLibrary | null> {
  if (!isTauriRuntime()) return null;
  try {
    const snapshot = await invoke<LibrarySnapshot>('cam_library_load');
    const parsed = snapshot.json === null ? { next_tool_id: 1, tools: [] } : JSON.parse(snapshot.json) as CentralCamLibrary;
    if (!Array.isArray(parsed.tools) || !Number.isFinite(parsed.next_tool_id)) return null;
    snapshots.set(parsed, snapshot);
    return parsed;
  } catch {
    // A missing/corrupt library must never block project work; the project
    // snapshots remain the fallback.
    return null;
  }
}

async function saveCentralLibrary(library: CentralCamLibrary): Promise<void> {
  if (!isTauriRuntime()) return;
  const snapshot = snapshots.get(library);
  if (!snapshot) throw new Error('Reload the central tool library before saving.');
  const next = await invoke<LibrarySnapshot>('cam_library_save', {
    json: JSON.stringify(library), expectedPath: snapshot.path, expectedRevision: snapshot.revision,
  });
  snapshots.set(library, next);
}

async function editableLibrary(expected?: CentralCamLibrary): Promise<CentralCamLibrary | null> {
  if (!expected) return loadCentralLibrary();
  const copy = structuredClone(expected);
  const snapshot = snapshots.get(expected);
  if (!snapshot) throw new Error('Reload the central tool library before editing.');
  snapshots.set(copy, snapshot);
  return copy;
}

/** Next free central id: past both the counter and every live entry. */
function freeId(library: CentralCamLibrary): number {
  return Math.max(library.next_tool_id, ...library.tools.map((tool) => tool.id + 1), 1);
}

/** Add a tool to the central collection, allocating its id. Returns the
 *  stored tool (with id), or null when there is no central library. */
export async function addCentralLibraryTool(
  draft: Omit<CamToolDto, 'id'>,
  expected?: CentralCamLibrary,
): Promise<CamToolDto | null> {
  const library = await editableLibrary(expected);
  if (library === null) return null;
  const tool: CamToolDto = { ...structuredClone(draft), id: freeId(library) };
  library.tools.push(tool);
  library.tools.sort((a, b) => a.id - b.id);
  library.next_tool_id = tool.id + 1;
  await saveCentralLibrary(library);
  return tool;
}

export async function updateCentralLibraryTool(
  toolId: number,
  mutate: (tool: CamToolDto) => void,
  expected?: CentralCamLibrary,
): Promise<void> {
  const library = await editableLibrary(expected);
  if (library === null) throw new Error('The central library is unavailable. Check its folder in Settings.');
  const tool = library.tools.find((candidate) => candidate.id === toolId);
  if (!tool) return;
  mutate(tool);
  await saveCentralLibrary(library);
}

/** Deleting from the central collection never touches project snapshots —
 *  they are independent copies by design. */
export async function deleteCentralLibraryTool(toolId: number, expected?: CentralCamLibrary): Promise<void> {
  const library = await editableLibrary(expected);
  if (library === null) throw new Error('The central library is unavailable. Check its folder in Settings.');
  library.tools = library.tools.filter((candidate) => candidate.id !== toolId);
  await saveCentralLibrary(library);
}

/** Publish a project snapshot into the central collection: replace the
 *  same-id entry when one exists, append otherwise. */
export async function publishToolToCentralLibrary(tool: CamToolDto): Promise<void> {
  const library = await loadCentralLibrary();
  if (library === null) throw new Error('The central library is unavailable. Check its folder in Settings.');
  const index = library.tools.findIndex((candidate) => candidate.id === tool.id);
  const snapshot = structuredClone(tool);
  if (index >= 0) library.tools[index] = snapshot;
  else library.tools.push(snapshot);
  library.tools.sort((a, b) => a.id - b.id);
  library.next_tool_id = Math.max(library.next_tool_id, tool.id + 1);
  await saveCentralLibrary(library);
}

/** Fetch one central entry (import source for the project library). */
export async function centralLibraryTool(toolId: number): Promise<CamToolDto | null> {
  const library = await loadCentralLibrary();
  return library?.tools.find((candidate) => candidate.id === toolId) ?? null;
}
