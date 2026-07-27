import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// noBS CAD frontend dev server / build config.
// CLI args are forwarded by npm (`npm run dev -- --port 7100 --strictPort`)
// and take precedence over the values below.
export default defineConfig({
  plugins: [react()],
  // OpenCascade.js ships its Emscripten module as a JS + 48 MB WASM pair.
  // Treat the WASM import as an asset URL; the kernel is lazy-loaded only
  // when the first solid operation runs.
  assetsInclude: ['**/*.wasm'],
  // Keep output visible when running under the Tauri CLI.
  clearScreen: false,
  server: {
    port: 5173,
  },
});
