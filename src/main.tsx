import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BevyUiParityLab } from './dev/BevyUiParityLab';
import { I18nProvider } from './i18n';
import { useLocaleStore } from './i18n/localeStore';
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
const RootComponent = showBevyUiLab ? BevyUiParityLab : App;

function AppRoot() {
  const locale = useLocaleStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <I18nProvider locale={locale}>
      <RootComponent />
    </I18nProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
);
