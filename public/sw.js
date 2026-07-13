const CACHE_RESET_VERSION = 'rtb-os-cache-reset-2026-07-12';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      await self.registration.unregister();

      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
      });

      await Promise.all(
        clients.map((client) => {
          client.postMessage({ type: 'RTB_OS_CACHE_RESET', version: CACHE_RESET_VERSION });
          return 'navigate' in client ? client.navigate(client.url) : Promise.resolve();
        }),
      );
    })(),
  );
});

self.addEventListener('fetch', () => {
  return;
});
