/* Minimal service worker — enables installability on many browsers. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Do not intercept API calls. Passing POST/JSON through the service worker has
 * caused issues in Safari; unhandled fetch events use the default network path.
 */
self.addEventListener("fetch", (event) => {
  try {
    const url = new URL(event.request.url);
    if (url.pathname.includes("/api/")) {
      return;
    }
  } catch {
    /* ignore */
  }
  event.respondWith(fetch(event.request));
});
