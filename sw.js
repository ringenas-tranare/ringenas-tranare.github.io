// Minimal service worker: gör appen installerbar, cachar inget (alltid senaste versionen).
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
