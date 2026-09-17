import '../index.css';
import {createRoot} from 'react-dom/client';
import {RibbonMenu} from './RibbonMenu';
import {SKETCH_TAB} from '../ribbon/config';

/**
 * Mounts the real Sketch DRAW menu so the flyout can be driven with real
 * pointer input by the UI contract runner.
 *
 * Issue 127: the packaged desktop shell paints an opaque native viewport above
 * the webview and cuts holes only for DOM overlay islands. The flyout overflows
 * the portaled menu's own box, so it must register its own island rect
 * (`data-native-viewport-overlay`) and mount on a DOM mutation instead of a
 * pure CSS `:hover` reveal, or the submenu stays behind the native surface.
 */
export function mountRibbonMenuContract() {
  const draw = SKETCH_TAB.panels.find((panel) => panel.id === 'draw');
  if (!draw?.menu) throw new Error('Sketch DRAW menu is missing from the product catalog');
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:40px;top:20px;z-index:50';
  document.body.replaceChildren(container);
  const root = createRoot(container);
  let closes = 0;
  root.render(<RibbonMenu entries={draw.menu} onClose={() => { closes += 1; }} />);
  return {
    closes: () => closes,
    unmount: () => root.unmount(),
  };
}
