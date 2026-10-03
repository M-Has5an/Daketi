const CACHE='daketi-v2-2';
const SHELL=['./','./style.css','./client.js','./cards.js','./audio.js','./config.js','./shared/game.js','./vendor/socket.io.esm.min.js','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('daketi-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/socket.io')||url.pathname.startsWith('/api/')||url.pathname==='/health')return;
  // Refresh the shell when online; never cache private game state or credentials.
  event.respondWith(fetch(new Request(event.request,{cache:'no-cache'})).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||(event.request.mode==='navigate'?caches.match('./'):Response.error()))));
});
