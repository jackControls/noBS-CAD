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
