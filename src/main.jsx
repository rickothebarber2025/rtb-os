import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProfileProvider } from './contexts/AuthProfileContext.jsx';
import './styles/global.css';
import './styles/mobileNavigation.css';
import './styles/mobileTopbar.css';
import './styles/operationsChecklist.css';
import './styles/staffMessageCenter.css';
import './styles/contractorCleaning.css';
import './styles/smartFlow.css';
import './styles/behavioralUX.css';
import './styles/humanExperience.css';
import './styles/integrations.css';
import './styles/staffHubHumanNav.css';
import './styles/staffHubVibes.css';
import './styles/accessControl.css';
import './styles/adaControl.css';
import './styles/staffHubMobileSimplify.css';
import './styles/googleHomeBridge.css';

const CACHE_CLEANUP_KEY = 'rtb-os-cache-cleanup-2026-07-12';

function clearLegacyServiceWorkerCache() {
  if (typeof window === 'undefined') return;

  const clearCaches = async () => {
    if (!('caches' in window)) return;
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
  };

  const clearWorkers = async () => {
    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
    if (!isNative && !window.localStorage.getItem(CACHE_CLEANUP_KEY)) {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await registration.update();
      window.localStorage.setItem(CACHE_CLEANUP_KEY, 'done');
    }
  };

  Promise.all([clearCaches(), clearWorkers()]).catch(() => {
    // Cache cleanup is best-effort; the app should still render if browser APIs fail.
  });
}

clearLegacyServiceWorkerCache();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProfileProvider>
        <App />
      </AuthProfileProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
