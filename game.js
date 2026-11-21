/* 리니 게임 화면
   화면은 진행도 p(0~1) 하나로 그린다. 동작 판단 쪽은 Linny.detect()/Linny.motion()만 부르면 된다.
     Linny.open('car'|'hodu'|'water')  카드 접촉으로 게임 열기
     Linny.detect('pump'|'spin'|'wiggle')  동작 감지(아직 인정 전)
     Linny.motion('pump'|'spin'|'wiggle', dir)  동작 1번 인정
        dir: pump는 'forward'|'back', wiggle은 'left'|'right' (빼면 번갈아 든 것으로 친다)
     Linny.turn(rate)  계속 도는 빠르기(-1 왼쪽 ~ 1 오른쪽, 0 멈춤). 물주기의 물줄기 방향과 세기
     Linny.home()
   완료되면 window에 'linny:complete' 이벤트({game, seconds})가 난다. */
(() => {
'use strict';

const C={sheet:'#FFFDF6',green:'#5AB953',deep:'#0F4A34',yellow:'#FFD84A',sky:'#CFE8F2',soil:'#B5745A',soil2:'#9C5F49',
  hill:'#A9D69A',hill2:'#8CC883',water:'#BFE4F5',fire:'#E8532B',fire2:'#F28C38',tray:'#2A3A3F',dough:'#FBEFC2',
  baked:'#C9772E',baked2:'#8F4E1C',red:'#B3262E',road:'#7C8480',walk:'#E7DFCB'};

const CFG={
  holdMs:2000, // 홈 카드 누르기
  doneMs:5000, // 완료 화면 유지
  // 자동차: 혼자서는 baseSec초에 걸쳐 천천히 가고, 앞뒤 동작 1번마다 속도(boost)가 더해졌다가 decaySec에 걸쳐 빠진다
  car:{baseSec:120,boost:.075,boostMax:.17,decaySec:1.2},
  // 호두과자: 불 게이지가 cycleSec초에 차고, good 구간에서 뒤집으면 성공. 늦으면 burn개가 탄다. 한 면에 2번씩, 모두 4번 구우면 끝
  // sec: 게이지가 다 차는 시간 범위(판마다 무작위), win: 초록 칸이 열려 있는 시간 범위(초)
  hodu:{sec:[1.6,3.2],win:[.55,.9],burn:2},
  // 물주기: 줄마다 물을 need번 받아야 다 자란다. 왼쪽/오른쪽 동작이 그쪽 줄에 1, 가운데 줄에 0.5씩 준다
  // accel: 도는 힘, glide: 멈추는 데 걸리는 시간, kick: 동작 1번의 세기, flowAt: 물이 가장 세지는 빠르기, needSec: 줄마다 필요한 물 시간
  water:{accel:3.6,glide:.5,kick:.7,flowAt:.5,needSec:2}
};
const MOTION={car:'pump',hodu:'spin',water:'wiggle'};
/* 톡 치기 모드: 센서 없이 손가락·마우스로 해 본다. 카드는 한 번 눌러 열고, 게임 화면을 치면 동작 1번 인정.
   주소 끝에 ?dev 를 붙이거나, 페이지에서 window.LINNY_TAP=true 로 켠다(웹 체험판). */
const TAP=!!window.LINNY_TAP||new URLSearchParams(location.search).has('dev');

const $=id=>document.getElementById(id);
const scene=$('scene'), cards=$('cards'), stageBox=$('stageBox');
const done=new Set();
let st={screen:'home',game:null,count:0,p:0,t0:0};
let tok=0; // 화면이 바뀌면 올라간다. 지난 화면의 타이머를 무효로 만든다.
const later=(fn,ms)=>{const t=tok;setTimeout(()=>{if(t===tok)fn();},ms);};
const retrigger=(el,cls)=>{if(!el)return;el.classList.remove(cls);el.getBoundingClientRect();el.classList.add(cls);};
const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ---------- 공통 조각 ---------- */
function energy(n,f,x=820,y=20){let s='';const w=40,h=30,g=8,x0=x-n*(w+g);
  for(let i=0;i<n;i++){const xx=x0+i*(w+g);
    s+= i<f ? `<g filter="url(#lift)"><rect x="${xx}" y="${y}" width="${w}" height="${h}" rx="7" fill="${C.yellow}" stroke="${C.deep}" stroke-width="3"/></g><use href="#bolt" x="${xx+13}" y="${y+6}" width="15" height="18"/>`
            : `<rect x="${xx}" y="${y}" width="${w}" height="${h}" rx="7" fill="none" stroke="${C.deep}" stroke-opacity=".45" stroke-width="3" stroke-dasharray="7 5"/>`;}
  return s;}
const plusOne=()=>`<text class="fade" x="760" y="48" font-size="40" fill="${C.deep}" text-anchor="end">+1</text><g class="bounce">${energy(1,1)}</g>`;
function say(t,y=356){const w=t.length*25+56;
  return `<g filter="url(#lift)"><rect x="${422-w/2}" y="${y-34}" width="${w}" height="50" rx="25" fill="${C.sheet}"/></g><text x="422" y="${y}" font-size="26" text-anchor="middle" fill="${C.deep}">${t}</text>`;}
function arrowsLR(cx,cy,s=1,col=C.deep){return `<g transform="translate(${cx} ${cy}) scale(${s})" filter="url(#lift)">
  <path d="M-70 0 L-44 -19 L-44 -8 L-10 -8 L-10 8 L-44 8 L-44 19 Z" fill="${col}"/><path d="M70 0 L44 -19 L44 -8 L10 -8 L10 8 L44 8 L44 19 Z" fill="${col}"/></g>`;}
function tree(x,y,s){return `<rect x="${x-3*s}" y="${y-26*s}" width="${6*s}" height="${26*s}" fill="#8A5A3C"/><circle cx="${x}" cy="${y-40*s}" r="${20*s}" fill="${C.green}"/><circle cx="${x-12*s}" cy="${y-30*s}" r="${13*s}" fill="#3E9A45"/><circle cx="${x+13*s}" cy="${y-32*s}" r="${12*s}" fill="${C.hill2}"/>`;}
function walnut(cx,cy,r,s){ // 0 반죽, 1 굽는 중, 2 완성
  if(s===0) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.dough}"/>`;
  if(s===1) return `<circle class="ring" cx="${cx}" cy="${cy}" r="${r+4}" fill="none" stroke="${C.yellow}" stroke-width="3" opacity=".8"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.yellow}"/><circle cx="${cx}" cy="${cy}" r="${r*.55}" fill="#FFB52E"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.baked}"/>
   <path d="M${cx} ${cy-r*.85} Q${cx-r*.25} ${cy} ${cx} ${cy+r*.85}" stroke="${C.baked2}" stroke-width="${r*.13}" fill="none" stroke-linecap="round"/>
   <path d="M${cx-r*.62} ${cy-r*.45} Q${cx-r*.2} ${cy-r*.2} ${cx-r*.6} ${cy+r*.4}" stroke="${C.baked2}" stroke-width="${r*.11}" fill="none" stroke-linecap="round"/>
   <path d="M${cx+r*.62} ${cy-r*.45} Q${cx+r*.3} ${cy} ${cx+r*.58} ${cy+r*.45}" stroke="${C.baked2}" stroke-width="${r*.11}" fill="none" stroke-linecap="round"/>
   <path d="M${cx-r*.5} ${cy-r*.6} Q${cx} ${cy-r*.95} ${cx+r*.5} ${cy-r*.6}" stroke="#E6A260" stroke-width="${r*.1}" fill="none" stroke-linecap="round"/>`;}
function cabbage(x,y,s,g){ if(g<=0) return '';
  if(g===1) return `<ellipse cx="${x-5*s}" cy="${y-5*s}" rx="${7*s}" ry="${3.5*s}" fill="${C.green}" transform="rotate(-30 ${x-5*s} ${y-5*s})"/><ellipse cx="${x+5*s}" cy="${y-5*s}" rx="${7*s}" ry="${3.5*s}" fill="${C.green}" transform="rotate(30 ${x+5*s} ${y-5*s})"/>`;
  const R=g===2?17:24; let o='';
  for(let a=0;a<6;a++){const an=a*60+15, rx=x+Math.cos(an*Math.PI/180)*R*s*.75, ry=y-R*s*.35+Math.sin(an*Math.PI/180)*R*s*.4;
    o+=`<ellipse cx="${rx}" cy="${ry}" rx="${R*s*.62}" ry="${R*s*.36}" fill="${a%2?'#3E9A45':C.green}" transform="rotate(${an} ${rx} ${ry})"/>`;}
  if(g===3) o+=`<circle cx="${x}" cy="${y-R*s*.5}" r="${R*s*.55}" fill="#CBEBA8"/><path d="M${x-R*s*.3} ${y-R*s*.75} Q${x} ${y-R*s*.4} ${x+R*s*.1} ${y-R*s*.1}" stroke="#9ACB7C" stroke-width="${2*s}" fill="none"/>`;
  return o;}
function corn(x,y,s,g){ if(g<=0) return ''; if(g===1) return cabbage(x,y,s,1);
  const h=(g===2?52:92)*s; let o=`<rect x="${x-2.5*s}" y="${y-h}" width="${5*s}" height="${h}" fill="#3E9A45"/>`;
  const n=g===2?3:5; for(let i=0;i<n;i++){const yy=y-h*(.25+i*.17), d=i%2?1:-1;
    o+=`<ellipse cx="${x+d*13*s}" cy="${yy}" rx="${15*s}" ry="${4.2*s}" fill="${i%2?C.green:'#3E9A45'}" transform="rotate(${d*-28} ${x+d*13*s} ${yy})"/>`;}
  if(g===3) o+=`<ellipse cx="${x+6*s}" cy="${y-h*.62}" rx="${5.5*s}" ry="${13*s}" fill="${C.yellow}" transform="rotate(14 ${x+6*s} ${y-h*.62})"/><ellipse cx="${x}" cy="${y-h-4*s}" rx="${3*s}" ry="${9*s}" fill="#E9C46A"/>`;
  return o;}
function flower(x,y,s,g){ if(g<=0) return ''; if(g===1) return cabbage(x,y,s,1);
  const h=(g===2?40:70)*s; let o=`<rect x="${x-2*s}" y="${y-h}" width="${4*s}" height="${h}" fill="#3E9A45"/>`;
  for(let i=0;i<4;i++){const yy=y-h*(.2+i*.2), d=i%2?1:-1;
    o+=`<ellipse cx="${x+d*10*s}" cy="${yy}" rx="${11*s}" ry="${4*s}" fill="${C.green}" transform="rotate(${d*-25} ${x+d*10*s} ${yy})"/>`;
    if(g===3) o+=`<circle cx="${x+d*13*s}" cy="${yy-8*s}" r="${6*s}" fill="#B79AE0"/><circle cx="${x+d*13*s}" cy="${yy-8*s}" r="${2*s}" fill="${C.yellow}"/>`;}
  return o;}
function cabbageHead(x,y,r){return `<circle cx="${x}" cy="${y}" r="${r}" fill="#CBEBA8"/><path d="M${x-r*.5} ${y-r*.5} Q${x} ${y} ${x+r*.2} ${y+r*.7}" stroke="#9ACB7C" stroke-width="3" fill="none"/><path d="M${x+r*.5} ${y-r*.5} Q${x+r*.1} ${y-r*.1} ${x+r*.6} ${y+r*.4}" stroke="#9ACB7C" stroke-width="3" fill="none"/>`;}
function cornCob(x,y,rot){return `<g transform="rotate(${rot} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="10" ry="26" fill="${C.yellow}"/><path d="M${x-10} ${y+6} Q${x-14} ${y+30} ${x} ${y+28} Q${x+14} ${y+30} ${x+10} ${y+6} Q${x} ${y+16} ${x-10} ${y+6} Z" fill="${C.green}"/></g>`;}

/* ================= 홈 ================= */
const CARD_X={car:150,hodu:400,water:650}, CARD_ROT={car:-3,hodu:1.5,water:-1.5};
const ICON={
  car:`<use href="#car" x="-72" y="-44" width="144" height="83" filter="url(#rough)"/>`,
  hodu:`<g filter="url(#rough)"><rect x="-70" y="-52" width="140" height="96" rx="14" fill="${C.tray}"/>${walnut(-36,-26,19,2)}${walnut(8,-26,19,2)}${walnut(-36,18,19,2)}${walnut(8,18,19,0)}<rect x="-8" y="44" width="16" height="12" fill="${C.tray}"/><rect x="-12" y="54" width="24" height="34" rx="5" fill="${C.red}"/></g>`,
  water:`<g filter="url(#rough)"><path d="M-70 60 L-22 -20 L22 -20 L70 60 Z" fill="${C.soil}"/><path d="M0 34 L-8 -70 L8 -70 Z" fill="${C.water}"/><circle cx="-13" cy="-62" r="4" fill="${C.water}"/><circle cx="14" cy="-54" r="4" fill="${C.water}"/><circle cx="-16" cy="-40" r="3" fill="${C.water}"/>
    ${cabbage(-34,46,1.1,3)}${cabbage(34,46,1.1,3)}<rect x="-6" y="30" width="12" height="34" fill="#8FA3AE"/><rect x="-9" y="24" width="18" height="10" rx="3" fill="${C.deep}"/></g>`
};
function homeCard(game){return `<g transform="translate(${CARD_X[game]} 205) rotate(${CARD_ROT[game]})"><g class="card" id="card-${game}">
  <g filter="url(#lift)"><rect x="-105" y="-112" width="210" height="224" rx="20" fill="${done.has(game)?C.green:C.yellow}"/></g>
  <rect x="-91" y="-98" width="182" height="196" rx="13" fill="${C.sheet}" filter="url(#rough)"/>${ICON[game]}</g></g>`;}
function showHome(){
  tok++; st={screen:'home',game:null,count:0,p:0,t0:0};
  scene.innerHTML=`<rect width="844" height="390" fill="#F3FBF1"/>
    ${homeCard('car')}${homeCard('hodu')}${homeCard('water')}
    <text x="34" y="52" font-size="30" fill="${C.deep}">카드에 코를 대 봐!</text>${energy(3,done.size)}`;
  cards.hidden=false;
}

/* ================= A 자동차 (앞뒤 = 부스트) ================= */
const VX=422,HY=168;
function bld(x0,x1,col,hs,side){
  const by=x=>HY+Math.abs(VX-x)*0.15, ty=x=>HY-Math.abs(VX-x)*0.52*hs;
  let o=`<polygon points="${x0},${ty(x0)} ${x1},${ty(x1)} ${x1},${by(x1)} ${x0},${by(x0)}" fill="${col}"/>`;
  for(const f of [.22,.46,.7]){const a=ty(x0)+(by(x0)-ty(x0))*f,b=ty(x1)+(by(x1)-ty(x1))*f;
    const w0=Math.abs(VX-x0)*0.05,w1=Math.abs(VX-x1)*0.05;
    o+=`<polygon points="${x0+side*-6},${a} ${x1+side*4},${b} ${x1+side*4},${b+w1} ${x0+side*-6},${a+w0}" fill="${C.sheet}" opacity=".55"/>`;}
  const n=Math.max(2,Math.round(Math.abs(x1-x0)/26));
  for(let i=1;i<n;i++){const x=x0+(x1-x0)*i/n; o+=`<line x1="${x}" y1="${ty(x)}" x2="${x}" y2="${by(x)}" stroke="${col}" stroke-width="${3+Math.abs(VX-x)*.012}"/>`;}
  return o;}
function lanes(ph){ // 흰 차선 점선. ph가 오르면 앞으로 흘러온다
  const f=ph-Math.floor(ph); let o='';
  for(const bx of [120,724]) for(let k=-1;k<7;k++){
    const u1=Math.max(0,(k+.15+f)/7), u2=Math.min(1,(k+.6+f)/7); if(u2<=u1) continue;
    const y1=HY+222*u1*u1, y2=HY+222*u2*u2, X=y=>VX+(bx-VX)*(y-HY)/222, W=y=>1+9*(y-HY)/222;
    o+=`<polygon points="${X(y1)-W(y1)},${y1} ${X(y1)+W(y1)},${y1} ${X(y2)+W(y2)},${y2} ${X(y2)-W(y2)},${y2}"/>`;}
  return o;}
function streaks(){ // 부스트 때 보이는 바람 줄
  let o=''; for(const [bx,a,b] of [[-260,.3,.62],[60,.42,.8],[784,.42,.8],[1104,.3,.62],[-560,.2,.45],[1404,.2,.45]]){
    const y1=HY+222*a, y2=HY+222*b, X=y=>VX+(bx-VX)*(y-HY)/222;
    o+=`<polygon points="${X(y1)-1},${y1} ${X(y1)+1},${y1} ${X(y2)+4},${y2} ${X(y2)-4},${y2}"/>`;}
  return o;}
const MAP='M276 372 L290 356 L306 362 L324 340';
const car={
  finishDelay:350,
  enter(){
    let ticks=''; for(let a=-110;a<=110;a+=27.5){const r=a*Math.PI/180; ticks+=`<line x1="${422+Math.sin(r)*43}" y1="${378-Math.cos(r)*43}" x2="${422+Math.sin(r)*52}" y2="${378-Math.cos(r)*52}" stroke="${C.sheet}" stroke-width="3" stroke-linecap="round"/>`;}
    let cells=''; for(let i=0;i<4;i++) cells+=`<rect class="cell" x="${520+i*27}" y="352" width="22" height="22" rx="4" fill="none" stroke="${C.sheet}" stroke-opacity=".5" stroke-width="2"/>`;
    scene.innerHTML=`<rect width="844" height="${HY}" fill="${C.sky}"/>
      <g filter="url(#rough)"><ellipse cx="150" cy="60" rx="52" ry="14" fill="${C.sheet}"/><ellipse cx="690" cy="44" rx="40" ry="11" fill="${C.sheet}"/></g>
      <rect y="${HY}" width="844" height="${390-HY}" fill="${C.walk}"/>
      <polygon points="${VX-16},${HY} ${VX+16},${HY} 990,390 -146,390" fill="${C.road}"/>
      <polygon points="${VX-1.5},${HY} ${VX+1.5},${HY} 440,390 404,390" fill="${C.yellow}"/>
      <g id="carLanes" fill="${C.sheet}"></g>
      <g filter="url(#rough)"><ellipse id="carHill" cx="${VX}" fill="${C.hill2}"/><use id="carTower" href="#tower"/></g>
      <g filter="url(#rough)">
        ${bld(0,96,'#F2C66B',1,-1)}${bld(100,190,'#E79A86',.78,-1)}${bld(194,262,'#9CCFD8',.95,-1)}${bld(266,322,'#F3E3B0',.7,-1)}${bld(326,372,'#C9B7E2',.9,-1)}
        ${bld(844,742,'#EE9C8A',1.05,1)}${bld(738,650,'#8FD1C5',.8,1)}${bld(646,580,'#F2C66B',.98,1)}${bld(576,522,'#B9D8F0',.72,1)}${bld(518,474,'#F3E3B0',.88,1)}
        ${tree(250,205,.55)}${tree(150,222,.85)}${tree(604,204,.6)}${tree(716,224,.9)}</g>
      <g id="carStreaks" fill="${C.sheet}" opacity="0">${streaks()}</g>
      <g id="carDash">
        <g filter="url(#lift)"><path d="M140 400 Q170 322 300 314 L544 314 Q674 322 704 400 Z" fill="${C.yellow}"/></g>
        <g filter="url(#rough)"><circle cx="422" cy="378" r="62" fill="${C.deep}"/>${ticks}
          <rect x="508" y="326" width="128" height="56" rx="10" fill="${C.deep}"/>
          <g transform="rotate(-3 300 356)"><rect x="262" y="328" width="76" height="56" rx="6" fill="${C.sheet}"/><rect x="267" y="333" width="66" height="46" rx="3" fill="${C.hill}"/>
            <path d="${MAP}" stroke="${C.sheet}" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round"/></g></g>
        <g transform="rotate(-3 300 356)"><path id="carMap" d="${MAP}" stroke="${C.green}" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="0 1"/>
          <circle cx="324" cy="340" r="4" fill="${C.deep}"/></g>
        <line id="carNeedle" x1="422" y1="378" x2="422" y2="332" stroke="${C.fire}" stroke-width="5" stroke-linecap="round"/><circle cx="422" cy="378" r="7" fill="${C.sheet}"/>
        ${cells}
        <text x="572" y="345" font-size="13" text-anchor="middle" fill="${C.sheet}">이 차의 에너지</text>
      </g>
      <g id="hint"><g transform="rotate(90 422 262)">${arrowsLR(422,262,.95,C.sheet)}</g>${say('앞뒤로 영차영차, 남산타워까지 가요',64)}</g>`;
    Object.assign(this,{p:0,b:0,v:0,ph:0,tilt:0,lastDir:'back',_th:-1,_n:-1,_so:-1,_tl:0});
    this.render();
  },
  render(){ // renderCar(p) + 지금 속도
    // 타워는 원근대로 다가온다: 멀 때는 천천히, 가까워질수록 확 커져서 도착 때는 눈앞을 채운다
    const p=this.p, th=Math.round(40/(1-.867*p)*2)/2;
    if(th!==this._th){ this._th=th; const tw=$('carTower'), hill=$('carHill');
      const ry=8+th*.19, top=HY-5-p*8, base=top+ry*.55; // 언덕 꼭대기는 지평선에 걸치고, 아래로 넓어진다
      tw.setAttribute('x',VX-th*.2); tw.setAttribute('y',base-th); tw.setAttribute('width',th*.4); tw.setAttribute('height',th);
      hill.setAttribute('cy',top+ry); hill.setAttribute('rx',th*1.35); hill.setAttribute('ry',ry); }
    $('carLanes').innerHTML=lanes(this.ph);
    // 속도계 바늘은 지금 속도를 가리킨다
    const a=(-110+Math.min(1,this.v/(CFG.car.boostMax+1/CFG.car.baseSec))*150)*Math.PI/180, nd=$('carNeedle');
    nd.setAttribute('x2',422+Math.sin(a)*46); nd.setAttribute('y2',378-Math.cos(a)*46);
    $('carMap').setAttribute('stroke-dasharray',`${p} 1`);
    const n=Math.floor(p*4+1e-6);
    if(n!==this._n){ this._n=n; scene.querySelectorAll('.cell').forEach((c,i)=>{c.setAttribute('fill',i<n?C.green:'none');c.setAttribute('stroke-opacity',i<n?0:.5);}); }
    const so=Math.round(Math.min(1,this.b/.09)*14)/20;
    if(so!==this._so){ this._so=so; $('carStreaks').setAttribute('opacity',so); }
    const tl=reduced()?0:Math.round(this.tilt*2)/2; // 앞으로 밀면 앞머리가 숙여지고, 뒤로 당기면 들린다
    if(tl!==this._tl){ this._tl=tl; $('carDash').setAttribute('transform',`translate(0 ${tl})`); }
  },
  onStart(){ // 첫 동작부터 차가 스스로 천천히 간다
    const t=tok; let last=performance.now();
    const loop=now=>{ if(t!==tok||st.screen!=='play') return;
      const dt=Math.min(.05,(now-last)/1000), K=CFG.car; last=now;
      this.b*=Math.exp(-dt/K.decaySec);
      this.v+=(1/K.baseSec+this.b-this.v)*Math.min(1,dt/.18); // 속도는 부드럽게 따라간다
      this.p=Math.min(1,this.p+this.v*dt); this.ph+=this.v*dt*40;
      this.tilt*=Math.exp(-dt/.22);
      this.render(); setP(this.p);
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },
  onDetect(){retrigger($('carDash'),'shake');},
  onMotion(dir,k=1){ // 앞뒤 동작의 힘이 차에 실린다
    if(dir!=='forward'&&dir!=='back') dir=this.lastDir==='forward'?'back':'forward';
    this.lastDir=dir;
    this.b=Math.min(CFG.car.boostMax,this.b+CFG.car.boost*k);
    this.tilt=dir==='forward'?5:-4;
  },
  result(){
    scene.innerHTML=`<rect width="844" height="390" fill="${C.sky}"/>
      <g filter="url(#rough)"><ellipse cx="130" cy="56" rx="52" ry="14" fill="${C.sheet}"/><ellipse cx="640" cy="80" rx="44" ry="12" fill="${C.sheet}"/>
      <ellipse cx="422" cy="400" rx="560" ry="150" fill="${C.hill}"/><ellipse cx="422" cy="420" rx="380" ry="150" fill="${C.hill2}"/>
      <use href="#tower" x="352" y="6" width="140" height="350"/>
      ${tree(250,320,1.5)}${tree(160,350,1.2)}${tree(596,322,1.5)}${tree(690,352,1.2)}</g>
      <use href="#car" x="350" y="300" width="144" height="83" filter="url(#lift)"/>
      <g class="pop"><g filter="url(#lift)"><rect x="40" y="96" width="290" height="150" rx="22" fill="${C.sheet}"/></g>
        <text x="185" y="150" font-size="44" text-anchor="middle" fill="${C.deep}">도착!</text>
        <text x="185" y="190" font-size="19" text-anchor="middle" fill="${C.deep}">석유 2.5리터를 아끼고</text><text x="185" y="216" font-size="19" text-anchor="middle" fill="${C.deep}">소나무 2그루를 심은 셈이에요</text></g>
      ${plusOne()}`;
  }
};

/* ================= B 호두과자 (회전 = 타이밍 맞춰 한 번에 뒤집기) ================= */
const NUTS=10, NUT_R=34, NUT_LV=3; // 한 면이 NUT_LV번 익어야 다 익는다
const nutXY=i=>[222+(i>>1)*100, 130+(i&1)*84];
const rnd=(a,b)=>a+Math.random()*(b-a);
function nut(cx,cy,r,lv,burnt){ // 한 면의 모습: 반죽 → 살짝 → 노릇 → 다 익음, 또는 탐
  const lines=(base,line,hi)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${base}"/>
   <path d="M${cx} ${cy-r*.85} Q${cx-r*.25} ${cy} ${cx} ${cy+r*.85}" stroke="${line}" stroke-width="${r*.13}" fill="none" stroke-linecap="round"/>
   <path d="M${cx-r*.62} ${cy-r*.45} Q${cx-r*.2} ${cy-r*.2} ${cx-r*.6} ${cy+r*.4}" stroke="${line}" stroke-width="${r*.11}" fill="none" stroke-linecap="round"/>
   <path d="M${cx+r*.62} ${cy-r*.45} Q${cx+r*.3} ${cy} ${cx+r*.58} ${cy+r*.45}" stroke="${line}" stroke-width="${r*.11}" fill="none" stroke-linecap="round"/>
   ${hi?`<path d="M${cx-r*.5} ${cy-r*.6} Q${cx} ${cy-r*.95} ${cx+r*.5} ${cy-r*.6}" stroke="${hi}" stroke-width="${r*.1}" fill="none" stroke-linecap="round"/>`:''}`;
  if(burnt) return lines('#3F2415','#1E110A','');
  if(lv<=0) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.dough}"/>`;
  if(lv===1) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F7DD9A"/>`;
  if(lv===2) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F0BE62"/><path d="M${cx} ${cy-r*.8} Q${cx-r*.25} ${cy} ${cx} ${cy+r*.8}" stroke="#D99A42" stroke-width="${r*.12}" fill="none" stroke-linecap="round"/>`;
  return lines(C.baked,C.baked2,'#E6A260');
}
const hodu={
  finishDelay:900,
  enter(){
    let cells='', glow='';
    for(let i=0;i<NUTS;i++){const [x,y]=nutXY(i); cells+=`<g class="hcell" data-i="${i}"></g>`; glow+=`<circle cx="${x}" cy="${y}" r="${NUT_R+6}"/>`;}
    scene.innerHTML=`<rect width="844" height="390" fill="${C.fire}"/><g filter="url(#rough)">
      <path d="M0 390 L0 210 Q40 150 70 220 Q100 110 150 230 Q190 170 220 250 Q270 130 320 240 Q360 180 400 260 Q450 150 500 250 Q540 170 590 240 Q640 120 690 230 Q730 160 770 240 Q810 150 844 220 L844 390 Z" fill="${C.fire2}"/>
      <path d="M0 390 L0 300 Q50 240 90 310 Q140 230 190 320 Q240 260 290 330 Q350 240 410 330 Q470 260 520 320 Q580 230 640 320 Q700 260 750 320 Q800 250 844 300 L844 390 Z" fill="${C.yellow}" opacity=".85"/>
      <circle cx="60" cy="90" r="4" fill="${C.yellow}"/><circle cx="790" cy="130" r="5" fill="${C.yellow}"/><circle cx="420" cy="74" r="3" fill="${C.yellow}"/><circle cx="700" cy="60" r="3" fill="${C.yellow}"/><circle cx="110" cy="50" r="3" fill="${C.yellow}"/></g>
      <g filter="url(#lift)"><rect x="410" y="262" width="24" height="26" fill="#3F5157"/><rect x="400" y="286" width="44" height="130" rx="10" fill="${C.red}"/></g>
      <g id="hoduTray">
        <g filter="url(#lift)"><rect x="142" y="78" width="560" height="188" rx="20" fill="${C.tray}"/></g>
        <g filter="url(#rough)" id="hoduCells">${cells}</g>
        <g id="hoduGlow" fill="none" stroke-width="5">${glow}</g>
      </g>
      <!-- 불 게이지: 초록 칸에서 뒤집는다. 빨강까지 가면 탄다. 칸 위치와 속도는 판마다 바뀐다 -->
      <g filter="url(#lift)"><rect x="286" y="20" width="300" height="26" rx="13" fill="${C.sheet}"/></g>
      <rect id="hoduGood" y="24" height="18" fill="${C.green}"/><path id="hoduLate" fill="${C.red}"/>
      <g id="hoduMark"><rect x="284" y="13" width="12" height="40" rx="6" fill="${C.deep}"/></g>
      <g filter="url(#rough)"><circle cx="258" cy="33" r="15" fill="${C.sheet}"/><circle cx="258" cy="33" r="15" fill="none" stroke="${C.deep}" stroke-width="4"/><path d="M258 24 L258 33 L265 37" stroke="${C.deep}" stroke-width="4" fill="none" stroke-linecap="round"/></g>
      <g id="hint"><g filter="url(#lift)"><path d="M738 178 A34 34 0 1 1 780 205" stroke="${C.sheet}" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M802 206 L770 222 L772 188 Z" fill="${C.sheet}"/></g>${say('빙글 돌아 호두과자를 구워요',366)}</g>`;
    // 면 A가 위, 면 B가 불 쪽. lv는 면마다 익은 정도, burnt는 탄 칸
    Object.assign(this,{top:'A',lv:{A:0,B:0},burnt:{A:new Set(),B:new Set()},n:0,zone:-1,busy:false,fin:false});
    this.newCycle(0); this.draw(); this.tick();
  },
  newCycle(delay){ // 판마다 게이지 속도와 초록 칸이 달라진다
    const K=CFG.hodu, sec=rnd(K.sec[0],K.sec[1]), w=Math.min(.45,rnd(K.win[0],K.win[1])/sec), lo=rnd(.3,.95-w), hi=lo+w;
    this.cyc={sec,lo,hi}; this.g0=performance.now()+delay;
    const x1=290+292*lo, x2=290+292*hi, g=$('hoduGood');
    g.setAttribute('x',x1); g.setAttribute('width',x2-x1);
    $('hoduLate').setAttribute('d',`M${x2} 24 L573 24 Q582 24 582 33 Q582 42 573 42 L${x2} 42 Z`);
  },
  draw(){ // 지금 위로 온 면을 그린다
    scene.querySelectorAll('.hcell').forEach(g=>{const i=+g.dataset.i,[x,y]=nutXY(i);
      // 다 구운 뒤에는 어느 한 면이라도 탄 칸을 탄 모습으로 보여 준다
      const b=this.burnt[this.top].has(i)||(this.fin&&(this.burnt.A.has(i)||this.burnt.B.has(i)));
      g.innerHTML=nut(x,y,NUT_R,this.lv[this.top],b);});
  },
  gauge(){ // 지금 게이지 값 0~1 (시계로 계산). 첫 판은 초록 칸에서 기다려 준다
    const c=this.cyc; let f=Math.max(0,(performance.now()-this.g0)/1000/c.sec);
    if(this.n===0) f=Math.min(f,(c.lo+c.hi)/2);
    return Math.min(1,f); },
  zoneOf(f){ return f<this.cyc.lo?0:f<=this.cyc.hi?1:2; }, // 0 이름, 1 딱 좋음, 2 늦음
  tick(){
    const t=tok;
    const loop=()=>{ if(t!==tok||st.screen!=='play') return;
      const f=this.gauge(), z=this.zoneOf(f);
      $('hoduMark').setAttribute('transform',`translate(${292*f} 0)`);
      if(z!==this.zone){ this.zone=z; $('hoduGlow').setAttribute('class',['','good','late'][z]); }
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },
  onDetect(){retrigger($('hoduTray'),'shake');},
  onMotion(){ // 판 전체를 한 번에 뒤집는다
    if(this.busy) return;
    const z=this.zoneOf(this.gauge()), down=this.top==='A'?'B':'A'; this.n++;
    if(z>0){ this.lv[down]=Math.min(NUT_LV,this.lv[down]+1); // 불 쪽 면이 익었다
      if(z===2){ // 늦었다: 몇 개는 그 면이 탄다
        const all=new Set([...this.burnt.A,...this.burnt.B]);
        const ok=[...Array(NUTS).keys()].filter(i=>!all.has(i)).sort(()=>Math.random()-.5);
        ok.slice(0,Math.min(CFG.hodu.burn,Math.max(0,ok.length-2))).forEach(i=>this.burnt[down].add(i)); } }
    this.top=down; this.busy=true;
    $('hoduGlow').setAttribute('class',''); this.zone=-1;
    const fin=this.fin=this.lv.A>=NUT_LV&&this.lv.B>=NUT_LV;
    if(!fin) this.newCycle(reduced()?0:260);
    if(reduced()){ this.draw(); this.busy=false; }
    else{ retrigger($('hoduTray'),'flipping'); later(()=>this.draw(),130); later(()=>{this.busy=false;},260); }
    setP(fin?1:(this.lv.A+this.lv.B)/(2*NUT_LV)*.99);
  },
  result(sec){
    const good=NUTS-new Set([...this.burnt.A,...this.burnt.B]).size;
    scene.insertAdjacentHTML('beforeend',`<rect class="fade" width="844" height="390" fill="#2A1208" opacity=".38"/>
      <g class="pop"><g filter="url(#lift)"><rect x="262" y="116" width="320" height="158" rx="22" fill="${C.sheet}"/></g>
        <text x="422" y="166" font-size="25" text-anchor="middle" fill="${C.deep}">호두과자 ${good}개를</text><text x="422" y="198" font-size="25" text-anchor="middle" fill="${C.deep}">${good===NUTS?'모두 맛있게 구웠어요':'맛있게 구웠어요'}</text>
        <rect x="366" y="214" width="112" height="42" rx="21" fill="${C.red}" filter="url(#rough)"/><text x="422" y="244" font-size="26" text-anchor="middle" fill="${C.sheet}">${sec}초</text></g>
      ${plusOne()}`);
  }
};

/* ================= C 물주기 (도는 방향과 빠르기 = 물줄기) ================= */
const HZ=150;
const LANE={L:{b:60,t:300,fn:corn},C:{b:422,t:422,fn:cabbage},R:{b:784,t:544,fn:flower}};
const water={
  finishDelay:500,
  enter(){
    const T0=150,T1=694,B0=-420,B1=1264,N=14; let f=`<polygon points="${T0},${HZ} ${T1},${HZ} ${B1},390 ${B0},390" fill="${C.soil}"/>`;
    for(let i=0;i<N;i+=2){const a=i/N,b=(i+1)/N;
      f+=`<polygon points="${T0+(T1-T0)*a},${HZ} ${T0+(T1-T0)*b},${HZ} ${B0+(B1-B0)*b},390 ${B0+(B1-B0)*a},390" fill="${C.soil2}"/>`;}
    scene.innerHTML=`<rect width="844" height="${HZ+10}" fill="${C.sky}"/><g filter="url(#rough)">
      <ellipse cx="110" cy="50" rx="46" ry="12" fill="${C.sheet}"/><ellipse cx="610" cy="34" rx="36" ry="10" fill="${C.sheet}"/>
      <ellipse cx="200" cy="${HZ+26}" rx="330" ry="62" fill="${C.hill2}"/><ellipse cx="680" cy="${HZ+30}" rx="320" ry="56" fill="${C.hill}"/>
      <g transform="translate(764 70)"><rect x="-2" y="0" width="4" height="74" fill="${C.sheet}"/><path d="M0 0 L-5 -34 L5 -34 Z M0 0 L32 14 L27 23 Z M0 0 L-32 14 L-27 23 Z" fill="${C.sheet}"/></g>
      ${tree(92,HZ+6,.9)}${tree(652,HZ+2,1)}</g>
      <g filter="url(#rough)">${f}</g>
      <g filter="url(#lift)"><g id="basketFill">${cabbageHead(392,62,22)}${cabbageHead(446,58,24)}${cornCob(350,70,-28)}${cornCob(488,70,26)}${cabbageHead(420,48,20)}</g>
        <path d="M322 74 Q330 66 344 72 L500 72 Q514 66 522 74 Q500 138 422 138 Q344 138 322 74 Z" fill="#E9B44C"/></g>
      <g filter="url(#rough)" stroke="#C48A2C" stroke-width="3" fill="none"><path d="M336 90 Q422 104 508 90"/><path d="M350 108 Q422 122 494 108"/><path d="M372 124 Q422 132 472 124"/></g>
      <g filter="url(#rough)"><g id="cropL"></g><g id="cropC"></g><g id="cropR"></g></g>
      <path id="wStream" fill="none" stroke="${C.water}" stroke-width="16" stroke-linecap="round" opacity="0"/>
      <g id="wSplash" fill="${C.sheet}" opacity="0"><circle cx="-16" cy="-8" r="4"/><circle cx="13" cy="-14" r="3"/><circle cx="6" cy="7" r="4"/><circle cx="-7" cy="-22" r="3"/><circle cx="22" cy="2" r="3"/></g>
      <g id="nozC"><g filter="url(#lift)"><rect x="413" y="330" width="18" height="70" fill="#9FB4C0"/></g>
        <g id="wHead"><g filter="url(#lift)"><rect x="406" y="308" width="32" height="26" rx="7" fill="${C.deep}"/></g></g></g>
      <g id="fliers"></g>
      <g id="hint">${arrowsLR(422,250,1.1,C.sheet)}${say('좌우로 흔들흔들, 밭에 물을 줘요',376)}</g>`;
    // a: 물줄기가 향하는 곳(-1 왼쪽 끝 ~ 1 오른쪽 끝), va: 도는 빠르기, flow: 물 세기
    Object.assign(this,{a:0,va:0,input:0,flow:0,w:{L:0,C:0,R:0},stage:{L:-1,C:-1,R:-1},last:'right',_o:-1,_h:99});
    this.render(); this.stream();
  },
  render(){ // 줄마다 받은 물만큼 자란다: 새싹 → 중간 → 다 자람
    for(const k of ['L','C','R']){
      const q=this.w[k]/CFG.water.needSec, g=q<=0?0:q<.5?1:q<1?2:3; if(g===this.stage[k]) continue; this.stage[k]=g;
      const L=LANE[k]; let o='';
      for(let r=0;r<5;r++){const u=(r+1)/5.6, y=HZ+8+(322-HZ)*u*u, s=.32+.95*u*u, cx=L.t+(L.b-L.t)*(y-HZ)/(390-HZ);
        for(const d of [-1,0,1]) o+=L.fn(cx+d*46*s,y,s,g);}
      $('crop'+k).innerHTML=o; }
  },
  stream(){ // 물줄기 하나가 향한 쪽으로 휘어 떨어진다
    const a=this.a, lx=422+a*205, ly=218, o=Math.round(Math.min(1,this.flow)*20)/20;
    $('wStream').setAttribute('d',`M422 318 Q${(422+lx)/2+a*24} 44 ${lx} ${ly}`);
    $('wSplash').setAttribute('transform',`translate(${lx} ${ly})`);
    if(o!==this._o){ this._o=o; $('wStream').setAttribute('opacity',o); $('wSplash').setAttribute('opacity',o); }
    const h=Math.round(a*26);
    if(h!==this._h){ this._h=h; $('wHead').setAttribute('transform',`rotate(${h} 422 334)`); }
  },
  onStart(){
    const t=tok; let last=performance.now();
    const loop=now=>{ if(t!==tok||st.screen!=='play') return;
      const dt=Math.min(.05,(now-last)/1000), K=CFG.water; last=now;
      this.va+=this.input*K.accel*dt; this.va*=Math.exp(-dt/K.glide);
      this.a+=this.va*dt;
      if(this.a<-1){this.a=-1;this.va=0;} else if(this.a>1){this.a=1;this.va=0;} // 끝까지 가면 물이 멎는다. 반대로 돌아야 한다
      this.flow+=(Math.min(1,Math.abs(this.va)/K.flowAt)-this.flow)*Math.min(1,dt/.12); // 빨리 돌수록 물이 세다
      if(this.flow>.05){ const k=this.a<-.33?'L':this.a>.33?'R':'C';
        this.w[k]=Math.min(K.needSec,this.w[k]+this.flow*dt); this.render(); }
      this.stream(); setP((this.w.L+this.w.C+this.w.R)/(3*K.needSec));
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },
  onDetect(){retrigger($('nozC'),'press');},
  onMotion(dir){ // 동작 1번 = 그쪽으로 한 번 휙 돌린 것
    if(dir!=='left'&&dir!=='right') dir=this.last==='left'?'right':'left';
    this.last=dir; this.va+=(dir==='left'?-1:1)*CFG.water.kick;
  },
  onTurn(rate){ this.input=rate; }, // 계속 도는 빠르기(-1 왼쪽 ~ 1 오른쪽)
  result(){
    this.flow=1; this._o=-1; this.stream();
    const fill=()=>{$('fliers').innerHTML=''; $('basketFill').classList.add('full');};
    if(reduced()) fill();
    else{ // 양배추와 옥수수가 바구니로 날아가 담긴다
      const fl=(inner,dx,dy,d)=>`<g class="flier" style="--dx:${dx}px;--dy:${dy}px;animation-delay:${d}s">${inner}</g>`;
      $('fliers').innerHTML=fl(cabbageHead(446,58,24),-24,232,0)+fl(cornCob(350,70,-28),-230,230,.08)+fl(cabbageHead(392,62,22),48,168,.16)+fl(cornCob(488,70,26),-308,180,.12)+fl(cabbageHead(420,48,20),-10,152,.2);
      later(fill,1000);
    }
    scene.insertAdjacentHTML('beforeend',plusOne());
  }
};

/* ================= 흐름 ================= */
const G={car,hodu,water};
function open(game){
  if(!G[game]) return;
  tok++; st={screen:'play',game,count:0,p:0,t0:0};
  cards.hidden=true; G[game].enter();
}
function detect(kind,dir){
  if(st.screen!=='play'||(kind&&kind!==MOTION[st.game])) return;
  G[st.game].onDetect(dir);
}
function motion(kind,dir,k){ // k: 세기(기본 1)
  if(st.screen!=='play'||(kind&&kind!==MOTION[st.game])) return;
  touch(); st.count++;
  G[st.game].onMotion(dir,k>0?k:1);
}
function touch(){ // 첫 동작: 안내를 치우고 시간을 재기 시작한다
  if(st.t0) return;
  st.t0=performance.now(); const h=$('hint'), g=G[st.game]; if(h) h.remove(); if(g.onStart) g.onStart();
}
function turn(rate){ // 계속 도는 빠르기(-1 왼쪽 ~ 1 오른쪽). 물주기에서 쓴다
  if(st.screen!=='play') return;
  const g=G[st.game]; if(!g.onTurn) return;
  rate=Math.max(-1,Math.min(1,+rate||0)); if(rate) touch();
  g.onTurn(rate);
}
function setP(p){ // 진행도는 줄지 않는다. 100%가 되면 완료
  st.p=Math.max(st.p,Math.min(1,p));
  if(st.p>=1&&st.screen==='play'){ st.screen='finishing'; later(complete,G[st.game].finishDelay); }
}
function complete(){
  const game=st.game, seconds=Math.max(1,Math.round((performance.now()-st.t0)/1000));
  st.screen='done'; done.add(game);
  G[game].result(seconds);
  window.dispatchEvent(new CustomEvent('linny:complete',{detail:{game,seconds}}));
  later(showHome,CFG.doneMs);
}

/* 홈 카드: 2초 누르기 (키보드는 Enter/Space로 바로) */
cards.querySelectorAll('.card-btn').forEach(b=>{
  const game=b.dataset.game; let timer=0;
  const cancel=()=>{clearTimeout(timer);timer=0;const c=$('card-'+game);if(c)c.classList.remove('holding');};
  b.addEventListener('pointerdown',e=>{ if(e.button) return; cancel();
    const c=$('card-'+game); if(c) c.classList.add('holding');
    timer=setTimeout(()=>{cancel();open(game);},CFG.holdMs); });
  for(const ev of ['pointerup','pointerleave','pointercancel']) b.addEventListener(ev,cancel);
  b.addEventListener('click',e=>{ if(e.detail===0||TAP) open(game); });
  b.addEventListener('contextmenu',e=>e.preventDefault());
});

/* 시험용 입력
   키보드: 홈에서 1·2·3 게임 열기. 게임에서 ↑ 앞으로 / ↓ 뒤로 / ← 왼쪽 / → 오른쪽 / Space 방향 없이 1번, D 감지, Esc 홈.
   톡 치기 모드: 화면 왼쪽 절반은 왼쪽(뒤로), 오른쪽 절반은 오른쪽(앞으로). */
const KEYDIR={ArrowUp:'forward',ArrowDown:'back',ArrowLeft:'left',ArrowRight:'right'};
addEventListener('keydown',e=>{
  if(e.repeat) return;
  if(st.screen==='home'){ const g={1:'car',2:'hodu',3:'water'}[e.key]; if(g) open(g); return; }
  if(e.key===' '||KEYDIR[e.key]){ e.preventDefault(); motion(undefined,KEYDIR[e.key]);
    if(e.key==='ArrowLeft') turn(-1); else if(e.key==='ArrowRight') turn(1); } // 누르고 있으면 계속 돈다
  else if(e.key==='d'||e.key==='D') detect();
  else if(e.key==='Escape') showHome();
});
addEventListener('keyup',e=>{ if(e.key==='ArrowLeft'||e.key==='ArrowRight') turn(0); });
if(TAP){
  const imuOn=()=>window.Linny&&window.Linny.imuActive; // 센서가 살아 있으면 터치는 동작으로 치지 않는다
  stageBox.addEventListener('pointerdown',e=>{ if(st.screen!=='play'||imuOn()) return;
    const r=stageBox.getBoundingClientRect(), left=e.clientX<r.left+r.width/2;
    const dir=st.game==='car'?(left?'back':'forward'):(left?'left':'right');
    detect(undefined,dir); motion(undefined,dir); turn(left?-1:1); });
  for(const ev of ['pointerup','pointercancel','pointerleave']) stageBox.addEventListener(ev,()=>{ if(!imuOn()) turn(0); });
}

window.Linny={open,detect,motion,turn,home:showHome,config:CFG,get state(){return {...st,done:[...done]};}};
showHome();
})();
