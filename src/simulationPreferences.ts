export const GPU_STOCK_REMOVAL_STORAGE_KEY = 'nbcad.gpuStockRemoval';
export const DEFAULT_GPU_STOCK_REMOVAL = true;

/** Desktop CAM playback removes stock on the GPU unless turned off. */
export function readGpuStockRemoval(): boolean {
  if (typeof window === 'undefined') return DEFAULT_GPU_STOCK_REMOVAL;
  try {
    const stored = window.localStorage.getItem(GPU_STOCK_REMOVAL_STORAGE_KEY);
    return stored === null ? DEFAULT_GPU_STOCK_REMOVAL : stored !== 'false';
  } catch {
    return DEFAULT_GPU_STOCK_REMOVAL;
  }
}

export function persistGpuStockRemoval(enabled: boolean): boolean {
  if (typeof window === 'undefined') return enabled;
  try {
    window.localStorage.setItem(GPU_STOCK_REMOVAL_STORAGE_KEY, String(enabled));
  } catch {
    // A locked-down webview can deny storage. The live preference still works.
  }
  return enabled;
}
