// ASLingo handshape classifier v4
// MediaPipe gives us 21 landmarks. This module converts them into a palm-relative
// coordinate system, scores all static alphabet handshapes, and then lowers
// confidence when a confusable letter scores almost as well.

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const clamp = (v,min=0,max=1)=>Math.max(min,Math.min(max,v));
export const avg = xs=>xs?.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;

const V=(p)=>({x:p.x||0,y:p.y||0,z:p.z||0});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const mul=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const mag=(a)=>Math.hypot(a.x,a.y,a.z);
const norm=(a)=>{const m=mag(a)||1;return mul(a,1/m)};
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const midpoint=(a,b)=>(a+b)/2;
const closeness=(v,t,tol)=>clamp(1-Math.abs(v-t)/Math.max(tol,1e-6));
const ramp=(v,lo,hi)=>clamp((v-lo)/Math.max(hi-lo,1e-6));
const inverseRamp=(v,lo,hi)=>1-ramp(v,lo,hi);
const between=(v,a,b,soft=.12)=>{
  const lo=Math.min(a,b), hi=Math.max(a,b);
  if(v>=lo && v<=hi) return 1;
  return Math.max(closeness(v,lo,soft),closeness(v,hi,soft));
};

function angle(a,b,c){
  const ab=sub(a,b), cb=sub(c,b);
  const ma=mag(ab), mc=mag(cb);
  if(!ma||!mc) return 0;
  return Math.acos(clamp(dot(ab,cb)/(ma*mc),-1,1))*180/Math.PI;
}

function localize(lm){
  const pts=lm.map(V);
  const origin=[0,5,9,13,17].map(i=>pts[i]).reduce((a,b)=>add(a,b),{x:0,y:0,z:0});
  const center=mul(origin,1/5);
  let xAxis=norm(sub(pts[17],pts[5]));          // anatomical index -> pinky
  const yRough=norm(sub(pts[9],pts[0]));       // wrist -> middle MCP
  let zAxis=norm(cross(xAxis,yRough));
  if(mag(zAxis)<.2) zAxis={x:0,y:0,z:1};
  let yAxis=norm(cross(zAxis,xAxis));
  const scale=Math.max(dist(pts[5],pts[17]),dist(pts[0],pts[9]),.04);
  return pts.map(p=>{
    const q=sub(p,center);
    return {x:dot(q,xAxis)/scale,y:dot(q,yAxis)/scale,z:dot(q,zAxis)/scale};
  });
}

function extensionScore(lm,mcp,pip,dip,tip){
  const pipAngle=angle(lm[mcp],lm[pip],lm[dip]);
  const dipAngle=angle(lm[pip],lm[dip],lm[tip]);
  const straight=clamp(((pipAngle-72)/100)*.7+((dipAngle-72)/100)*.3);
  const reach=clamp((dist(lm[tip],lm[0])/(dist(lm[pip],lm[0])+1e-6)-.88)/.42);
  return clamp(straight*.78+reach*.22);
}

function screenDirection(lm,a,b){
  const dx=lm[b].x-lm[a].x, dy=lm[b].y-lm[a].y;
  const m=Math.hypot(dx,dy)||1;
  return {x:dx/m,y:dy/m};
}


function orient2d(a,b,c){
  return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
}
function segmentsCross2d(a,b,c,d){
  const o1=orient2d(a,b,c),o2=orient2d(a,b,d),o3=orient2d(c,d,a),o4=orient2d(c,d,b);
  return ((o1>0&&o2<0)||(o1<0&&o2>0)) && ((o3>0&&o4<0)||(o3<0&&o4>0));
}

export function makeFeatures(lm, handed='Right'){
  const L=localize(lm);

  const index=extensionScore(lm,5,6,7,8);
  const middle=extensionScore(lm,9,10,11,12);
  const ring=extensionScore(lm,13,14,15,16);
  const pinky=extensionScore(lm,17,18,19,20);

  const thumbAngle=angle(lm[1],lm[2],lm[4]);
  const palmWidth=dist(lm[5],lm[17])+1e-6;
  const thumbReach=dist(lm[4],lm[5])/palmWidth;
  const thumb=clamp(((thumbAngle-48)/108)*.58+((thumbReach-.36)/1.0)*.42);

  const ratio=(a,b)=>dist(lm[a],lm[b])/palmWidth;
  const thumbIndex=ratio(4,8);
  const thumbMiddle=ratio(4,12);
  const indexMiddle=ratio(8,12);
  const middleRing=ratio(12,16);
  const ringPinky=ratio(16,20);
  const thumbIndexPip=ratio(4,6);
  const thumbMiddlePip=ratio(4,10);
  const thumbRingPip=ratio(4,14);
  const thumbIndexMcp=ratio(4,5);
  const thumbMiddleMcp=ratio(4,9);
  const thumbRingMcp=ratio(4,13);
  const thumbRing=ratio(4,16);
  const thumbPinky=ratio(4,20);

  const idx=screenDirection(lm,5,8);
  const mid=screenDirection(lm,9,12);
  const fingerDir={x:(idx.x+mid.x)/2,y:(idx.y+mid.y)/2};
  const horizontal=clamp(Math.abs(fingerDir.x)*1.14);
  const upward=clamp((-fingerDir.y-.05)/.75);
  const downward=clamp((fingerDir.y-.05)/.75);

  const ext=[index,middle,ring,pinky];
  const P=pattern=>avg(ext.map((v,i)=>pattern[i]?v:1-v));

  // Palm-relative thumb geometry. x runs index -> pinky, y wrist -> fingers.
  const tip=L[4];
  const thumbBase=L[2];
  const tdir=norm(sub(tip,thumbBase));
  const thumbAcross=clamp(Math.abs(tdir.x)*1.25);
  const thumbUp=clamp((tdir.y+.08)/.82);

  const xI=L[6].x, xM=L[10].x, xR=L[14].x, xP=L[18].x;
  const laneT=closeness(tip.x,midpoint(xI,xM),.18);
  const laneN=closeness(tip.x,midpoint(xM,xR),.18);
  const laneM=closeness(tip.x,midpoint(xR,xP),.20);
  const indexSide=inverseRamp(tip.x,xI-.10,xI+.10);
  const centerThumb=between(tip.x,xI-.02,xR+.02,.22);

  const pipAngles=[
    angle(lm[5],lm[6],lm[7]),
    angle(lm[9],lm[10],lm[11]),
    angle(lm[13],lm[14],lm[15]),
    angle(lm[17],lm[18],lm[19]),
  ];
  const dipAngles=[
    angle(lm[6],lm[7],lm[8]),
    angle(lm[10],lm[11],lm[12]),
    angle(lm[14],lm[15],lm[16]),
    angle(lm[18],lm[19],lm[20]),
  ];

  const indexHook=avg([
    between(index,.18,.68,.22),
    closeness(pipAngles[0],105,68),
    closeness(dipAngles[0],115,78),
    1-middle,1-ring,1-pinky
  ]);

  const tipSwap =
    Math.sign(L[8].x-L[12].x)!==Math.sign(L[5].x-L[9].x) ? 1 : 0;
  const segmentCross =
    segmentsCross2d(L[6],L[8],L[10],L[12]) ||
    segmentsCross2d(L[7],L[8],L[11],L[12]) ? 1 : 0;
  const crossIndexMiddle=Math.max(tipSwap,segmentCross);

  const thumbFingerDistances=[thumbIndex,thumbMiddle,thumbRing,thumbPinky];
  const tipThumbAvg=avg(thumbFingerDistances);
  const thumbFingerGather=inverseRamp(tipThumbAvg,.34,.95);
  const fingerTipGather=inverseRamp(
    avg([
      ratio(8,12),ratio(12,16),ratio(16,20),
      ratio(8,16),ratio(12,20)
    ]),
    .30,1.15
  );
  const tipPalmAvg=avg([8,12,16,20].map(i=>dist(L[i],{x:0,y:0,z:0})));
  // "Bent" is deliberately broad. E/X should not require one perfect joint angle.
  const bent=avg(ext.map(v=>inverseRamp(v,.34,.78)));
  const curve=avg(ext.map(v=>closeness(v,.34,.56)));

  const edge=Math.min(...lm.flatMap(p=>[p.x,p.y,1-p.x,1-p.y]));
  const visibility=clamp(edge/.045);

  return {
    lm,L,handed,
    thumb,index,middle,ring,pinky,ext,
    thumbIndex,thumbMiddle,indexMiddle,middleRing,ringPinky,
    thumbIndexPip,thumbMiddlePip,thumbRingPip,
    thumbIndexMcp,thumbMiddleMcp,thumbRingMcp,thumbRing,thumbPinky,
    thumbFingerGather,fingerTipGather,bent,
    horizontal,upward,downward,
    thumbAcross,thumbUp,laneT,laneN,laneM,indexSide,centerThumb,
    pipAngles,dipAngles,indexHook,crossIndexMiddle,
    tipThumbAvg,tipPalmAvg,curve,visibility,
    palmWidth,
    vector:L.flatMap(p=>[p.x,p.y,p.z]),
    pattern:P,
  };
}

function rawScore(letter,f){
  const P=f.pattern;
  const fist=P([0,0,0,0]);
  const two=P([1,1,0,0]);
  const one=P([1,0,0,0]);
  const three=P([1,1,1,0]);
  const four=P([1,1,1,1]);
  const pinkyOnly=P([0,0,0,1]);
  const spreadIM=ramp(f.indexMiddle,.22,.72);
  const togetherIM=inverseRamp(f.indexMiddle,.18,.52);
  const spreadMR=ramp(f.middleRing,.18,.60);
  const closeTI=closeness(f.thumbIndex,.20,.34);
  const closeTM=closeness(f.thumbMiddle,.26,.40);
  const thumbAtTwoBase=avg([
    inverseRamp(f.thumbIndexPip,.18,.72),
    inverseRamp(f.thumbMiddlePip,.18,.72),
    inverseRamp(avg([f.thumbIndexMcp,f.thumbMiddleMcp]),.24,.78)
  ]);
  const kCore=clamp(.58*two+.18*spreadIM+.24*thumbAtTwoBase);

  switch(letter){
    case 'A':
      return clamp(.50*fist+.32*f.indexSide+.18*f.thumbUp);
    case 'B':
      return clamp(.74*four+.16*avg([togetherIM,inverseRamp(f.middleRing,.18,.50),inverseRamp(f.ringPinky,.16,.48)])+.10*(1-f.thumb));
    case 'C':
      return clamp((.52*f.curve+.28*closeness(f.thumbIndex,.82,.62)+.20*ramp(f.tipThumbAvg,.42,.98))*(.86+.14*ramp(f.thumbIndex,.36,.86)));
    case 'D':
      return clamp(.68*one+.20*closeTM+.12*(1-f.thumb));
    case 'E':
      // E is a compact curled hand with fingertips gathered toward the thumb/palm,
      // not merely "a fist". Broad bend/gather terms tolerate normal finger lengths.
      return clamp((.34*fist+.24*f.bent+.24*f.thumbFingerGather+.10*f.fingerTipGather+.08*f.centerThumb)*
        (.82+.18*ramp(f.thumbIndex,.20,.55)));
    case 'F':
      return clamp(.62*P([0,1,1,1])+.28*closeTI+.10*f.thumb);
    case 'G':
      return clamp(.55*one+.22*f.thumb+.23*f.horizontal);
    case 'H':
      return clamp(.58*two+.23*togetherIM+.19*f.horizontal);
    case 'I':
      return clamp(.80*pinkyOnly+.20*(1-f.thumb));
    case 'J':
      return clamp(.80*pinkyOnly+.20*(1-f.thumb));
    case 'K':
      // K and V share the two extended fingers; the thumb near the two-finger base
      // is the defining K evidence. Upright/non-downward orientation breaks K/P.
      return clamp(.72*kCore+.18*thumbAtTwoBase+.10*(1-f.downward));
    case 'L':
      return clamp(.62*one+.28*f.thumb+.10*f.upward);
    case 'M':
      return clamp(.46*fist+.40*f.laneM+.14*f.thumbUp);
    case 'N':
      return clamp(.46*fist+.40*f.laneN+.14*f.thumbUp);
    case 'O':
      // O is fingertip/thumb convergence plus a rounded curl. This separates it
      // from E, where the fingers curl inward but do not form the same closed ring.
      return clamp(.30*f.curve+.30*closeTI+.18*closeTM+.14*f.thumbFingerGather+.08*f.fingerTipGather);
    case 'P':
      // P is the K core rotated downward; orientation must meaningfully beat K.
      return clamp(.58*kCore+.18*thumbAtTwoBase+.24*f.downward);
    case 'Q':
      return clamp(.52*one+.22*f.thumb+.26*f.downward);
    case 'R':
      // Crossing is decisive. Segment intersection catches perspective cases where
      // fingertip x-order alone does not flip cleanly.
      return clamp(.48*two+.18*togetherIM+.34*f.crossIndexMiddle);
    case 'S':
      return clamp(.50*fist+.28*f.thumbAcross+.22*f.centerThumb);
    case 'T':
      return clamp(.46*fist+.40*f.laneT+.14*f.thumbUp);
    case 'U':
      return clamp(.62*two+.28*togetherIM+.10*f.upward);
    case 'V':
      // A thumb sitting at the two-finger base is evidence for K, not V.
      return clamp((.62*two+.28*spreadIM+.10*f.upward)*(1-.18*thumbAtTwoBase));
    case 'W':
      return clamp(.68*three+.17*spreadIM+.15*spreadMR);
    case 'X':
      // X is a hooked index, not one exact joint angle.
      return clamp(.76*f.indexHook+.18*avg([1-f.middle,1-f.ring,1-f.pinky])+.06*(1-f.thumb));
    case 'Y':
      return clamp(.58*pinkyOnly+.34*f.thumb+.08*(1-f.index));
    case 'Z':
      return clamp(.72*one+.18*(1-f.thumb)+.10*f.upward);
    default:
      return 0;
  }
}

export const CONFUSIONS={
  A:['S','M','N','T','E'],
  B:['W','C'],
  C:['O','E'],
  D:['X','G','L','Z'],
  E:['A','S','M','N','T','O'],
  F:['O','D'],
  G:['L','Q','D'],
  H:['U','R'],
  I:['Y'],
  J:['I'],
  K:['V','P'],
  L:['G','Y','D'],
  M:['N','T','S','A','E'],
  N:['M','T','S','A','E'],
  O:['C','E','F'],
  P:['K'],
  Q:['G'],
  R:['U','V','H'],
  S:['A','M','N','T','E'],
  T:['A','S','M','N','E'],
  U:['V','R','H'],
  V:['U','W','K','R'],
  W:['V','B'],
  X:['D'],
  Y:['I','L'],
  Z:['D','G','Q'],
};

export function scoreAll(f){
  const scores={};
  for(const l of LETTERS) scores[l]=clamp(rawScore(l,f));
  return scores;
}

export function evaluateLetter(letter,f){
  const scores=scoreAll(f);
  const raw=scores[letter]||0;
  const rivals=CONFUSIONS[letter]||[];
  let competitor=null, competitorRaw=0;
  for(const r of rivals){
    if((scores[r]||0)>competitorRaw){competitor=r;competitorRaw=scores[r]||0}
  }
  const margin=raw-competitorRaw;
  const marginFactor=clamp((margin-.02)/.08);
  let combined=raw*(.86+.14*marginFactor);
  if(margin<=0) combined=Math.min(combined,.79);
  else if(margin<.025) combined=Math.min(combined,.81);

  return {
    letter,
    confidence:Math.round(clamp(combined)*100),
    raw:Math.round(raw*100),
    competitor,
    competitorScore:Math.round(competitorRaw*100),
    margin:Math.round(margin*100),
    scores,
  };
}

export function motionStartScore(letter,f){
  if(letter==='J') return rawScore('I',f);
  if(letter==='Z') return clamp(.78*f.pattern([1,0,0,0])+.22*(1-f.thumb));
  return rawScore(letter,f);
}

export function specificHint(letter, competitor){
  const pair=new Set([letter,competitor]);
  if(['A','S','M','N','T','E'].includes(letter)){
    if(letter==='T') return 'T: keep the thumb clearly between the index and middle fingers.';
    if(letter==='N') return 'N: thumb should emerge between the middle and ring fingers.';
    if(letter==='M') return 'M: thumb should emerge farther across, between the ring and pinky side.';
    if(letter==='A') return 'A: keep the thumb alongside the fist, not across the front.';
    if(letter==='S') return 'S: place the thumb across the front of the closed fingers.';
    if(letter==='E') return 'E: curl the fingertips toward the thumb/palm instead of making a compact fist.';
  }
  if(pair.has('U')&&pair.has('V')) return letter==='U'?'Bring index and middle together for U.':'Separate index and middle clearly for V.';
  if(pair.has('V')&&pair.has('W')) return letter==='W'?'Extend the ring finger too for W.':'Keep the ring finger curled for V.';
  if(pair.has('K')&&pair.has('P')) return letter==='P'?'Turn the K handshape downward for P.':'Keep the K handshape upright.';
  if(pair.has('G')&&pair.has('Q')) return letter==='Q'?'Turn the G-like handshape downward for Q.':'Keep the G handshape sideways.';
  if(pair.has('G')&&pair.has('L')) return letter==='G'?'Turn the index/thumb handshape sideways for G.':'Keep the index upright for L.';
  if(pair.has('H')&&pair.has('U')) return letter==='H'?'Turn the two-finger handshape sideways for H.':'Keep U upright.';
  if(pair.has('R')&&pair.has('U')) return letter==='R'?'Cross index and middle for R.':'Keep index and middle uncrossed for U.';
  if(letter==='X') return 'Hook the index finger at the middle and end joints; keep the other fingers curled.';
  if(letter==='Y') return 'Extend thumb and pinky while keeping the middle three fingers curled.';
  return competitor ? `Closest lookalike: ${competitor}. Make the defining finger/thumb position clearer.` : 'Keep the handshape steady and fully visible.';
}

export function frameStability(currentVector, previousVector){
  if(!currentVector||!previousVector||currentVector.length!==previousVector.length) return 1;
  let sum=0;
  for(let i=0;i<currentVector.length;i++){
    const d=currentVector[i]-previousVector[i];
    sum+=d*d;
  }
  const rms=Math.sqrt(sum/currentVector.length);
  return clamp(1-rms/.085);
}
