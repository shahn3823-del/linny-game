/* 리니: 학습 노트북(train-v1.3.1)의 판단 과정을 폰에서 그대로 따라 한다.
   전처리(50 Hz 선형 보간, 창, 0.5초 간격) → 특징 → model.json의 모델(Random Forest / Gradient Boosting) 또는 규칙
   → 시간 평활 k → 확신 기준 이상이 consec번 연속이면 에너지 동작 1번, 이후 refractory_s초 쉼.
   특징 식은 노트북의 compute_features_ref(기준 구현)와 같다. 채널 순서: ax, ay, az(중력 포함), gx, gy, gz(도/초). */
(() => {
'use strict';

const mean=x=>{let s=0;for(let i=0;i<x.length;i++)s+=x[i];return s/x.length;};
function stats(x){ // 평균, 모집단 표준편차, 최소, 최대
  const m=mean(x); let v=0,mn=Infinity,mx=-Infinity;
  for(let i=0;i<x.length;i++){const d=x[i]-m; v+=d*d; if(x[i]<mn)mn=x[i]; if(x[i]>mx)mx=x[i];}
  return {mean:m,std:Math.sqrt(v/x.length),min:mn,max:mx};
}
function signChanges(x,dead){ // |x|>dead 인 샘플만 남겨 부호가 바뀐 횟수
  let prev=0,n=0;
  for(let i=0;i<x.length;i++){ if(Math.abs(x[i])>dead){ const s=x[i]>0?1:-1; if(prev&&s!==prev)n++; prev=s; } }
  return n;
}
function pearson(a,a0,b,b0,m){ // a[a0..a0+m), b[b0..b0+m)의 모집단 피어슨 상관. 표준편차가 1e-9보다 작으면 0
  let sa=0,sb=0; for(let i=0;i<m;i++){sa+=a[a0+i];sb+=b[b0+i];}
  const ma=sa/m, mb=sb/m; let va=0,vb=0,c=0;
  for(let i=0;i<m;i++){const da=a[a0+i]-ma, db=b[b0+i]-mb; va+=da*da; vb+=db*db; c+=da*db;}
  const s1=Math.sqrt(va/m), s2=Math.sqrt(vb/m);
  return s1<1e-9||s2<1e-9?0:(c/m)/(s1*s2);
}
function domf(x,fs,grid){ // 주된 주파수: 격자 위 직접 DFT 파워의 첫 최댓값
  const m=mean(x), n=x.length; let e=0; const xm=new Float64Array(n);
  for(let i=0;i<n;i++){xm[i]=x[i]-m; e+=xm[i]*xm[i];}
  if(e<1e-9) return 0;
  let best=-1,bf=0;
  for(const f of grid){ let c=0,s=0;
    for(let t=0;t<n;t++){const w=2*Math.PI*f*t/fs; c+=xm[t]*Math.cos(w); s+=xm[t]*Math.sin(w);}
    const p=c*c+s*s; if(p>best){best=p;bf=f;} }
  return bf;
}
function band(x,fs,lo,hi){ // 0.5~2 Hz 파워 / DC를 뺀 전체 파워 (rfft와 같은 칸)
  const m=mean(x), n=x.length, K=Math.floor(n/2); let tot=0,inb=0;
  for(let k=1;k<=K;k++){ let c=0,s=0;
    for(let t=0;t<n;t++){const w=2*Math.PI*k*t/n, v=x[t]-m; c+=v*Math.cos(w); s-=v*Math.sin(w);}
    const p=c*c+s*s, f=k*fs/n; tot+=p; if(f>=lo&&f<=hi) inb+=p; }
  return tot<1e-9?0:inb/tot;
}
function periodicity(x,minLag,maxLag){ // 상관이 처음 음수가 된 지연 이후의 최댓값
  const n=x.length; if(maxLag<1) return 0;
  const r=new Float64Array(maxLag+1); let l0=0;
  for(let l=1;l<=maxLag;l++){ r[l]=pearson(x,0,x,l,n-l); if(!l0&&r[l]<0) l0=l; }
  if(!l0) return 0;
  const start=Math.max(l0,minLag); if(start>maxLag) return 0;
  let mx=-Infinity; for(let l=start;l<=maxLag;l++) if(r[l]>mx) mx=r[l];
  return Math.max(0,mx);
}
function gridHz(g){ const out=[]; for(let i=0;;i++){ const f=Math.round((g[0]+i*g[2])*1e6)/1e6; if(f>g[1]+g[2]/2-1e-12) break; out.push(f); } return out; }

/* 창 하나(채널별 배열 6개) → {특징 이름: 값}. 두 특징 세트에 필요한 값을 모두 담는다 */
function features(w,P){
  const [ax,ay,az,gx,gy,gz]=w, n=ax.length, fs=P.fs, d={};
  const amag=new Float64Array(n), gmag=new Float64Array(n);
  for(let i=0;i<n;i++){ amag[i]=Math.sqrt(ax[i]*ax[i]+ay[i]*ay[i]+az[i]*az[i]); gmag[i]=Math.sqrt(gx[i]*gx[i]+gy[i]*gy[i]+gz[i]*gz[i]); }
  const ch={ax,ay,az,gx,gy,gz,amag,gmag};
  for(const c in ch){ const s=stats(ch[c]);
    d[c+'_mean']=s.mean; d[c+'_std']=s.std; d[c+'_min']=s.min; d[c+'_max']=s.max; d[c+'_dmin']=s.min-s.mean; d[c+'_dmax']=s.max-s.mean; }
  let gi=0,ga=0; for(let i=0;i<n;i++){gi+=gz[i]; ga+=Math.abs(gz[i]);}
  d.gz_int=gi/fs; d.gz_absint=ga/fs; d.gz_sc=signChanges(gz,P.gzDead);
  const axm=new Float64Array(n); for(let i=0;i<n;i++) axm[i]=ax[i]-d.ax_mean;
  d.ax_zc=signChanges(axm,P.zcDead);
  for(const c of ['ax','gy','gz']){ const x=ch[c];
    d[c+'_domf']=domf(x,fs,P.grid); d[c+'_band']=band(x,fs,P.band[0],P.band[1]); d[c+'_per']=periodicity(x,P.minLag,P.maxLag); }
  d.corr_ax_gy=pearson(ax,0,gy,0,n);
  let jm=0,js=0; for(let i=1;i<n;i++){const j=Math.abs(amag[i]-amag[i-1])*fs; if(j>jm)jm=j; js+=j;}
  d.amag_jerkmax=jm; d.amag_jerkmean=js/(n-1);
  return d;
}

function probaRF(M,x){ // 잎의 클래스 비율 평균. scikit-learn처럼 float32로 비교
  const acc=new Float64Array(M.trees[0].value.find(v=>v.length).length);
  for(const t of M.trees){ let n=0;
    while(t.left[n]!==-1) n=Math.fround(x[t.feature[n]])<=Math.fround(t.threshold[n])?t.left[n]:t.right[n];
    const v=t.value[n]; for(let c=0;c<acc.length;c++) acc[c]+=v[c]; }
  return Array.from(acc,v=>v/M.trees.length);
}
function probaGB(M,x){ // softmax(baseline + 반복마다 클래스별 트리 잎 값)
  const raw=M.baseline.slice();
  for(const it of M.iterations) it.forEach((t,c)=>{ let n=0;
    while(!t.leaf[n]) n=x[t.feature[n]]<=t.threshold[n]?t.left[n]:t.right[n];
    raw[c]+=t.value[n]; });
  const mx=Math.max(...raw), e=raw.map(v=>Math.exp(v-mx)), s=e.reduce((a,b)=>a+b,0);
  return e.map(v=>v/s);
}
function ruleClass(d,th){ // 규칙 베이스라인: 아래로 갈수록 우선 (spin > dance > pump > still > move)
  let out='move';
  if(d.gmag_mean<=th.T_still_g&&d.amag_std<=th.T_still_a) out='still';
  if(d.ax_std>=th.T_pump&&d.ax_per>=th.A_pump) out='pump';
  if(d.gz_sc>=th.N_dance&&d.gz_std>=th.T_dance) out='dance';
  if(Math.abs(d.gz_mean)>=th.T_spin) out='spin';
  return out;
}

/* model.json 하나로 판단기를 만든다. kind: 'model'(기본) 또는 'rule' */
function create(J,kind){
  const pp=J.preprocess, fp=J.feature_params, dc=J.decider;
  const P={fs:pp.fs, n:pp.win_samples, hop:pp.hop_samples, gzDead:fp.gz_sign_deadband, zcDead:fp.ax_zc_deadband,
    grid:gridHz(fp.domf.grid_hz), band:fp.band.band_hz, minLag:fp.periodicity.min_lag_samples, maxLag:fp.periodicity.max_lag_samples};
  const names=J.features.map(f=>f.name), classes=J.classes, energy=new Set(J.energy);
  const useRule=kind==='rule'||!J.model, dtMs=1000/P.fs;
  const buf=Array.from({length:6},()=>[]);   // 50 Hz로 맞춘 최근 샘플
  let prevT=null, prevV=null, nextT=null, since=0, hist=[], prevLab=null, cnt=0, until=-Infinity;

  function proba(d){
    if(useRule){ const k=classes.indexOf(ruleClass(d,J.rule.thresholds)); return classes.map((_,i)=>i===k?1:0); }
    const x=names.map(nm=>d[nm]);
    return J.model.type==='gradient_boosting'?probaGB(J.model,x):probaRF(J.model,x);
  }
  function decide(tMs){ // 창 하나를 판단한다
    const d=features(buf.map(c=>Float64Array.from(c)),P), p=proba(d);
    hist.push(p); if(hist.length>dc.smooth_k) hist.shift();
    const sm=p.map((v,c)=>hist.reduce((a,h)=>a+h[c],0)/hist.length+1e-9*v); // 최근 k개 평균, 동점이면 지금 쪽
    let k=0; for(let c=1;c<sm.length;c++) if(sm[c]>sm[k]) k=c;
    const label=classes[k]; let event=null;
    if(energy.has(label)&&sm[k]>=dc.conf){ cnt=label===prevLab?cnt+1:1; prevLab=label; } else { cnt=0; prevLab=null; }
    if(cnt>=dc.consec&&tMs>=until){ event=label; until=tMs+dc.refractory_s*1000; cnt=0; }
    return {t:tMs,label,p:sm[k],proba:sm,event,features:d};
  }
  /* 센서 샘플 하나를 넣는다. v=[ax,ay,az,gx,gy,gz]. 새 창이 판단되면 그 결과를, 아니면 null */
  function push(tMs,v){
    let out=null;
    if(prevT===null){ prevT=tMs; prevV=v; nextT=tMs; }
    if(tMs-prevT>1000){ for(const c of buf) c.length=0; nextT=tMs; since=0; hist=[]; cnt=0; prevLab=null; prevT=tMs; prevV=v; } // 센서가 끊겼다 이어지면 새로 시작
    while(nextT<=tMs){ const u=tMs===prevT?0:(nextT-prevT)/(tMs-prevT);
      for(let c=0;c<6;c++){ buf[c].push(prevV[c]+u*(v[c]-prevV[c])); if(buf[c].length>P.n) buf[c].shift(); }
      nextT+=dtMs; since++;
      if(buf[0].length===P.n&&since>=P.hop){ since=0; out=decide(nextT-dtMs); } }
    prevT=tMs; prevV=v;
    return out;
  }
  return {push,params:P,names,classes,usingRule:useRule,latencyS:dc.approx_min_latency_s,
    featuresOf:w=>features(w,P), probaOf:d=>proba(d), version:J.version, demo:!!J.demo_data};
}

window.LinnyModel={create,features,probaRF,probaGB,ruleClass,gridHz};
})();
