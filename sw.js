/* 리니: 앱처럼 쓰기 위한 오프라인 저장 (service worker)
   인터넷이 되면 항상 새 파일을 받아 오고 그 사본을 폰에 남긴다. 인터넷이 안 되거나 4초 넘게 걸리면 남겨 둔 사본으로 연다.
   그래서 게임을 고쳐 올리면 다음에 열 때 바로 반영되고, 전시장에서 인터넷이 끊겨도 게임이 열린다. */
const CACHE='linny-v1';
const FILES=['./','index.html','style.css','story.css','game.js','story.js','model.js','imu.js','manifest.webmanifest',
  'fonts/jua-korean-400-normal.woff2','fonts/jua-latin-400-normal.woff2','assets/img/linny.png','assets/img/wonny.png',
  'icons/icon-192.png','icons/icon-512.png'];
const WAIT_MS=4000;

self.addEventListener('install',e=>{ // 처음 설치할 때 게임에 필요한 파일을 미리 받아 둔다. 하나가 실패해도 나머지는 받는다
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(FILES.map(f=>c.add(new Request(f,{cache:'reload'})).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{ // 예전 버전의 사본은 지운다
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request, url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin) return; // 다른 곳으로 가는 요청은 건드리지 않는다
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const saved=()=>cache.match(req,{ignoreSearch:true}).then(r=>r||(req.mode==='navigate'?cache.match('index.html'):undefined));
    try{
      const fresh=await Promise.race([fetch(req,{cache:'no-cache'}),new Promise((_,no)=>setTimeout(()=>no(new Error('slow')),WAIT_MS))]);
      if(fresh.ok) cache.put(url.search?new Request(url.origin+url.pathname):req,fresh.clone());
      return fresh; // 없는 파일(model.json 등)의 404도 그대로 알린다
    }catch(err){
      const old=await saved();
      if(old) return old;
      return new Response('',{status:504,statusText:'offline'});
    }
  })());
});
