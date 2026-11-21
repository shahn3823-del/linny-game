/* 리니: 휴대폰 내장 IMU로 동작 판단
   휴대폰을 휠체어(의자)에 가로로 고정하고, 화면이 아이를 향하게 둔다. 세워도 되고 비스듬히 눕혀도 된다.
     앞뒤 왕복(pump)  : 중력을 뺀 가속도의 앞뒤 성분이 문턱을 넘으면 1번 인정 → 자동차 부스트
     제자리 회전(spin) : 수직축 회전 속도가 문턱을 넘는 순간 1번 인정 → 호두과자 뒤집기 (속도가 줄어야 다시 인정)
     좌우 돌기(turn)   : 수직축 회전 속도를 그대로 전달 → 물줄기 방향과 세기
   센서는 HTTPS(또는 localhost)에서만 값이 나온다. 주소 끝에 #debug 를 붙이면 센서 값을 화면에 보여 준다. */
(() => {
'use strict';
const L=window.Linny; if(!L) return;

const K=L.config.imu={
  pumpAcc:.9,        // 앞뒤 인정 문턱 (m/s²)
  pumpDetect:.4,     // 앞뒤 감지 문턱: 화면이 살짝 반응한다
  pumpGapMs:350,     // 앞뒤 인정 사이 최소 간격
  spinRate:50,       // 회전 인정 문턱 (도/초)
  spinDetect:25,     // 회전 감지 문턱
  spinRearm:20,      // 이 속도 아래로 spinRearmMs 동안 내려가야 다음 회전을 인정
  spinRearmMs:150,
  turnFull:70,       // 물줄기가 가장 세지는 회전 속도 (도/초)
  turnDead:6,        // 이보다 느린 회전은 무시
  invertForward:false, // 앞뒤가 거꾸로면 true
  invertTurn:false     // 좌우가 거꾸로면 true
};
const S=L.imu={active:false,events:0,fwd:0,yaw:0,pumps:0,spins:0,turn:0,feed:onMotion};

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(a[0],a[1],a[2]);
let grav=null, fwd=0, yaw=0, lastPump=0, lastDetect=0, armed=true, slowSince=0;

function screenUp(){ // 지금 화면의 위쪽이 기기의 어느 축인가
  const a=(screen.orientation&&screen.orientation.angle)||0;
  return a===90?[1,0,0]:a===270?[-1,0,0]:a===180?[0,-1,0]:[0,1,0];
}
function onMotion(e){
  const ag=e.accelerationIncludingGravity; if(!ag||ag.x==null) return;
  const now=performance.now(), G=[ag.x,ag.y,ag.z];
  if(++S.events>3&&!S.active){ S.active=true; L.imuActive=true; }

  // 중력 방향(=위쪽): 천천히 따라가는 평균
  if(!grav) grav=G.slice(); else for(let i=0;i<3;i++) grav[i]+=.08*(G[i]-grav[i]);
  const gl=len(grav); if(gl<1) return;
  const up=grav.map(v=>v/gl);

  // 앞쪽 = 화면 뒷면과 화면 위쪽을 수평면에 눕힌 방향 (세운 폰은 뒷면, 눕힌 폰은 화면 위쪽이 앞이다)
  const su=screenUp(), back=[0,0,-1], h=[0,0,0];
  for(const v of [back,su]){ const d=dot(v,up); for(let i=0;i<3;i++) h[i]+=v[i]-d*up[i]; }
  const hl=len(h);

  // 앞뒤 가속도
  const la=e.acceleration, A=la&&la.x!=null?[la.x,la.y,la.z]:G.map((v,i)=>v-grav[i]);
  if(hl>.2){ let af=dot(A,h)/hl; if(K.invertForward) af=-af;
    fwd+=.3*(af-fwd); S.fwd=fwd;
    const m=Math.abs(fwd);
    if(m>K.pumpDetect&&now-lastDetect>250){ lastDetect=now; L.detect('pump'); }
    if(m>K.pumpAcc&&now-lastPump>K.pumpGapMs){ lastPump=now; S.pumps++; L.motion('pump',fwd>0?'forward':'back'); } }

  // 수직축 회전 속도: 왼쪽으로 돌면 +
  const rr=e.rotationRate;
  if(rr&&rr.alpha!=null){ let y=dot([rr.beta,rr.gamma,rr.alpha],up); if(K.invertTurn) y=-y;
    yaw+=.35*(y-yaw); S.yaw=yaw;
    const m=Math.abs(yaw);
    if(armed){
      if(m>K.spinDetect&&now-lastDetect>250){ lastDetect=now; L.detect('spin'); }
      if(m>K.spinRate){ armed=false; slowSince=0; S.spins++; L.motion('spin'); } }
    else if(m<K.spinRearm){ if(!slowSince) slowSince=now; else if(now-slowSince>K.spinRearmMs) armed=true; }
    else slowSince=0;
    S.turn=m<K.turnDead?0:Math.max(-1,Math.min(1,-yaw/K.turnFull));
    L.turn(S.turn); }
}

function listen(){ addEventListener('devicemotion',onMotion); }
let lock=null;
async function wake(){ // 화면을 건드리지 않고 노니까 화면이 꺼지지 않게 한다
  try{ if(navigator.wakeLock&&document.visibilityState==='visible') lock=await navigator.wakeLock.request('screen'); }catch(_){}
}
document.addEventListener('visibilitychange',wake);

const DM=window.DeviceMotionEvent;
if(DM&&typeof DM.requestPermission==='function'){ // iOS는 화면을 한 번 눌러야 허락을 물을 수 있다
  addEventListener('pointerdown',()=>{ DM.requestPermission().then(r=>{ if(r==='granted') listen(); }).catch(()=>{}); },{once:true});
}else if(DM) listen();

addEventListener('pointerdown',()=>{ // 첫 터치: 화면 켜 두기, 전체 화면, 가로 고정 (안 되는 기기는 그냥 넘어간다)
  wake();
  const el=document.documentElement;
  if(S.active&&el.requestFullscreen&&!document.fullscreenElement)
    el.requestFullscreen().then(()=>screen.orientation&&screen.orientation.lock&&screen.orientation.lock('landscape')).catch(()=>{});
},{once:true});

/* #debug: 센서 값 보기 */
if(location.hash==='#debug'||new URLSearchParams(location.search).has('debug')){
  const d=document.createElement('pre');
  d.style.cssText='position:fixed;left:6px;bottom:6px;z-index:9;margin:0;padding:6px 8px;font:12px/1.35 monospace;color:#FFFDF6;background:rgba(15,42,32,.82);border-radius:6px;pointer-events:none';
  document.body.appendChild(d);
  setInterval(()=>{ d.textContent=
    (isSecureContext?'':'HTTPS가 아니라 센서가 막혀 있음\n')+
    `센서 ${S.active?'켜짐':'값 없음'} (${S.events})\n`+
    `앞뒤 ${S.fwd.toFixed(2)} m/s²  인정 ${S.pumps}\n`+
    `회전 ${S.yaw.toFixed(0)} 도/초  인정 ${S.spins}\n`+
    `물줄기 ${S.turn.toFixed(2)}`; },120);
}
})();
