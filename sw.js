const CACHE_VERSION = 'italpont-v6.0.3-shell-3';
const SHELL = [
  './','./index.html','./platform.js','./native.js','./pwa.js','./theme-v580.css','./theme-v590.css','./theme-v600.css?v=6.0.3','./manifest.webmanifest',
  './assets/kulturfarm-banner.jpg','./assets/app-icon.png',
  './assets/pwa/icon-192.png','./assets/pwa/icon-512.png','./assets/pwa/apple-touch-icon-180.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k.startsWith('italpont-')&&k!==CACHE_VERSION).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;

  // A verzióellenőrzés soha ne a cache-ből jöjjön.
  if(url.pathname.endsWith('/version.json')){
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{
      const copy=res.clone();caches.open(CACHE_VERSION).then(c=>c.put('./index.html',copy));return res;
    }).catch(()=>caches.match('./index.html')));return;
  }
  event.respondWith(caches.match(req).then(cached=>{
    const fresh=fetch(req).then(res=>{
      if(res.ok){const copy=res.clone();caches.open(CACHE_VERSION).then(c=>c.put(req,copy));}
      return res;
    }).catch(()=>cached);
    return cached||fresh;
  }));
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch(_){payload={body:event.data?.text?.()||''}}
  const title=payload.title||'🍺 ItalPont';
  const data=payload.data||{};
  const icon=new URL('./assets/pwa/icon-192.png',self.registration.scope).href;
  const options={
    body:payload.body||'Új esemény történt az ItalPontban.',
    icon,
    badge:icon,
    tag:data.drink_id?`italpont-drink-${data.drink_id}`:`italpont-${data.event_type||'event'}`,
    renotify:true,
    data:{...data,url:data.url||'./'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./',self.registration.scope).href;
  event.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if(client.url.startsWith(self.registration.scope)){
        try{await client.navigate(target)}catch(_){}
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
