import {createRoot} from 'react-dom/client';
import {AppearanceDialog} from './AppearanceDialog';
import {listenForModelKeys} from '../modelKeyboard';
import {useAppStore} from '../store/appStore';

/** Production settings and keyboard router, with only native build-info IPC replaced. */
export function mountSettingsContract() {
  Object.assign(window, {__TAURI_INTERNALS__: {invoke(command: string) {
    if (command !== 'native_build_info') throw new Error(`Unexpected Settings IPC: ${command}`);
    return Promise.resolve({version: '0.1.0', channel: 'preview', revision: '0123456789abcdef0123456789abcdef01234567ab', modified: true});
  }}});
  useAppStore.setState({settingsOpen: false});
  let modelEscapes = 0;
  // Register before the modal, just as an already-running CAD viewport does.
  const dispose = listenForModelKeys(event => {
    if (event.key === 'Escape') modelEscapes++;
  }, true);
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  root.render(<>
    <button onClick={() => useAppStore.getState().setSettingsOpen(true)}>Settings opener</button>
    <button aria-label="Newer focus">Outside</button>
    <AppearanceDialog />
  </>);
  return {
    modelEscapes: () => modelEscapes,
    unmount: () => {root.unmount(); dispose();},
  };
}
