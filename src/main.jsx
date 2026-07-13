import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProfileProvider } from './contexts/AuthProfileContext.jsx';
import './styles/global.css';

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

    if (!window.localStorage.getItem(CACHE_CLEANUP_KEY)) {
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
    <AuthProfileProvider>
      <App />
    </AuthProfileProvider>
  </React.StrictMode>,
);
