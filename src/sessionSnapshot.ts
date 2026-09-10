import type { ProjectVisibilityDto } from './engine/types';

/** Publishing focus or an unchanged model must not itself create an edit. */
export async function synchronizeSnapshotVisibility(
  desired: ProjectVisibilityDto,
  read: () => Promise<ProjectVisibilityDto>,
  write: (visibility: ProjectVisibilityDto) => Promise<unknown>,
): Promise<void> {
  const current = await read();
  const keys = ['hidden_body_ids', 'hidden_datum_plane_ids', 'hidden_sketch_names'] as const;
  const same = keys.every(key => {
    const expected = new Set<number | string>(desired[key]);
    const actual = new Set<number | string>(current[key]);
    return expected.size === actual.size && [...expected].every(value => actual.has(value));
  });
  if (!same) await write(desired);
}

/** Keep native mutations outside the revision-protected snapshot interval. */
export async function captureSessionSnapshot<R>(operations: {
  synchronizeVisibility(): Promise<unknown>;
  reserve(): Promise<R>;
  activeSketch(): Promise<unknown | null>;
  exportModel(): Promise<string>;
}) {
  await operations.synchronizeVisibility();
  const reservation = await operations.reserve();
  const activeSketch = await operations.activeSketch();
  let modelJson: string | null = null;
  try {
    modelJson = await operations.exportModel();
  } catch (error) {
    // In-progress sketches cannot enter the completed project model.
    if (activeSketch === null) throw error;
  }
  return { reservation, activeSketch, modelJson };
}
