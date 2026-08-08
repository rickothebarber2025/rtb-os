import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import MobileNavigationEnhancer from './components/MobileNavigationEnhancer.jsx';
import { AuthProfileProvider } from './contexts/AuthProfileContext.jsx';
import './styles/global.css';
import './styles/mobileNavigation.css';

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

    // Do not install a service worker inside the Capacitor native WebView.
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
        <MobileNavigationEnhancer />
        <App />
      </AuthProfileProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Native services start only after the UI has mounted. A push failure must never
// prevent RTB OS from rendering or leave the iOS WebView on a black screen.
window.setTimeout(() => {
  import('./lib/pushNotifications.js')
    .then(({ initializePushNotifications }) => initializePushNotifications())
    .catch((error) => {
      console.error('RTB push initialization failed', error);
    });
}, 750);
