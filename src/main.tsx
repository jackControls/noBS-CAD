import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BevyUiParityLab } from './dev/BevyUiParityLab';
import { I18nProvider } from './i18n';
import { startSessionBridge } from './sessionBridge';
import { useAppStore } from './store/appStore';
import './index.css';

// E2E/debug handle (harmless in production): lets automation read app state.
declare global {
  interface Window {
    __appStore?: typeof useAppStore;
  }
}
window.__appStore = useAppStore;
startSessionBridge();

const showBevyUiLab =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('bevy-ui-lab');
const Root = showBevyUiLab ? BevyUiParityLab : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <Root />
    </I18nProvider>
  </React.StrictMode>,
);
