import {createRoot} from 'react-dom/client';
import {SketchPalette} from './SketchPalette';
import {useAppStore} from '../store/appStore';
import {I18nProvider} from '../i18n';

/** Real palette and document preferences; no replacement controls. */
export function mountSketchPaletteContract() {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  useAppStore.getState().setPaletteOption('sketchGrid', true);
  const root = createRoot(container);
  root.render(<I18nProvider><div data-mcp-surface="sketch-palette"><SketchPalette /></div></I18nProvider>);
  return {
    grid: () => useAppStore.getState().palette.sketchGrid,
    unmount: () => root.unmount(),
  };
}
