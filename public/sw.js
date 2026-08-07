const CACHE='lineage-shell-v13-1';
const ASSETS=['/','/style.css','/app.js','/explorer.js','/tree-layout.js','/archive.js','/evidence.js','/memories.js','/quality-collab.js','/discovery-localization.js','/release13.js','/manifest.webmanifest','/favicon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||(url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/tree')))return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request).then(fallback=>fallback||caches.match('/')))))});
