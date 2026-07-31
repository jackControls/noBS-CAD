import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
