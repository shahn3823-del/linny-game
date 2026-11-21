/* 리니: 휴대폰 내장 IMU로 동작 판단
   녹화 웹앱·학습 노트북(train-v1.3.1)과 같은 조건으로 읽는다.
     폰을 받침판에 눕혀 고정(화면이 위). 기기 x = 앞, y = 왼쪽, z = 위.
     가속도는 중력 포함 값(ax_g, ay_g, az_g), 회전은 rot_alpha/beta/gamma(도/초). 수직축 회전 = rot_gamma.
   두 층으로 판단한다.
     빠른 층(샘플마다): 화면이 바로 따라가야 하는 것
        제자리 회전 시작 → 호두과자 뒤집기 / 수직축 회전 속도 → 물줄기 방향·세기 / 앞뒤 가속 한 번 → 자동차 부스트
     모델 층(0.5초마다): model.json이 있으면 노트북과 똑같이 특징 → 모델 → 평활 → 에너지 판단
        자동차에서는 모델이 "앞뒤 왕복(pump)"이라고 본 동안의 앞뒤 가속만 부스트로 인정하고, 모델의 pump 에너지 판단마다 한 번 더 민다.
   센서는 HTTPS(또는 localhost)에서만 값이 나온다. 주소 끝에 #debug 를 붙이면 값이 보인다. ?rule 은 모델 대신 규칙 베이스라인. */
(() => {
'use strict';
const L=window.Linny; if(!L) return;

const K=L.config.imu={
  pumpAcc:.9,        // 앞뒤 인정 문턱 (m/s², 평균을 뺀 x 가속)
  pumpDetect:.4,     // 앞뒤 감지 문턱: 화면이 살짝 반응한다
  pumpGapMs:350,     // 앞뒤 인정 사이 최소 간격
  spinRate:50,       // 회전 인정 문턱 (도/초)
  spinDetect:25,     // 회전 감지 문턱
  spinRearm:20,      // 이 속도 아래로 spinRearmMs 동안 내려가야 다음 회전을 인정
  spinRearmMs:150,
  turnFull:70,       // 물줄기가 가장 세지는 회전 속도 (도/초)
  turnDead:10,       // 이보다 느린 회전은 무시 (노트북의 GZ_DEAD와 같은 값)
  invertForward:false, // 앞뒤가 거꾸로면 true
  invertTurn:false,    // 좌우가 거꾸로면 true
  modelUrl:'model.json',
  modelBoost:1.6,      // 모델의 pump 에너지 판단 한 번이 미는 세기(앞뒤 가속 한 번 = 1)
  modelHoldMs:1500     // 모델이 pump라고 본 뒤 이 시간 동안은 앞뒤 가속을 부스트로 인정
};
// 채널: 노트북 CONFIG와 같다. model.json이 있으면 그 안의 preprocess.channels를 쓴다
let CH={ax:'ax_g',ay:'ay_g',az:'az_g',gx:'rot_alpha',gy:'rot_beta',gz:'rot_gamma'}, rotScale=1;
const S=L.imu={active:false,events:0,fwd:0,yaw:0,pumps:0,spins:0,turn:0,model:'없음',label:'',p:0,feed:onMotion};

let clf=null, axMean=null, fwd=0, yaw=0, lastPump=0, lastDetect=0, armed=true, slowSince=0, pumpSeen=-1e9;

function onMotion(e){
  const ag=e.accelerationIncludingGravity; if(!ag||ag.x==null) return;
  const rr=e.rotationRate||{}, now=performance.now();
  const raw={ax_g:ag.x,ay_g:ag.y,az_g:ag.z,rot_alpha:(rr.alpha||0)*rotScale,rot_beta:(rr.beta||0)*rotScale,rot_gamma:(rr.gamma||0)*rotScale};
  const v=[raw[CH.ax],raw[CH.ay],raw[CH.az],raw[CH.gx],raw[CH.gy],raw[CH.gz]];
  if(++S.events>3&&!S.active){ S.active=true; L.imuActive=true; }

  /* ── 모델 층: 노트북과 같은 판단 ── */
  if(clf){ const r=clf.push(now,v);
    if(r){ S.label=r.label; S.p=r.p;
      if(r.label==='pump') pumpSeen=now;
      if(r.event==='pump') L.motion('pump',fwd>=0?'forward':'back',K.modelBoost);
      window.dispatchEvent(new CustomEvent('linny:class',{detail:{t:r.t,label:r.label,p:r.p,event:r.event}})); } }

  /* ── 빠른 층 ── */
  // 앞뒤: x 가속에서 천천히 따라가는 평균(받침판 기울기 몫)을 뺀 값
  if(axMean===null) axMean=v[0]; else axMean+=.02*(v[0]-axMean);
  let af=v[0]-axMean; if(K.invertForward) af=-af;
  fwd+=.3*(af-fwd); S.fwd=fwd;
  const ma=Math.abs(fwd);
  if(ma>K.pumpDetect&&now-lastDetect>250){ lastDetect=now; L.detect('pump'); }
  if(ma>K.pumpAcc&&now-lastPump>K.pumpGapMs){ lastPump=now; S.pumps++;
    if(!clf||now-pumpSeen<K.modelHoldMs) L.motion('pump',fwd>0?'forward':'back'); } // 모델이 있으면 pump로 본 동안만 인정

  // 수직축 회전: 왼쪽으로 돌면 +
  let y=v[5]; if(K.invertTurn) y=-y;
  yaw+=.35*(y-yaw); S.yaw=yaw;
  const my=Math.abs(yaw);
  if(armed){
    if(my>K.spinDetect&&now-lastDetect>250){ lastDetect=now; L.detect('spin'); }
    if(my>K.spinRate){ armed=false; slowSince=0; S.spins++; L.motion('spin'); } }
  else if(my<K.spinRearm){ if(!slowSince) slowSince=now; else if(now-slowSince>K.spinRearmMs) armed=true; }
  else slowSince=0;
  S.turn=my<K.turnDead?0:Math.max(-1,Math.min(1,-yaw/K.turnFull));
  L.turn(S.turn);
}

/* model.json 불러오기: 없거나 연습용(demo_data)이면 빠른 층만 쓴다 */
const useRule=new URLSearchParams(location.search).has('rule');
if(window.LinnyModel) fetch(K.modelUrl,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(J=>{
  if(J.demo_data){ S.model='연습용 가짜 데이터 모델이라 쓰지 않음'; return; }
  const c=J.preprocess.channels; CH={ax:c.ax,ay:c.ay,az:c.az,gx:c.gx,gy:c.gy,gz:c.gz};
  rotScale=J.preprocess.rot_unit_in==='rad/s'?180/Math.PI:1;
  clf=window.LinnyModel.create(J,useRule?'rule':'model');
  S.model=`${J.version} · ${clf.usingRule?'규칙':J.model.type} · 창 ${J.preprocess.win_s}초`;
}).catch(()=>{ S.model='model.json 없음 (빠른 판단만)'; });

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
    `물줄기 ${S.turn.toFixed(2)}\n`+
    `모델 ${S.model}`+(S.label?`\n판단 ${S.label} ${(S.p*100).toFixed(0)}%`:''); },120);
}
})();
