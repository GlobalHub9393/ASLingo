import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  LETTERS, clamp, avg, dist, makeFeatures, evaluateLetter,
  motionStartScore, specificHint, frameStability
} from './hand-classifier.js';

const MODEL_URL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const DEFAULT_PASS_THRESHOLD=82;
const DEFAULT_HOLD_MS=650;
const FAST_PASS_MS=150;
const FAST_PASS_CONFIDENCE=95;
const FAST_MARGIN=10;
const FAILURE_GRACE_MS=130;
const TRACE_TOLERANCE=.115;
const TRACE_START_HOLD_MS=160;
const TRACE_TIMEOUT_MS=5200;
const TRACE_DROPOUT_MS=220;

const $=id=>document.getElementById(id);
const video=$('camera'),canvas=$('overlay'),ctx=canvas.getContext('2d');
const introCard=$('introCard'),cameraCard=$('cameraCard'),resultsCard=$('resultsCard');
const startCameraButton=$('startCameraButton'),backButton=$('backButton');
const targetLetter=$('targetLetter'),scoreRing=$('scoreRing'),scoreValue=$('scoreValue'),scoreLabel=$('scoreLabel');
const shapeScoreEl=$('shapeScore'),motionScoreEl=$('motionScore'),trackingScoreEl=$('trackingScore');
const feedback=$('feedback'),cameraBadge=$('cameraBadge'),fpsBadge=$('fpsBadge');
const prevButton=$('prevButton'),nextButton=$('nextButton'),alphabetGrid=$('alphabetGrid');
const restartButton=$('restartButton'),checkButton=$('checkButton');
const thresholdSelect=$('thresholdSelect'),holdSelect=$('holdSelect');
const holdProgressEl=$('holdProgress'),checkerStatus=$('checkerStatus'),motionHelp=$('motionHelp');
$('teachButton')?.classList.add('hidden');
$('teachNote')?.classList.add('hidden');

let handLandmarker=null,cameraStream=null,animationId=0,currentIndex=0,lastVideoTime=-1;
let latestObservation=null,prevVector=null,lastFrameAt=performance.now(),fpsSmooth=0;
let results={},checkingActive=false,cooldownUntil=0;
let holdStartedAt=null,holdPeak=0,failSince=null,confidenceHistory=[];
let traceState=null,traceStartHoldAt=null,tipFilter=null,lastHandSeen=0;

const motionLetter=l=>l==='J'||l==='Z';
const traceGuide=letter=>letter==='J'
  ? {finger:20,prev:19,prev2:18,label:'Use your pinky. Start in the green circle with an I handshape, then trace the J.',points:[{x:.26,y:.27},{x:.26,y:.43},{x:.27,y:.58},{x:.31,y:.68},{x:.39,y:.71}]}
  : {finger:8,prev:7,prev2:6,label:'Use your index fingertip. Start in the green circle, then trace the Z.',points:[{x:.40,y:.29},{x:.28,y:.29},{x:.16,y:.29},{x:.28,y:.46},{x:.40,y:.64},{x:.28,y:.64},{x:.16,y:.64}]};

function traceDistance(a,b){return Math.hypot(a.x-b.x,(a.y-b.y)*.78)}
function resetTrace(){traceState=null;traceStartHoldAt=null;tipFilter=null}
function traceProgress(letter){if(!traceState||traceState.letter!==letter)return 0;return clamp(traceState.nextIndex/(traceGuide(letter).points.length-1))}

function virtualTip(letter,lm){
  const g=traceGuide(letter),raw=lm[g.finger],dip=lm[g.prev],pip=lm[g.prev2];
  if(!raw||!dip||!pip)return tipFilter;
  const vx=dip.x-pip.x,vy=dip.y-pip.y,vm=Math.hypot(vx,vy)||1;
  const seg=Math.max(Math.hypot(raw.x-dip.x,raw.y-dip.y),.025);
  const predicted={x:dip.x+vx/vm*seg,y:dip.y+vy/vm*seg,z:raw.z||0};
  const candidate={x:raw.x*.78+predicted.x*.22,y:raw.y*.78+predicted.y*.22,z:raw.z||0};
  if(!tipFilter){tipFilter=candidate;return tipFilter}
  const jump=Math.hypot(candidate.x-tipFilter.x,candidate.y-tipFilter.y);
  const alpha=jump>.15?.22:.48;
  tipFilter={x:tipFilter.x*(1-alpha)+candidate.x*alpha,y:tipFilter.y*(1-alpha)+candidate.y*alpha,z:candidate.z};
  return tipFilter;
}

function drawTraceGuide(letter){
  if(!motionLetter(letter))return;
  const g=traceGuide(letter),w=canvas.width,h=canvas.height,pts=g.points.map(p=>({x:p.x*w,y:p.y*h}));
  const n=traceState?.letter===letter?traceState.nextIndex:0;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Math.max(7,w/90);
  ctx.strokeStyle='rgba(92,151,244,.30)';ctx.setLineDash([10,10]);ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();ctx.setLineDash([]);
  pts.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,i===n?Math.max(12,w/42):Math.max(8,w/58),0,Math.PI*2);
    ctx.fillStyle=i===0&&!traceState?'rgba(38,176,103,.85)':i<n?'rgba(38,176,103,.68)':i===n?'rgba(45,118,233,.82)':'rgba(255,255,255,.5)';ctx.fill()});
  if(tipFilter){ctx.beginPath();ctx.arc(tipFilter.x*w,tipFilter.y*h,Math.max(7,w/70),0,Math.PI*2);ctx.fillStyle='rgba(255,221,71,.92)';ctx.fill()}
  ctx.restore();
}

function drawHand(lm){
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);drawTraceGuide(LETTERS[currentIndex]);if(!lm)return;
  ctx.lineWidth=Math.max(2,w/260);ctx.strokeStyle='rgba(88,181,255,.92)';
  for(const c of HandLandmarker.HAND_CONNECTIONS||[]){const a=lm[c.start],b=lm[c.end];if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke()}
  ctx.fillStyle='rgba(255,255,255,.96)';for(const p of lm){ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/180),0,Math.PI*2);ctx.fill()}
}

function rollingAverage(ms=180){
  const now=performance.now();confidenceHistory=confidenceHistory.filter(x=>now-x.t<700);
  const xs=confidenceHistory.filter(x=>now-x.t<=ms);
  return xs.length?avg(xs.map(x=>x.c)):0;
}

function resetHold(message=null){
  holdStartedAt=null;holdPeak=0;failSince=null;holdProgressEl.style.width='0%';
  if(message){checkerStatus.className='checker-status wait';checkerStatus.textContent=message}
}

function acceptStatic(letter,e,holdMs){
  results[letter]={...e,confidence:Math.max(e.confidence,holdPeak),autoPassed:true,holdMs};
  resetHold();holdProgressEl.style.width='100%';checkerStatus.className='checker-status pass';checkerStatus.textContent=`✓ ${letter} accepted`;
  advanceAfterPass();
}

function advanceAfterPass(){
  if(currentIndex===LETTERS.length-1){checkingActive=false;checkButton.textContent='Start checking';setTimeout(showResults,420);return}
  currentIndex++;latestObservation=null;prevVector=null;confidenceHistory=[];resetTrace();cooldownUntil=performance.now()+320;
  renderGrid();targetLetter.textContent=LETTERS[currentIndex];
  setTimeout(()=>{holdProgressEl.style.width='0%';checkerStatus.className='checker-status';checkerStatus.textContent=`Now sign ${LETTERS[currentIndex]}.`;updateUI()},280);
}

function autoCheck(letter,e){
  if(!checkingActive||performance.now()<cooldownUntil)return;
  if(motionLetter(letter)){updateTrace(letter);return}
  motionHelp.classList.add('hidden');resetTrace();

  const threshold=Math.max(80,Number(thresholdSelect.value||DEFAULT_PASS_THRESHOLD));
  const selectedHold=Number(holdSelect.value||DEFAULT_HOLD_MS);
  const stable=(latestObservation?.stability||0)>=.55;
  const tracked=(latestObservation?.tracking||0)>=55;
  const rolling=rollingAverage(180);
  const candidate=Math.max(e.confidence,rolling);
  const marginOk=e.margin>=5;
  const fast=e.confidence>=FAST_PASS_CONFIDENCE&&e.margin>=FAST_MARGIN&&(latestObservation?.stability||0)>=.68;
  const requiredHold=fast?FAST_PASS_MS:e.confidence>=90?Math.min(selectedHold,320):selectedHold;
  const passing=tracked&&stable&&marginOk&&candidate>=threshold;

  if(!passing){
    if(failSince==null)failSince=performance.now();
    if(performance.now()-failSince>FAILURE_GRACE_MS){
      let msg=!tracked?'Keep the full hand visible.'
        :!stable?'Hold the handshape for a moment — ASLingo is waiting for the transition to finish.'
        :e.margin<5?`${letter} is too close to ${e.competitor||'a lookalike'}. ${specificHint(letter,e.competitor)}`
        :`Match confidence ${candidate}% — aim for ${threshold}% or better.`;
      resetHold(msg);
    }
    return;
  }
  failSince=null;
  const now=performance.now();if(holdStartedAt==null)holdStartedAt=now;holdPeak=Math.max(holdPeak,e.confidence);
  const elapsed=now-holdStartedAt,progress=clamp(elapsed/requiredHold);holdProgressEl.style.width=`${Math.round(progress*100)}%`;
  checkerStatus.className='checker-status pass';
  checkerStatus.textContent=fast?`Excellent ${letter} — quick check…`:`Got ${letter} — hold ${Math.max(0,(requiredHold-elapsed)/1000).toFixed(1)}s`;
  if(progress>=1)acceptStatic(letter,e,requiredHold);
}

function updateTrace(letter){
  if(!checkingActive)return;
  const now=performance.now(),g=traceGuide(letter);
  if(!latestObservation){
    if(traceState&&now-lastHandSeen>TRACE_DROPOUT_MS){resetTrace();checkerStatus.textContent='Hand lost — return to the green start circle.'}
    return;
  }
  const tip=virtualTip(letter,latestObservation.lm);if(!tip)return;
  const startShape=motionStartScore(letter,latestObservation.features);
  motionHelp.classList.remove('hidden');motionHelp.innerHTML=`<b>${letter} trace</b> · ${g.label} Close is enough; order matters more than exact dots.`;

  if(!traceState||traceState.letter!==letter){
    const inStart=traceDistance(tip,g.points[0])<=TRACE_TOLERANCE;
    if(startShape<.66){traceStartHoldAt=null;checkerStatus.className='checker-status wait';checkerStatus.textContent=letter==='J'?'Make a clear I handshape first.':'Use a clear index-only handshape first.';return}
    if(!inStart){traceStartHoldAt=null;checkerStatus.className='checker-status wait';checkerStatus.textContent='Move the highlighted fingertip into the green start circle.';return}
    if(traceStartHoldAt==null)traceStartHoldAt=now;const p=clamp((now-traceStartHoldAt)/TRACE_START_HOLD_MS);holdProgressEl.style.width=`${Math.round(p*100)}%`;
    if(p<1)return;
    traceState={letter,nextIndex:1,startedAt:now,startShape,hits:[0]};traceStartHoldAt=null;holdProgressEl.style.width='0%';return;
  }

  if(now-traceState.startedAt>TRACE_TIMEOUT_MS){resetTrace();holdProgressEl.style.width='0%';checkerStatus.textContent='Trace timed out. Return to the green start circle.';return}
  if(startShape<.42){checkerStatus.textContent='Keep the starting handshape while moving. Reacquiring…';return}

  const target=g.points[traceState.nextIndex],d=traceDistance(tip,target);
  if(d<=TRACE_TOLERANCE){
    traceState.hits.push(d);traceState.nextIndex++;
    const p=traceProgress(letter);holdProgressEl.style.width=`${Math.round(p*100)}%`;
    if(traceState.nextIndex>=g.points.length){
      const path=Math.round(86+(1-clamp(avg(traceState.hits)/TRACE_TOLERANCE))*14);
      const shape=Math.round(traceState.startShape*100),confidence=Math.round(shape*.30+path*.70);
      results[letter]={confidence,raw:shape,competitor:null,competitorScore:0,margin:99,motion:path,tracePassed:true,autoPassed:true};
      checkerStatus.className='checker-status pass';checkerStatus.textContent=`✓ ${letter} trace accepted`;holdProgressEl.style.width='100%';resetTrace();advanceAfterPass();return;
    }
    checkerStatus.className='checker-status pass';checkerStatus.textContent=`Good — keep following the path in order.`;
  }else checkerStatus.textContent='Stay near the stencil and move toward the next blue point.';
}

function feedbackFor(letter,e){
  if(motionLetter(letter))return ['',`${letter} uses motion tracing after the correct starting handshape.`];
  if(e.confidence>=95&&e.margin>=10)return ['good',`Excellent ${letter}. It clearly beats ${e.competitor||'its lookalikes'}.`];
  if(e.confidence>=82&&e.margin>=5)return ['good',`Strong ${letter} match. Nearest lookalike: ${e.competitor||'none'}.`];
  if(e.competitor&&e.margin<5)return ['warn',`Uncertain: ${letter} vs ${e.competitor}. ${specificHint(letter,e.competitor)}`];
  return ['',specificHint(letter,e.competitor)];
}

function updateUI(){
  const letter=LETTERS[currentIndex];targetLetter.textContent=letter;prevButton.disabled=currentIndex===0;nextButton.textContent=currentIndex===LETTERS.length-1?'Finish A–Z':'Next →';renderGrid();
  if(!latestObservation){scoreRing.style.setProperty('--score',0);scoreValue.textContent='—';scoreLabel.textContent='Show your hand';shapeScoreEl.textContent='—';motionScoreEl.textContent=motionLetter(letter)?`${Math.round(traceProgress(letter)*100)}% trace`:'N/A';trackingScoreEl.textContent='—';return}
  const e=evaluateLetter(letter,latestObservation.features);latestObservation.e=e;confidenceHistory.push({t:performance.now(),c:e.confidence});
  scoreRing.style.setProperty('--score',e.confidence);scoreValue.textContent=`${e.confidence}%`;
  scoreLabel.textContent=e.confidence>=95&&e.margin>=10?'Very strong':e.confidence>=82&&e.margin>=5?'Strong match':e.margin<5?'Uncertain':'Keep adjusting';
  shapeScoreEl.textContent=`${e.raw}%`;motionScoreEl.textContent=motionLetter(letter)?`${Math.round(traceProgress(letter)*100)}% trace`:`vs ${e.competitor||'—'} ${e.competitorScore}%`;
  trackingScoreEl.textContent=`${latestObservation.tracking}%`;
  const [klass,text]=feedbackFor(letter,e);feedback.className=`feedback ${klass}`;feedback.textContent=text;autoCheck(letter,e);
}

function renderGrid(){alphabetGrid.innerHTML='';LETTERS.forEach((letter,i)=>{const b=document.createElement('button');b.className='letter-chip';if(i===currentIndex)b.classList.add('active');if(results[letter])b.classList.add(results[letter].autoPassed?'done':'low');b.textContent=letter;b.onclick=()=>{captureCurrent();resetHold();resetTrace();currentIndex=i;latestObservation=null;prevVector=null;confidenceHistory=[];drawHand(null);updateUI()};alphabetGrid.appendChild(b)})}
function captureCurrent(){const letter=LETTERS[currentIndex];if(!latestObservation)return;results[letter]=evaluateLetter(letter,latestObservation.features)}
function next(){captureCurrent();resetHold();resetTrace();if(currentIndex===LETTERS.length-1){showResults();return}currentIndex++;latestObservation=null;prevVector=null;confidenceHistory=[];cooldownUntil=performance.now()+250;updateUI()}
function previous(){captureCurrent();resetHold();resetTrace();currentIndex=Math.max(0,currentIndex-1);latestObservation=null;prevVector=null;confidenceHistory=[];cooldownUntil=performance.now()+250;updateUI()}
function toggleChecking(){checkingActive=!checkingActive;resetHold();resetTrace();confidenceHistory=[];checkButton.textContent=checkingActive?'Pause checking':'Start checking';checkerStatus.className=`checker-status ${checkingActive?'pass':'paused'}`;checkerStatus.textContent=checkingActive?`Checking started. Sign ${LETTERS[currentIndex]}.`:'Checking paused. Your place is saved.'}

async function createLandmarker(){
  cameraBadge.textContent='Loading hand model…';const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  const options={baseOptions:{modelAssetPath:MODEL_URL,delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.50,minHandPresenceConfidence:.48,minTrackingConfidence:.42};
  try{handLandmarker=await HandLandmarker.createFromOptions(vision,options)}catch{options.baseOptions={modelAssetPath:MODEL_URL,delegate:'CPU'};handLandmarker=await HandLandmarker.createFromOptions(vision,options)}
  cameraBadge.textContent='On-device hand tracking';
}
async function startCamera(){
  startCameraButton.disabled=true;startCameraButton.textContent='Starting…';
  try{if(!handLandmarker)await createLandmarker();cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30,max:60}}});video.srcObject=cameraStream;await video.play();introCard.classList.add('hidden');cameraCard.classList.remove('hidden');resultsCard.classList.add('hidden');resizeCanvas();renderLoop()}
  catch(err){console.error(err);startCameraButton.disabled=false;startCameraButton.textContent='Turn on camera';alert(`Camera beta could not start: ${err?.message||err}`)}
}
function resizeCanvas(){const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d))}
function renderLoop(){
  if(!cameraStream||!handLandmarker)return;const now=performance.now(),dt=now-lastFrameAt;lastFrameAt=now;if(dt>0)fpsSmooth=fpsSmooth*.9+(1000/dt)*.1;fpsBadge.textContent=`${Math.round(fpsSmooth)} fps`;
  if(video.readyState>=2&&video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime;let detected;try{detected=handLandmarker.detectForVideo(video,now)}catch(err){console.warn(err)}
    const lm=detected?.landmarks?.[0],handed=detected?.handedness?.[0]?.[0]?.categoryName||'Right',handScore=detected?.handedness?.[0]?.[0]?.score||0;
    if(lm){
      lastHandSeen=now;const features=makeFeatures(lm,handed),stability=frameStability(features.vector,prevVector);prevVector=features.vector;
      const tracking=Math.round(clamp(handScore*.65+features.visibility*.35)*100);latestObservation={lm,features,stability,tracking,t:now};virtualTip(LETTERS[currentIndex],lm);drawHand(lm);cameraBadge.textContent='On-device hand tracking';
    }else{
      latestObservation=null;prevVector=null;drawHand(null);if(now-lastHandSeen>TRACE_DROPOUT_MS)cameraBadge.textContent='Show your signing hand';
    }
    updateUI();
  }
  animationId=requestAnimationFrame(renderLoop);
}
function showResults(){
  captureCurrent();cameraCard.classList.add('hidden');resultsCard.classList.remove('hidden');
  const attempted=LETTERS.filter(l=>results[l]).length,vals=LETTERS.filter(l=>results[l]).map(l=>results[l].confidence||0),average=vals.length?Math.round(avg(vals)):0,strong=LETTERS.filter(l=>results[l]?.autoPassed).length,uncertain=LETTERS.filter(l=>results[l]&&!results[l]?.autoPassed).length;
  $('resultAverage').textContent=`${average}%`;$('resultStrong').textContent=`${strong}/${attempted||LETTERS.length}`;$('resultTemplates').textContent=uncertain;
  const rows=$('resultRows');rows.innerHTML='';LETTERS.forEach(letter=>{const r=results[letter]||{confidence:0};const row=document.createElement('div');row.className='result-row';row.innerHTML=`<div class="result-letter">${letter}</div><div><b>${r.confidence||0}% match confidence</b><div class="result-bar"><span style="width:${r.confidence||0}%"></span></div></div><small>${r.tracePassed?'motion trace':r.competitor?`vs ${r.competitor}`:'not checked'}</small>`;rows.appendChild(row)})
}
function restart(){results={};currentIndex=0;latestObservation=null;prevVector=null;confidenceHistory=[];resetTrace();checkingActive=false;resetHold();checkButton.textContent='Start checking';checkerStatus.className='checker-status';checkerStatus.innerHTML='Camera is ready. Tap <b>Start checking</b> when you want ASLingo to begin A–Z.';resultsCard.classList.add('hidden');cameraCard.classList.remove('hidden');updateUI()}
function stopCamera(){cancelAnimationFrame(animationId);cameraStream?.getTracks()?.forEach(t=>t.stop());cameraStream=null}

startCameraButton.addEventListener('click',startCamera);checkButton.addEventListener('click',toggleChecking);prevButton.addEventListener('click',previous);nextButton.addEventListener('click',next);restartButton.addEventListener('click',restart);backButton.addEventListener('click',()=>{stopCamera();location.href='/'});window.addEventListener('resize',resizeCanvas);window.addEventListener('pagehide',stopCamera);
renderGrid();updateUI();
