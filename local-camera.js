import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const TEMPLATE_KEY = 'aslingo.localAlphabetTemplates.v1';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CALIBRATABLE_LETTERS = new Set(['A','E','M','N','S','T']);
const DEFAULT_PASS_THRESHOLD = 80;
const DEFAULT_HOLD_MS = 800;

const video = document.getElementById('camera');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const introCard = document.getElementById('introCard');
const cameraCard = document.getElementById('cameraCard');
const resultsCard = document.getElementById('resultsCard');
const startCameraButton = document.getElementById('startCameraButton');
const backButton = document.getElementById('backButton');
const targetLetter = document.getElementById('targetLetter');
const scoreRing = document.getElementById('scoreRing');
const scoreValue = document.getElementById('scoreValue');
const scoreLabel = document.getElementById('scoreLabel');
const shapeScoreEl = document.getElementById('shapeScore');
const motionScoreEl = document.getElementById('motionScore');
const trackingScoreEl = document.getElementById('trackingScore');
const feedback = document.getElementById('feedback');
const cameraBadge = document.getElementById('cameraBadge');
const fpsBadge = document.getElementById('fpsBadge');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const teachButton = document.getElementById('teachButton');
const teachNote = document.getElementById('teachNote');
const teachLetter = document.getElementById('teachLetter');
const alphabetGrid = document.getElementById('alphabetGrid');
const restartButton = document.getElementById('restartButton');
const checkButton = document.getElementById('checkButton');
const thresholdSelect = document.getElementById('thresholdSelect');
const holdSelect = document.getElementById('holdSelect');
const holdProgressEl = document.getElementById('holdProgress');
const checkerStatus = document.getElementById('checkerStatus');

let handLandmarker = null;
let cameraStream = null;
let animationId = 0;
let currentIndex = 0;
let latestObservation = null;
let lastVideoTime = -1;
let lastFrameAt = performance.now();
let fpsSmooth = 0;
let motionFrames = [];
let teaching = null;
let results = {};
let templates = loadTemplates();
let checkingActive = false;
let holdStartedAt = null;
let holdPeak = 0;
let cooldownUntil = 0;

const clamp = (v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const dist2 = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const avg = xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;

function loadTemplates(){
  try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveTemplates(){
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
}

function angle(a,b,c){
  const ab=[a.x-b.x,a.y-b.y,a.z-b.z];
  const cb=[c.x-b.x,c.y-b.y,c.z-b.z];
  const dot=ab[0]*cb[0]+ab[1]*cb[1]+ab[2]*cb[2];
  const ma=Math.hypot(...ab), mc=Math.hypot(...cb);
  if(!ma||!mc) return 0;
  return Math.acos(clamp(dot/(ma*mc),-1,1))*180/Math.PI;
}

function extensionScore(lm, mcp,pip,dip,tip){
  const pipAngle=angle(lm[mcp],lm[pip],lm[dip]);
  const dipAngle=angle(lm[pip],lm[dip],lm[tip]);
  const straight=clamp(((pipAngle-80)/90)*.68 + ((dipAngle-80)/90)*.32);
  const reach=clamp((dist(lm[tip],lm[0])/(dist(lm[pip],lm[0])+1e-6)-.93)/.35);
  return clamp(straight*.72+reach*.28);
}

function normalizeLandmarks(lm, handed='Right'){
  const wrist=lm[0];
  const scale=Math.max(dist(lm[0],lm[9]), dist(lm[5],lm[17]), .05);
  const mirror = handed === 'Left' ? -1 : 1;
  return lm.map(p=>({
    x:(p.x-wrist.x)/scale*mirror,
    y:(p.y-wrist.y)/scale,
    z:(p.z-wrist.z)/scale,
  }));
}

function featureVector(lm, handed){
  const n=normalizeLandmarks(lm, handed);
  return n.flatMap(p=>[p.x,p.y,p.z]);
}

function templateSimilarity(letter, vector){
  const samples=templates[letter]||[];
  if(!samples.length) return null;
  let best=0;
  for(const sample of samples){
    if(!Array.isArray(sample)||sample.length!==vector.length) continue;
    let sum=0;
    for(let i=0;i<vector.length;i++){
      const d=vector[i]-sample[i];
      sum+=d*d;
    }
    const rmse=Math.sqrt(sum/vector.length);
    const score=Math.exp(-rmse*5.0);
    best=Math.max(best,score);
  }
  return clamp(best);
}

function handFeatures(lm, handed){
  const index=extensionScore(lm,5,6,7,8);
  const middle=extensionScore(lm,9,10,11,12);
  const ring=extensionScore(lm,13,14,15,16);
  const pinky=extensionScore(lm,17,18,19,20);

  const thumbAngle=angle(lm[1],lm[2],lm[4]);
  const thumbReach=dist(lm[4],lm[5])/(dist(lm[5],lm[17])+1e-6);
  const thumb=clamp(((thumbAngle-55)/95)*.55 + ((thumbReach-.45)/.9)*.45);

  const palm=dist(lm[5],lm[17])+1e-6;
  const thumbIndex=dist(lm[4],lm[8])/palm;
  const thumbMiddle=dist(lm[4],lm[12])/palm;
  const indexMiddle=dist(lm[8],lm[12])/palm;
  const middleRing=dist(lm[12],lm[16])/palm;
  const ringPinky=dist(lm[16],lm[20])/palm;
  const tipPalmAvg=avg([8,12,16,20].map(i=>dist(lm[i],lm[0])/palm));

  const fingerDir={
    x:lm[8].x-lm[5].x,
    y:lm[8].y-lm[5].y,
  };
  const fingerAngle=Math.atan2(fingerDir.y,fingerDir.x)*180/Math.PI;
  const horizontal=clamp(1-Math.abs(Math.sin(fingerAngle*Math.PI/180)));
  const downward=clamp((fingerDir.y+.02)/.28);
  const upward=clamp((-fingerDir.y+.02)/.28);

  const crossIndexMiddle =
    Math.sign(lm[8].x-lm[12].x) !== Math.sign(lm[5].x-lm[9].x) ? 1 : 0;

  return {
    ext:[thumb,index,middle,ring,pinky],
    thumb,index,middle,ring,pinky,
    thumbIndex,thumbMiddle,indexMiddle,middleRing,ringPinky,tipPalmAvg,
    horizontal,downward,upward,crossIndexMiddle,
    vector:featureVector(lm, handed),
  };
}

function closeness(value,target,tolerance){
  return clamp(1-Math.abs(value-target)/tolerance);
}
function state(value,want){
  return want ? value : 1-value;
}
function fingerPattern(f, pattern){
  const vals=[f.index,f.middle,f.ring,f.pinky];
  return avg(vals.map((v,i)=>state(v,pattern[i])));
}

function motionStats(letter){
  const now=performance.now();
  const frames=motionFrames.filter(f=>now-f.t<1800);
  if(frames.length<8) return {score:0,path:0,structure:0};

  const idx=letter==='J'?20:8;
  const raw=frames.map(f=>f.lm[idx]);

  // Smooth the fingertip trace to ignore camera jitter.
  const pts=raw.map((p,i)=>{
    const lo=Math.max(0,i-2), hi=Math.min(raw.length,i+3);
    const slice=raw.slice(lo,hi);
    return {
      x:avg(slice.map(v=>v.x)),
      y:avg(slice.map(v=>v.y)),
    };
  });

  let path=0;
  for(let i=1;i<pts.length;i++) path+=dist2(pts[i],pts[i-1]);

  const pointAt = ratio => pts[Math.min(pts.length-1,Math.max(0,Math.round((pts.length-1)*ratio)))];
  const vec=(a,b)=>({x:b.x-a.x,y:b.y-a.y});
  const mag=v=>Math.hypot(v.x,v.y);
  const cosine=(a,b)=>{
    const den=mag(a)*mag(b);
    return den?clamp((a.x*b.x+a.y*b.y)/den,-1,1):1;
  };

  if(letter==='J'){
    // A real J should look like a stem followed by a hook/turn. Merely waving
    // the hand now scores poorly.
    const p0=pointAt(.08), p1=pointAt(.58), p2=pointAt(.92);
    const stem=vec(p0,p1), hook=vec(p1,p2);
    const stemVertical=clamp((Math.abs(stem.y)-Math.abs(stem.x)*.75)/.12 + .5);
    const hookLateral=clamp((Math.abs(hook.x)-.025)/.13);
    const turn=clamp((.82-cosine(stem,hook))/.95);
    const enoughPath=clamp((path-.08)/.28);
    const structure=clamp(stemVertical*.34+hookLateral*.27+turn*.29+enoughPath*.10);
    return {score:structure,path,structure};
  }

  // Z should have three strokes: horizontal-ish, diagonal back across, then
  // horizontal-ish again. Mirroring is accepted, but random motion is not.
  const p0=pointAt(.05), p1=pointAt(.32), p2=pointAt(.68), p3=pointAt(.95);
  const a=vec(p0,p1), b=vec(p1,p2), c=vec(p2,p3);
  const horiz=v=>clamp((Math.abs(v.x)-Math.abs(v.y)*.65)/.13 + .45);
  const diagonal=clamp((Math.min(Math.abs(b.x),Math.abs(b.y))-.025)/.13);
  const sameOuterDir = Math.sign(a.x)===Math.sign(c.x) ? 1 : 0;
  const middleBack = Math.sign(a.x)!==Math.sign(b.x) ? 1 : 0;
  const enoughPath=clamp((path-.10)/.34);
  const structure=clamp(
    horiz(a)*.22 + horiz(c)*.22 + diagonal*.24 +
    sameOuterDir*.12 + middleBack*.12 + enoughPath*.08
  );
  return {score:structure,path,structure};
}

function ruleScore(letter,f){
  const P=(p)=>fingerPattern(f,p);
  const closeTI=closeness(f.thumbIndex,.18,.22);
  const closeTM=closeness(f.thumbMiddle,.20,.26);
  const spreadIM=clamp((f.indexMiddle-.20)/.52);
  const togetherIM=1-spreadIM;
  const fist=P([0,0,0,0]);

  switch(letter){
    case 'A': return .68*fist+.32*f.thumb;
    case 'B': return .75*P([1,1,1,1])+.25*(1-f.thumb);
    case 'C': return .45*avg([closeness(f.index,.45,.5),closeness(f.middle,.45,.5),closeness(f.ring,.45,.5),closeness(f.pinky,.45,.5)])+.35*closeness(f.thumbIndex,.75,.65)+.20*f.thumb;
    case 'D': return .62*P([1,0,0,0])+.23*closeTM+.15*(1-f.thumb);
    case 'E': return .58*fist+.27*closeness(f.tipPalmAvg,1.05,.75)+.15*(1-f.thumb);
    case 'F': return .58*P([0,1,1,1])+.30*closeTI+.12*f.thumb;
    case 'G': return .48*P([1,0,0,0])+.27*f.thumb+.25*f.horizontal;
    case 'H': return .52*P([1,1,0,0])+.25*togetherIM+.23*f.horizontal;
    case 'I': return .78*P([0,0,0,1])+.22*(1-f.thumb);
    case 'J': { const m=motionStats('J'); return .55*P([0,0,0,1])+.45*m.score; }
    case 'K': return .54*P([1,1,0,0])+.25*spreadIM+.21*f.thumb;
    case 'L': return .66*P([1,0,0,0])+.34*f.thumb;
    case 'M': return .76*fist+.24*closeness(f.thumbMiddle,.48,.4);
    case 'N': return .78*fist+.22*closeness(f.thumbMiddle,.34,.34);
    case 'O': return .54*fist+.34*closeTI+.12*closeTM;
    case 'P': return .48*P([1,1,0,0])+.24*spreadIM+.28*f.downward;
    case 'Q': return .48*P([1,0,0,0])+.26*f.thumb+.26*f.downward;
    case 'R': return .52*P([1,1,0,0])+.28*togetherIM+.20*f.crossIndexMiddle;
    case 'S': return .80*fist+.20*f.thumb;
    case 'T': return .78*fist+.22*closeTI;
    case 'U': return .68*P([1,1,0,0])+.32*togetherIM;
    case 'V': return .66*P([1,1,0,0])+.34*spreadIM;
    case 'W': return .76*P([1,1,1,0])+.24*avg([spreadIM,clamp((f.middleRing-.15)/.4)]);
    case 'X': return .52*closeness(f.index,.38,.38)+.38*P([0,0,0,0])+.10*(1-f.thumb);
    case 'Y': return .72*P([0,0,0,1])+.28*f.thumb;
    case 'Z': { const m=motionStats('Z'); return .55*P([1,0,0,0])+.45*m.score; }
    default:return 0;
  }
}

function evaluate(letter, f){
  const rule=clamp(ruleScore(letter,f));
  const personal=templateSimilarity(letter,f.vector);

  // Calibration can make a small correction for hand proportions, but it cannot
  // rescue a weak generic handshape score on its own.
  const personalAdjusted = personal == null
    ? rule
    : clamp(rule*.84 + personal*.16);

  const motion = (letter==='J'||letter==='Z') ? motionStats(letter).score : 1;
  const shape = personalAdjusted;

  // J/Z are motion-gated. If the path is wrong, confidence cannot pass even if
  // the static starting handshape looks right.
  const confidence = (letter==='J'||letter==='Z')
    ? clamp(shape*.58 + motion*.42) * (motion < .52 ? .72 : 1)
    : shape;

  return {
    confidence:Math.round(clamp(confidence)*100),
    shape:Math.round(shape*100),
    motion:Math.round(motion*100),
    personal:personal==null?null:Math.round(personal*100),
  };
}

function feedbackFor(letter,e){
  if(e.confidence>=85) return ['good', `Strong match for ${letter}. Hold it steady to advance.`];
  if(e.confidence>=75) return ['warn', `Close. Keep ${letter} steady and let the confidence settle.`];
  if((letter==='J'||letter==='Z') && e.motion<52) {
    return ['', `${letter} needs the expected path shape. Random movement will not count.`];
  }
  if(CALIBRATABLE_LETTERS.has(letter)) {
    return ['', `${letter} is a subtle handshape. If the generic check consistently misses a correct sign, you can calibrate your hand once.`];
  }
  return ['', `Not confident yet. Check finger extension, thumb placement, and palm orientation.`];
}


function resetHold(message=null){
  holdStartedAt=null;
  holdPeak=0;
  holdProgressEl.style.width='0%';
  if(message){
    checkerStatus.className='checker-status wait';
    checkerStatus.textContent=message;
  }
}

function autoCheck(letter,e){
  if(!checkingActive || teaching || performance.now()<cooldownUntil) return;

  const threshold=Number(thresholdSelect.value||DEFAULT_PASS_THRESHOLD);
  const holdMs=Number(holdSelect.value||DEFAULT_HOLD_MS);
  const trackingOk=(latestObservation?.tracking||0)>=60;
  const motionOk=!['J','Z'].includes(letter) || e.motion>=55;
  const passing=e.confidence>=threshold && trackingOk && motionOk;

  if(!passing){
    resetHold(
      !trackingOk
        ? 'Keep your full signing hand visible.'
        : ['J','Z'].includes(letter) && !motionOk
          ? `${letter}: waiting for the correct motion path…`
          : `Get ${letter} to ${threshold}% and keep it there.`
    );
    return;
  }

  const now=performance.now();
  if(holdStartedAt==null) holdStartedAt=now;
  holdPeak=Math.max(holdPeak,e.confidence);
  const elapsed=now-holdStartedAt;
  const progress=clamp(elapsed/holdMs);
  holdProgressEl.style.width=`${Math.round(progress*100)}%`;
  checkerStatus.className='checker-status pass';
  checkerStatus.textContent=`Got ${letter} — hold ${Math.max(0,(holdMs-elapsed)/1000).toFixed(1)}s`;

  if(progress<1) return;

  results[letter]={
    ...e,
    confidence:Math.max(e.confidence,holdPeak),
    autoPassed:true,
    threshold,
    holdMs,
  };

  holdStartedAt=null;
  holdPeak=0;
  holdProgressEl.style.width='100%';
  checkerStatus.textContent=`✓ ${letter} accepted`;

  if(currentIndex===LETTERS.length-1){
    checkingActive=false;
    checkButton.textContent='Start checking';
    setTimeout(showResults,450);
    return;
  }

  currentIndex++;
  motionFrames=[];
  latestObservation=null;
  cooldownUntil=performance.now()+420;
  renderGrid();
  targetLetter.textContent=LETTERS[currentIndex];
  setTimeout(()=>{
    holdProgressEl.style.width='0%';
    checkerStatus.className='checker-status';
    checkerStatus.textContent=`Now sign ${LETTERS[currentIndex]}.`;
  },380);
}

function toggleChecking(){
  checkingActive=!checkingActive;
  holdStartedAt=null;
  holdPeak=0;
  holdProgressEl.style.width='0%';
  checkButton.textContent=checkingActive?'Pause checking':'Start checking';
  checkerStatus.className=`checker-status ${checkingActive?'pass':'paused'}`;
  checkerStatus.textContent=checkingActive
    ? `Checking started. Sign ${LETTERS[currentIndex]}.`
    : 'Checking paused. Your place is saved.';
}

function drawHand(lm){
  const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  if(!lm) return;
  const conns=HandLandmarker.HAND_CONNECTIONS || [];
  ctx.lineWidth=Math.max(2,w/260);
  ctx.strokeStyle='rgba(88,181,255,.92)';
  for(const c of conns){
    const a=lm[c.start],b=lm[c.end];
    if(!a||!b) continue;
    ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke();
  }
  ctx.fillStyle='rgba(255,255,255,.96)';
  for(const p of lm){
    ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/180),0,Math.PI*2);ctx.fill();
  }
}

function updateUI(){
  const letter=LETTERS[currentIndex];
  targetLetter.textContent=letter;
  teachLetter.textContent=letter;
  teachButton.classList.toggle('hidden', !CALIBRATABLE_LETTERS.has(letter));
  teachNote.classList.add('hidden');
  prevButton.disabled=currentIndex===0;
  nextButton.textContent=currentIndex===LETTERS.length-1?'Finish A–Z':'Next →';
  renderGrid();

  if(!latestObservation){
    scoreRing.style.setProperty('--score',0);
    scoreValue.textContent='—';
    scoreLabel.textContent='Show your hand';
    shapeScoreEl.textContent='—';
    motionScoreEl.textContent='—';
    trackingScoreEl.textContent='—';
    return;
  }
  const e=evaluate(letter, latestObservation.features);
  scoreRing.style.setProperty('--score',e.confidence);
  scoreValue.textContent=`${e.confidence}%`;
  scoreLabel.textContent=e.confidence>=82?'Strong match':e.confidence>=64?'Possible match':'Keep adjusting';
  shapeScoreEl.textContent=`${e.shape}%`;
  motionScoreEl.textContent=(letter==='J'||letter==='Z')?`${e.motion}%`:'N/A';
  trackingScoreEl.textContent=`${latestObservation.tracking}%`;
  const [klass,text]=feedbackFor(letter,e);
  feedback.className=`feedback ${klass}`;
  feedback.textContent=text;
  autoCheck(letter,e);
}

function renderGrid(){
  alphabetGrid.innerHTML='';
  LETTERS.forEach((letter,i)=>{
    const b=document.createElement('button');
    b.className='letter-chip';
    if(i===currentIndex)b.classList.add('active');
    const r=results[letter];
    if(r)b.classList.add(r.confidence>=70?'done':'low');
    b.textContent=letter;
    b.onclick=()=>{captureCurrent();currentIndex=i;motionFrames=[];updateUI();};
    alphabetGrid.appendChild(b);
  });
}

function captureCurrent(){
  const letter=LETTERS[currentIndex];
  if(!latestObservation) return;
  results[letter]=evaluate(letter,latestObservation.features);
}

function next(){
  captureCurrent();
  resetHold();
  if(currentIndex===LETTERS.length-1){showResults();return;}
  currentIndex++;
  motionFrames=[];
  latestObservation=null;
  cooldownUntil=performance.now()+350;
  updateUI();
}
function previous(){
  captureCurrent();
  resetHold();
  currentIndex=Math.max(0,currentIndex-1);
  motionFrames=[];
  latestObservation=null;
  cooldownUntil=performance.now()+350;
  updateUI();
}

async function createLandmarker(){
  cameraBadge.textContent='Loading hand model…';
  const vision=await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
  );
  const options={
    baseOptions:{modelAssetPath:MODEL_URL,delegate:'GPU'},
    runningMode:'VIDEO',
    numHands:1,
    minHandDetectionConfidence:.55,
    minHandPresenceConfidence:.55,
    minTrackingConfidence:.5,
  };
  try{
    handLandmarker=await HandLandmarker.createFromOptions(vision,options);
  }catch{
    options.baseOptions={modelAssetPath:MODEL_URL,delegate:'CPU'};
    handLandmarker=await HandLandmarker.createFromOptions(vision,options);
  }
  cameraBadge.textContent='On-device hand tracking';
}

async function startCamera(){
  startCameraButton.disabled=true;
  startCameraButton.textContent='Starting…';
  try{
    if(!handLandmarker) await createLandmarker();
    cameraStream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        facingMode:'user',
        width:{ideal:960},
        height:{ideal:720},
        frameRate:{ideal:30,max:60}
      }
    });
    video.srcObject=cameraStream;
    await video.play();
    introCard.classList.add('hidden');
    cameraCard.classList.remove('hidden');
    resultsCard.classList.add('hidden');
    resizeCanvas();
    renderLoop();
  }catch(err){
    console.error(err);
    startCameraButton.disabled=false;
    startCameraButton.textContent='Turn on camera';
    alert(`Camera beta could not start: ${err?.message||err}`);
  }
}

function resizeCanvas(){
  const rect=video.getBoundingClientRect();
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(rect.width*dpr));
  canvas.height=Math.max(1,Math.round(rect.height*dpr));
}

function renderLoop(){
  if(!cameraStream||!handLandmarker)return;
  const now=performance.now();
  const dt=now-lastFrameAt;
  lastFrameAt=now;
  if(dt>0)fpsSmooth=fpsSmooth*.9+(1000/dt)*.1;
  fpsBadge.textContent=`${Math.round(fpsSmooth)} fps`;

  if(video.readyState>=2 && video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime;
    let detected;
    try{
      detected=handLandmarker.detectForVideo(video,now);
    }catch(err){
      console.warn('HandLandmarker frame failed',err);
    }
    const lm=detected?.landmarks?.[0];
    const handed=detected?.handedness?.[0]?.[0]?.categoryName || 'Right';
    const tracking=Math.round((detected?.handedness?.[0]?.[0]?.score||0)*100);

    if(lm){
      const features=handFeatures(lm,handed);
      latestObservation={lm,handed,tracking,features,t:now};
      motionFrames.push({t:now,lm:normalizeLandmarks(lm,handed)});
      motionFrames=motionFrames.filter(f=>now-f.t<1800);
      drawHand(lm);

      if(teaching){
        teaching.samples.push(features.vector);
        const elapsed=now-teaching.started;
        const progress=clamp(elapsed/1100);
        cameraBadge.textContent=`Learning ${teaching.letter}… ${Math.round(progress*100)}%`;
        if(elapsed>=1100){
          const samples=teaching.samples;
          const length=samples[0]?.length||0;
          const mean=Array.from({length},(_,i)=>avg(samples.map(s=>s[i])));
          // Keep one recent calibration per subtle letter. Repeated calibration
          // cannot stack its way into an artificial high-confidence score.
          templates[teaching.letter]=[mean];
          saveTemplates();
          cameraBadge.textContent=`Saved ${teaching.letter} template locally`;
          teaching=null;
          teachNote.classList.add('hidden');
          setTimeout(()=>{if(!teaching)cameraBadge.textContent='On-device hand tracking';},1400);
        }
      }
    }else{
      latestObservation=null;
      motionFrames=[];
      drawHand(null);
      if(!teaching)cameraBadge.textContent='Show your signing hand';
    }
    updateUI();
  }
  animationId=requestAnimationFrame(renderLoop);
}

function teachCurrent(){
  const letter=LETTERS[currentIndex];
  if(!CALIBRATABLE_LETTERS.has(letter)) return;
  if(!latestObservation){
    feedback.className='feedback warn';
    feedback.textContent='Show your hand clearly first, then tap Teach this letter.';
    return;
  }
  checkingActive=false;
  checkButton.textContent='Start checking';
  resetHold();
  teaching={letter,started:performance.now(),samples:[]};
  teachNote.classList.remove('hidden');
  cameraBadge.textContent=`Learning ${letter}…`;
}

function showResults(){
  captureCurrent();
  cameraCard.classList.add('hidden');
  resultsCard.classList.remove('hidden');
  const vals=LETTERS.map(l=>results[l]?.confidence ?? 0);
  const attempted=LETTERS.filter(l=>results[l]).length;
  const average=attempted?Math.round(
    LETTERS.filter(l=>results[l]).map(l=>results[l].confidence).reduce((a,b)=>a+b,0)/attempted
  ):0;
  const strong=LETTERS.filter(l=>results[l]?.autoPassed).length;
  const templateCount=Object.keys(templates).filter(letter=>templates[letter]?.length).length;
  document.getElementById('resultAverage').textContent=`${average}%`;
  document.getElementById('resultStrong').textContent=`${strong}/${attempted || LETTERS.length}`;
  document.getElementById('resultTemplates').textContent=templateCount;
  const rows=document.getElementById('resultRows');
  rows.innerHTML='';
  LETTERS.forEach(letter=>{
    const r=results[letter]||{confidence:0};
    const row=document.createElement('div');
    row.className='result-row';
    row.innerHTML=`<div class="result-letter">${letter}</div>
      <div><b>${r.confidence||0}% confidence</b>
      <div class="result-bar"><span style="width:${r.confidence||0}%"></span></div></div>
      <small>${r.personal!=null?'personalized':'rule check'}</small>`;
    rows.appendChild(row);
  });
}

function restart(){
  results={};
  currentIndex=0;
  motionFrames=[];
  latestObservation=null;
  checkingActive=false;
  holdStartedAt=null;
  holdPeak=0;
  holdProgressEl.style.width='0%';
  checkButton.textContent='Start checking';
  checkerStatus.className='checker-status';
  checkerStatus.innerHTML='Camera is ready. Tap <b>Start checking</b> when you want ASLingo to begin A–Z.';
  resultsCard.classList.add('hidden');
  cameraCard.classList.remove('hidden');
  updateUI();
}

function stopCamera(){
  cancelAnimationFrame(animationId);
  cameraStream?.getTracks()?.forEach(t=>t.stop());
  cameraStream=null;
}

startCameraButton.addEventListener('click',startCamera);
checkButton.addEventListener('click',toggleChecking);
prevButton.addEventListener('click',previous);
nextButton.addEventListener('click',next);
teachButton.addEventListener('click',teachCurrent);
restartButton.addEventListener('click',restart);
backButton.addEventListener('click',()=>{stopCamera();location.href='/';});
window.addEventListener('resize',resizeCanvas);
window.addEventListener('pagehide',stopCamera);

renderGrid();
updateUI();
