/* 리니 게임: 로딩 · 스토리 · 에너지 완성 · 전달
   홈과 게임 화면(game.js) 위에 덮는 층 하나(#over)에 그린다. game.js 바로 뒤에 불러온다.
     Linny.story(n)   스토리를 n번째 장(1~3, 빼면 1)부터 본다. 준비 화면의 "스토리 다시 보기"가 부르면 된다
     Linny.deliver()  똥버스 정류장 카드 접촉. 에너지가 3개이고 홈에 있을 때만 전달로 넘어간다
   주소에 ?story=1 을 붙이면 본 적이 있어도 스토리를 매번 보여 준다(시연용).
   보드로 보낼 모드는 window의 'linny:mode' 이벤트({mode})로 알린다: 3 가득 참, 4 전달 중, 0 평소.
   도형, 좌표, 필터 값은 docs/reference_story/story_source.html 과 같다. */
(() => {
'use strict';

const C={sheet:'#FFFDF6',green:'#5AB953',deep:'#0F4A34',yellow:'#FFD84A',sky:'#CFE8F2',hill:'#A9D69A',hill2:'#8CC883',road:'#7C8480'};
const CFG={
  minLoadMs:1200,   // 로딩 화면을 적어도 이만큼은 보여 준다
  boltSec:1.2,      // 번개 1개를 전달하는 시간
  flySec:.8,        // 그중 번개가 점선을 따라 나는 시간
  deliveredMs:6000, // 전달 완료 화면 유지
  busLeaveMs:2600,  // 전달 완료 뒤 버스가 떠나기 시작하는 때
  holdMs:2000,      // 카드가 안 읽힐 때 배터리 그림을 누르는 시간
  seenKey:'linny.storySeen'
};
const IMG='assets/img/';
const $=id=>document.getElementById(id);
const L=window.Linny, over=$('over'), layer=$('overScene'), skipBtn=$('skipBtn'), stageBox=$('stageBox');
const Q=new URLSearchParams(location.search);
const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
const retrigger=(el,cls)=>{if(!el)return;el.classList.remove(cls);el.getBoundingClientRect();el.classList.add(cls);};

let mode='off'; // off | loading | story | full | mini | delivering | delivered
let tok=0;      // 층의 화면이 바뀌면 올라간다. 지난 화면의 타이머를 무효로 만든다
const later=(fn,ms)=>{const t=tok;setTimeout(()=>{if(t===tok)fn();},ms);};
// 다음 그림 차례. 화면이 가려져 rAF가 쉬어도 멈추지 않게 타이머를 같이 건다
const frame=fn=>{let ran=false;const go=()=>{if(ran)return;ran=true;fn(performance.now());};requestAnimationFrame(go);setTimeout(go,50);};
function set(m,html){
  tok++; mode=m; over.dataset.mode=m; layer.innerHTML=html||''; over.toggleAttribute('hidden',m==='off'); // SVG에는 hidden 속성값이 없어 속성으로 켜고 끈다
  skipBtn.hidden=m!=='story'; stageBox.classList.toggle('story-on',m==='story');
}
const sendMode=m=>window.dispatchEvent(new CustomEvent('linny:mode',{detail:{mode:m}}));

/* ---------- 공통 조각 (story_source.html 그대로) ---------- */
const dim=`<rect width="844" height="390" fill="#0F2A20" opacity=".58"/>`;
function say(t,y=356){const w=t.length*25+56;
  return `<g filter="url(#lift)"><rect x="${422-w/2}" y="${y-34}" width="${w}" height="50" rx="25" fill="${C.sheet}"/></g><text x="422" y="${y}" font-size="26" text-anchor="middle" fill="${C.deep}">${t}</text>`;}
function chr(name,x,mirror=false){ // 캐릭터: assets/img 의 그림 파일을 딱지 없이 그대로 올린다. 살짝 기울이고 아래쪽은 화면 밖으로 조금 나가게 한다
  const Li=name==='리니', file=Li?'linny.png':'wonny.png', w=Li?186:214, h=Li?204:168, by=Li?404:400, rot=Li?-3:4, cx=x+w/2;
  // 그림 파일이 없을 때만 점선 틀과 이름이 보인다
  return `<g transform="rotate(${rot} ${cx} ${by})"><g style="display:none"><rect x="${x+8}" y="${by-h+8}" width="${w-16}" height="${h}" rx="26" fill="none" stroke="${C.sheet}" stroke-opacity=".8" stroke-width="3" stroke-dasharray="8 6"/>
   <text x="${cx}" y="${by-h/2}" font-size="24" text-anchor="middle" fill="${C.sheet}">${name}</text><text x="${cx}" y="${by-h/2+24}" font-size="14" text-anchor="middle" fill="${C.sheet}" opacity=".8">그림 자리</text></g>
   <image href="${IMG}${file}" x="${x}" y="${by-h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMax meet" transform="${mirror?`translate(${2*cx} 0) scale(-1 1)`:''}" style="filter:drop-shadow(0 2.5px 0 rgba(15,42,32,.3)) drop-shadow(0 8px 6px rgba(15,42,32,.2))" onerror="this.previousElementSibling.style.display='';this.remove()"/></g>`;}
function bubble(x,y,w,lines,tailX,tailDir,fs=26){const h=lines.length*(fs+8)+34; // tailDir -1 왼쪽 아래, +1 오른쪽 아래
  const t=lines.map((l,i)=>`<text x="${x+w/2}" y="${y+24+fs*.8+i*(fs+8)}" font-size="${fs}" text-anchor="middle" fill="${C.deep}">${l}</text>`).join('');
  return `<g filter="url(#lift)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${C.sheet}"/><path d="M${tailX-14} ${y+h-4} L${tailX+14} ${y+h-4} L${tailX+tailDir*26} ${y+h+26} Z" fill="${C.sheet}"/></g>${t}`;}
const skip=`<g filter="url(#lift)"><rect x="700" y="18" width="124" height="46" rx="23" fill="${C.sheet}"/></g><text x="748" y="50" font-size="22" text-anchor="middle" fill="${C.deep}">건너뛰기</text><path d="M796 32 L808 41 L796 50 Z" fill="${C.deep}"/><rect x="809" y="32" width="4" height="18" fill="${C.deep}"/>`;
function dots(i,n=3){let s='';for(let k=0;k<n;k++) s+=`<circle cx="${422+(k-(n-1)/2)*22}" cy="372" r="6" fill="${k===i?C.yellow:C.sheet}" opacity="${k===i?1:.55}"/>`;return s;}
const BOLT=`<path d="M4 -14 L-10 2 L-1 2 L-4 14 L10 -4 L1 -4 Z" fill="${C.yellow}" stroke="${C.deep}" stroke-width="1.5" stroke-linejoin="round"/>`;
function bolt(x,y,s,rot=0){return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#lift)">${BOLT}</g>`;}
function bigBattery(x,y,f,part=0){ // 3칸 큰 배터리, f칸 참, part: 다음 칸이 차는 정도
  let c='';for(let i=0;i<3;i++){const xx=x+14+i*62, fill=i<f?1:(i===f?part:0);
    c+=`<rect x="${xx}" y="${y+14}" width="52" height="72" rx="8" fill="none" stroke="${C.deep}" stroke-opacity=".35" stroke-width="3" stroke-dasharray="7 5"/>`;
    if(fill>0) c+=`<rect x="${xx}" y="${y+14+72*(1-fill)}" width="52" height="${72*fill}" rx="8" fill="${C.yellow}" filter="url(#rough)"/>`;
    if(fill===1) c+=`<use href="#bolt" x="${xx+14}" y="${y+36}" width="24" height="28"/>`;}
  return `<g filter="url(#lift)"><rect x="${x}" y="${y}" width="204" height="100" rx="16" fill="${C.sheet}" stroke="${C.deep}" stroke-width="5"/><rect x="${x+204}" y="${y+32}" width="14" height="36" rx="5" fill="${C.deep}"/></g>${c}`;}
function bus(x,y,cells,moving,pop=-1){ // 옆에서 본 버스 (폭 300). pop: 방금 찬 칸
  let g='';for(let i=0;i<3;i++) g+=`<rect${i===pop?' class="cellpop"':''} x="${x+196+i*26}" y="${y+84}" width="20" height="20" rx="4" fill="${i<cells?C.yellow:'none'}" stroke="${C.sheet}" stroke-width="2.5"/>`;
  let w='';for(let i=0;i<4;i++) w+=`<rect x="${x+22+i*56}" y="${y+24}" width="44" height="42" rx="7" fill="${C.sky}"/>`;
  const lines=moving?`<g class="wind" stroke="${C.sheet}" stroke-width="7" stroke-linecap="round"><line x1="${x-70}" y1="${y+40}" x2="${x-18}" y2="${y+40}"/><line x1="${x-96}" y1="${y+76}" x2="${x-26}" y2="${y+76}"/><line x1="${x-60}" y1="${y+112}" x2="${x-16}" y2="${y+112}"/></g>`:'';
  return `${lines}<g filter="url(#lift)"><rect x="${x}" y="${y}" width="300" height="130" rx="24" fill="${C.green}"/><rect x="${x}" y="${y}" width="300" height="14" rx="7" fill="${C.deep}"/>
   <rect x="${x+248}" y="${y+24}" width="40" height="70" rx="8" fill="${C.sky}"/><rect x="${x+288}" y="${y+100}" width="14" height="14" rx="4" fill="${C.yellow}"/>
   <circle cx="${x+66}" cy="${y+132}" r="24" fill="${C.deep}"/><circle cx="${x+66}" cy="${y+132}" r="9" fill="${C.sheet}"/><circle cx="${x+232}" cy="${y+132}" r="24" fill="${C.deep}"/><circle cx="${x+232}" cy="${y+132}" r="9" fill="${C.sheet}"/></g>
   <g filter="url(#rough)">${w}<rect x="${x+186}" y="${y+76}" width="88" height="36" rx="8" fill="${C.deep}"/>${g}<rect x="${x+8}" y="${y+84}" width="18" height="26" rx="5" fill="${C.deep}"/></g>
   <text x="${x+100}" y="${y+106}" font-size="26" text-anchor="middle" fill="${C.deep}">똥버스</text>`;}
function street(){return `<rect width="844" height="390" fill="${C.sky}"/><g filter="url(#rough)"><ellipse cx="150" cy="60" rx="52" ry="14" fill="${C.sheet}"/><ellipse cx="640" cy="46" rx="40" ry="11" fill="${C.sheet}"/>
  <ellipse cx="220" cy="300" rx="360" ry="90" fill="${C.hill}"/><ellipse cx="700" cy="306" rx="320" ry="80" fill="${C.hill2}"/><rect y="296" width="844" height="94" fill="${C.road}"/>
  <g fill="${C.sheet}"><rect x="40" y="340" width="70" height="7"/><rect x="200" y="340" width="70" height="7"/><rect x="360" y="340" width="70" height="7"/><rect x="520" y="340" width="70" height="7"/><rect x="680" y="340" width="70" height="7"/></g></g>`;}

/* ================= 로딩 ================= */
function loadJobs(){ // 글꼴 2개, 모델, 캐릭터 그림 2장. 없는 파일도 끝난 것으로 센다
  const img=f=>new Promise(r=>{const i=new Image();i.onload=i.onerror=r;i.src=IMG+f;});
  const font=s=>document.fonts&&document.fonts.load?document.fonts.load('26px Jua',s):Promise.resolve();
  return [font('가'),font('A'),fetch('model.json').catch(()=>{}),img('linny.png'),img('wonny.png')];
}
function loading(fixed){ // fixed: 0~1을 주면 그 비율로 멈춰 그린다(화면 확인용)
  set('loading',`<rect width="844" height="390" fill="#F3FBF1"/>
    <g filter="url(#rough)"><circle cx="96" cy="92" r="44" fill="${C.yellow}" opacity=".5"/><circle cx="760" cy="312" r="60" fill="${C.green}" opacity=".3"/><rect x="664" y="50" width="96" height="60" rx="14" fill="${C.sky}" transform="rotate(8 712 80)"/><rect x="70" y="280" width="110" height="64" rx="14" fill="${C.hill}" transform="rotate(-6 125 312)"/></g>
    <text x="422" y="108" font-size="52" text-anchor="middle" fill="${C.deep}">뿜뿜! 펀 에너지</text>
    <g id="ldBat"></g>${bolt(270,170,1.5,-18)}${bolt(580,214,1.2,14)}
    <text x="422" y="312" font-size="26" text-anchor="middle" fill="${C.deep}">에너지를 모으러 가는 중…</text>`);
  const bat=$('ldBat'); let v=0, shown=-1;
  const draw=()=>{ const q=Math.round(v*90)/90; if(q===shown) return; shown=q;
    const x=q*3, f=Math.min(3,Math.floor(x+1e-6)); bat.innerHTML=bigBattery(313,146,f,x-f); };
  if(fixed!=null){ v=fixed; draw(); return; }
  // 배터리는 실제로 불러온 비율을 따라 찬다
  const jobs=loadJobs(), t=tok, t0=performance.now(); let got=0, last=t0;
  jobs.forEach(j=>Promise.resolve(j).catch(()=>{}).then(()=>{got++;}));
  const loop=now=>{ if(t!==tok) return;
    const target=got/jobs.length, dt=(now-last)/1000; last=now;
    v=reduced()?target:v+(target-v)*Math.min(1,dt/.12); if(Math.abs(target-v)<.004) v=target;
    draw();
    if(got===jobs.length&&v===target&&now-t0>=CFG.minLoadMs){ afterLoading(); return; }
    frame(loop); };
  draw(); frame(loop);
}
function afterLoading(){ if(Q.get('story')==='1'||!seen()) story(1); else toHome(); }
function toHome(){ set('off'); checkFull(); }

/* ================= 스토리 3장 (홈 위에 어두운 층) ================= */
// 새로고침하면 처음부터: 스토리를 봤다는 기록을 폰에 남기지 않는다. 열 때마다 로딩 → 스토리 → 홈(에너지 0) 순서로 시작한다.
// 스토리 없이 바로 홈으로 가려면 주소 끝에 ?story=0 을 붙인다.
try{localStorage.removeItem(CFG.seenKey);}catch(e){} // 예전 버전이 남긴 기록 지우기
const seen=()=>Q.get('story')==='0';
const markSeen=()=>{};
// hop: 말하는 캐릭터, b: 말풍선(x, y, 폭, 대사, 꼬리 x, 꼬리 방향)
const PAGES=[
  {hop:['stLinny'],wonny:false,b:[[214,150,400,['큰일이야!','똥버스의 에너지가 다 떨어졌대'],262,-1]]},
  {hop:['stWonny'],wonny:true, b:[[236,120,380,['전시 세 곳에서','에너지를 하나씩 모으자!'],566,1]]},
  {hop:['stLinny','stWonny'],wonny:true,b:[[200,84,330,['카드에 코를 대면','게임이 시작돼!'],250,-1],[376,214,230,['준비됐지?'],560,1]]}
];
let page=0, shownAt=0;
function story(n=1){
  if(L.state.screen!=='home') L.home(); // 스토리는 홈 화면 위에 덮는다
  set('story',`${dim}<g id="stLinny">${chr('리니',8)}</g><g id="stWonny">${chr('워니',622)}</g><g id="stBub"></g>${skip}<g id="stDots"></g>`);
  showPage(Math.max(0,Math.min(PAGES.length-1,n-1)));
}
function showPage(i){
  page=i; const P=PAGES[i];
  $('stWonny').style.display=P.wonny?'':'none';
  $('stBub').innerHTML=P.b.map((b,k)=>`<g class="pop" style="animation-delay:${k*.25}s">${bubble(...b)}</g>`).join('');
  $('stDots').innerHTML=dots(i);
  P.hop.forEach(id=>retrigger($(id),'hop'));
}
function nextPage(){ if(page<PAGES.length-1) showPage(page+1); else endStory(); }
function endStory(){ markSeen(); toHome(); }
skipBtn.addEventListener('click',endStory);

/* ================= 에너지 3개 완성 안내 ================= */
let fullSeen=false; // 한 번 본 뒤에는 접힌 쪽지로 남는다
function checkFull(){ // 홈에 돌아왔을 때 에너지가 3개면 안내를 띄운다
  if(mode!=='off') return;
  const s=L.state; if(s.screen==='home'&&s.done.length===3){ if(fullSeen) mini(); else full(); }
}
function full(){
  fullSeen=true;
  set('full',`${dim}${chr('리니',8)}${chr('워니',622)}<g class="rise">
    <g filter="url(#lift)"><rect x="182" y="64" width="480" height="262" rx="28" fill="${C.sheet}"/></g>
    <text x="422" y="116" font-size="34" text-anchor="middle" fill="${C.deep}">에너지 3개 완성!</text>
    <g id="fullBat">${bigBattery(240,140,3)}</g>
    <path d="M474 190 L520 190" stroke="${C.deep}" stroke-width="8" stroke-linecap="round"/><path d="M516 172 L542 190 L516 208 Z" fill="${C.deep}"/>
    <g transform="translate(556 150) scale(.3)">${bus(0,0,0,false)}</g>
    <text x="422" y="292" font-size="26" text-anchor="middle" fill="${C.deep}">화면을 눌러 똥버스로 보내요</text></g>`);
  sendMode(3);
  shownAt=performance.now();
  // 이번 버전(RFID 카드 없음): 화면을 누르면 바로 전달로 넘어간다. 아래 "입력"의 클릭 처리 참고
}
function mini(){ // 접힌 안내: 홈 오른쪽 위 에너지 칸 옆. 게임 카드는 그대로 댈 수 있다. 누르면 다시 펼친다
  set('mini',`<g id="miniChip"><title>눌러서 똥버스로 보내요</title><g filter="url(#lift)"><rect x="478" y="15" width="184" height="40" rx="20" fill="${C.sheet}"/></g>
    <g transform="translate(491 22) scale(.19)">${bus(0,0,0,false)}</g>
    <text x="604" y="42" font-size="20" text-anchor="middle" fill="${C.deep}">똥버스로!</text></g>`);
}

/* ================= 전달 중 ================= */
let ac;
function blip(k){ // 번개가 들어갈 때마다 짧은 소리와 진동
  try{ if(navigator.vibrate) navigator.vibrate(40); }catch(e){}
  try{ ac=ac||new (window.AudioContext||window.webkitAudioContext)();
    const o=ac.createOscillator(), g=ac.createGain(), t=ac.currentTime;
    o.type='triangle'; o.frequency.setValueAtTime(480+k*130,t); o.frequency.exponentialRampToValueAtTime(860+k*130,t+.12);
    g.gain.setValueAtTime(.18,t); g.gain.exponentialRampToValueAtTime(.001,t+.18);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+.2); }catch(e){}
}
function deliver(force){ // 똥버스 정류장 카드 접촉
  if(!force&&(L.state.screen!=='home'||(mode!=='full'&&mode!=='mini'))) return false;
  if(L.state.screen!=='home') L.home();
  set('delivering',`${street()}<g id="dvBus"></g><g id="dvBat"></g>
    <path d="M270 190 Q400 60 520 236" fill="none" stroke="${C.sheet}" stroke-width="5" stroke-dasharray="4 14" stroke-linecap="round"/>
    <g id="dvBolt" filter="url(#lift)" style="display:none">${BOLT}</g>${say('똥버스에 에너지를 전달하는 중…',64)}`);
  sendMode(4);
  const t=tok, el=$('dvBolt'), rest=(CFG.boltSec-CFG.flySec)*1000; let left=3, got=0;
  const drawBat=()=>{ $('dvBat').innerHTML=bigBattery(60,150,left); };
  const drawBus=pop=>{ $('dvBus').innerHTML=`<g${pop?' class="busHop"':''}>${bus(500,150,got,false,pop?got-1:-1)}</g>`; };
  const arrive=()=>{ if(t!==tok) return; el.style.display='none'; got++; drawBus(true); blip(got);
    later(got<3?fly:delivered,rest+(got<3?0:300)); };
  const fly=()=>{ if(t!==tok) return; // 배터리 칸 하나가 비고, 번개가 점선을 따라 버스로 간다
    left--; drawBat();
    if(reduced()){ later(arrive,CFG.flySec*1000); return; }
    const t0=performance.now(); el.style.display='';
    const step=now=>{ if(t!==tok) return;
      const u=Math.min(1,(now-t0)/(CFG.flySec*1000)), e=u<.5?2*u*u:1-2*(1-u)*(1-u), a=1-e;
      el.setAttribute('transform',`translate(${a*a*270+2*a*e*400+e*e*520} ${a*a*190+2*a*e*60+e*e*236}) rotate(${-20+44*e}) scale(1.8)`);
      if(u<1) frame(step); else arrive(); };
    step(t0); };
  drawBat(); drawBus(false); later(fly,400);
  return true;
}

/* ================= 전달 완료 ================= */
function delivered(){
  set('delivered',`${street()}<g id="dlBus">${bus(430,150,3,true)}</g>
    <g filter="url(#rough)" fill="${C.yellow}"><circle cx="380" cy="120" r="7"/><circle cx="760" cy="126" r="8"/><circle cx="700" cy="96" r="5"/><circle cx="470" cy="100" r="5"/></g>
    <g class="pop">${bubble(150,40,360,['고마워!','똥버스가 다시 달려요'],470,1)}</g>${chr('리니',8)}${chr('워니',196,true)}`); // 여기서만 워니를 뒤집어 버스 쪽(오른쪽)을 보게 한다
  shownAt=performance.now();
  later(()=>$('dlBus').classList.add('busGo'),CFG.busLeaveMs); // 버스가 1.5초 동안 오른쪽으로 나간다
  later(finish,CFG.deliveredMs);
}
function finish(){ // 에너지를 0으로 되돌리고 홈으로
  sendMode(0); fullSeen=false;
  if(L.reset){ set('off'); L.reset(); } else location.reload(); // game.js에 Linny.reset()이 없으면 새로 불러와 0으로 만든다
}

/* ================= 입력 ================= */
over.addEventListener('click',e=>{
  if(mode==='story') nextPage();                 // 화면 아무 곳이나 누르면 다음 장
  else if(mode==='full'){ if(performance.now()-shownAt>600) deliver(); } // 누르면 바로 똥버스로 (뜨자마자 잘못 눌리는 것만 막는다)
  else if(mode==='mini'){ if(e.target.closest('#miniChip')) deliver(); }  // 접힌 "똥버스로!"도 누르면 바로 간다
  else if(mode==='delivered'&&performance.now()-shownAt>600) finish();
});
over.addEventListener('contextmenu',e=>e.preventDefault());
/* 키보드(시험용): 스토리 Space·Enter·→ 다음 장, Esc 건너뛰기. 에너지 3개일 때 B = 똥버스 카드 접촉.
   층이 덮여 있는 동안에는 게임 쪽 키(1·2·3 등)가 먹지 않게 먼저 받아서 막는다 */
addEventListener('keydown',e=>{
  if(mode==='off') return;
  const isB=e.key==='b'||e.key==='B', go=e.key===' '||e.key==='Enter'||e.key==='ArrowRight';
  if(mode==='mini'){ if(isB&&!e.repeat&&deliver()) e.stopImmediatePropagation(); return; }
  e.stopImmediatePropagation();
  if(e.repeat||e.target===skipBtn) return;
  if(mode==='story'){ if(e.key==='Escape') endStory(); else if(go){ e.preventDefault(); nextPage(); } }
  else if(mode==='full'){ if(isB) deliver(); else if(go||e.key==='Escape'){ e.preventDefault(); mini(); } }
  else if(mode==='delivered'&&go){ e.preventDefault(); if(performance.now()-shownAt>600) finish(); }
},true);
/* 홈 그림이 다시 그려지면(게임이 끝나고 돌아옴) 에너지 3개인지 본다. 게임 중에는 스토리·전달 층이 없으니 동작 판단과 겹치지 않는다 */
new MutationObserver(()=>{
  if(mode==='off') checkFull();
  else if(mode==='mini'&&L.state.done.length<3) set('off');
}).observe($('scene'),{childList:true});

/* ================= 시작 ================= */
L.story=story; L.deliver=()=>deliver();
L.screens={loading,story,full,mini,deliver:()=>deliver(true),delivered}; // 화면 확인용
loading();
})();
