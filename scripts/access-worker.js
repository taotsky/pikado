// Replace the old offline worker without reloading or touching local projects.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const root = new URL('./', self.location.href);
    for (const name of await caches.keys()) {
      if (!name.startsWith('pikado-')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.origin === root.origin && url.pathname.startsWith(root.pathname)) {
          await cache.delete(request);
        }
      }
      if (!(await cache.keys()).length) await caches.delete(name);
    }
    // Claim old controlled pages with this network-only worker before unregistering.
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
