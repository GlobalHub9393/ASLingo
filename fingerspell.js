import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  clamp, avg, makeFeatures, evaluateLetter, motionStartScore,
  specificHint, frameStability
} from './hand-classifier.js';

const MODEL_URL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WORDS=['NAME','DOG','CAT','PHONE','STORE','WATER','FAMILY','FRIEND','WORK','HOME','THANK','PLEASE'];
const PASS=82,FAST=95,FAST_MARGIN=10,TRACE_TOL=.12,FAIL_GRACE=110;

const $=id=>document.getElementById(id);
const setup=$('setup'),cameraCard=$('cameraCard'),resultCard=$('resultCard'),video=$('camera'),canvas=$('overlay'),ctx=canvas.getContext('2d');
const wordGrid=$('wordGrid'),customWord=$('customWord'),startWord=$('startWord'),wordDisplay=$('wordDisplay'),targetText=$('targetText'),letterCount=$('letterCount');
const sessionConfidence=$('sessionConfidence'),confidenceEl=$('confidence'),holdBar=$('holdBar'),feedback=$('feedback'),cameraBadge=$('cameraBadge'),traceHelp=$('traceHelp');
const resultWord=$('resultWord'),resultScore=$('resultScore'),resultCopy=$('resultCopy'),resultLetters=$('resultLetters');

let selectedWord='NAME',sequence=[],index=0,results=[],stream=null,landmarker=null,animation=0,lastTime=-1,lastHandSeen=0;
let latest=null,prevVector=null,holdAt=null,peak=0,failSince=null,cooldown=0,history=[];
let trace=null,traceHold=null,tipFilter=null,repeatNeedsRelease=false;

const motionLetter=l=>l==='J'||l==='Z';
const guide=letter=>letter==='J'
 ? {finger:20,prev:19,prev2:18,pts:[{x:.26,y:.27},{x:.26,y:.43},{x:.27,y:.58},{x:.31,y:.68},{x:.39,y:.71}]}
 : {finger:8,prev:7,prev2:6,pts:[{x:.40,y:.29},{x:.28,y:.29},{x:.16,y:.29},{x:.28,y:.46},{x:.40,y:.64},{x:.28,y:.64},{x:.16,y:.64}]};

function traceDist(a,b){return Math.hypot(a.x-b.x,(a.y-b.y)*.78)}
function virtualTip(letter,lm){
  const g=guide(letter),raw=lm[g.finger],dip=lm[g.prev],pip=lm[g.prev2];if(!raw||!dip||!pip)return tipFilter;
  const vx=dip.x-pip.x,vy=dip.y-pip.y,vm=Math.hypot(vx,vy)||1,seg=Math.max(Math.hypot(raw.x-dip.x,raw.y-dip.y),.025);
  const pred={x:dip.x+vx/vm*seg,y:dip.y+vy/vm*seg,z:raw.z||0},c={x:raw.x*.78+pred.x*.22,y:raw.y*.78+pred.y*.22,z:raw.z||0};
  if(!tipFilter){tipFilter=c;return c}const jump=Math.hypot(c.x-tipFilter.x,c.y-tipFilter.y),a=jump>.15?.22:.48;tipFilter={x:tipFilter.x*(1-a)+c.x*a,y:tipFilter.y*(1-a)+c.y*a,z:c.z};return tipFilter;
}
function drawGuide(letter){
  if(!motionLetter(letter))return;const g=guide(letter),w=canvas.width,h=canvas.height,pts=g.pts.map(p=>({x:p.x*w,y:p.y*h})),n=trace?.letter===letter?trace.next:0;
  ctx.save();ctx.lineWidth=Math.max(7,w/90);ctx.strokeStyle='rgba(92,151,244,.30)';ctx.setLineDash([10,10]);ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();ctx.setLineDash([]);
  pts.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,i===n?Math.max(12,w/42):Math.max(8,w/58),0,Math.PI*2);ctx.fillStyle=i===0&&!trace?'rgba(38,176,103,.85)':i<n?'rgba(38,176,103,.68)':i===n?'rgba(45,118,233,.82)':'rgba(255,255,255,.5)';ctx.fill()});
  if(tipFilter){ctx.beginPath();ctx.arc(tipFilter.x*w,tipFilter.y*h,Math.max(7,w/70),0,Math.PI*2);ctx.fillStyle='rgba(255,221,71,.92)';ctx.fill()}ctx.restore();
}
function drawHand(lm){
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);drawGuide(sequence[index]);if(!lm)return;
  ctx.lineWidth=Math.max(2,w/260);ctx.strokeStyle='rgba(88,181,255,.92)';for(const c of HandLandmarker.HAND_CONNECTIONS||[]){const a=lm[c.start],b=lm[c.end];if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke()}
  ctx.fillStyle='rgba(255,255,255,.96)';for(const p of lm){ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/180),0,Math.PI*2);ctx.fill()}
}
function renderWord(){wordDisplay.innerHTML='';sequence.forEach((l,i)=>{const s=document.createElement('span');s.className='word-letter '+(i<index?'done':i===index?'active':'');s.textContent=l;wordDisplay.appendChild(s)});targetText.textContent=`Sign ${sequence[index]||''}`;letterCount.textContent=`${Math.min(index+1,sequence.length)}/${sequence.length}`;const done=results.filter(Boolean);sessionConfidence.textContent=done.length?`Word confidence ${Math.round(avg(done.map(r=>r.confidence)))}%`:'Word confidence —'}
function rolling(ms=160){const now=performance.now();history=history.filter(x=>now-x.t<600);const xs=history.filter(x=>now-x.t<=ms);return xs.length?avg(xs.map(x=>x.c)):0}
function clearHold(){holdAt=null;peak=0;failSince=null;holdBar.style.width='0%'}
function accept(e,motion=false){
  const letter=sequence[index];results[index]={letter,confidence:Math.round(e.confidence),motion,competitor:e.competitor||null};clearHold();holdBar.style.width='100%';feedback.className='feedback good';feedback.textContent=`✓ ${letter} accepted`;
  const nextIndex=index+1;if(nextIndex<sequence.length&&sequence[nextIndex]===letter)repeatNeedsRelease=true;
  if(index>=sequence.length-1){setTimeout(finish,360);return}
  index++;history=[];trace=null;traceHold=null;tipFilter=null;latest=null;prevVector=null;cooldown=performance.now()+220;renderWord();setTimeout(()=>holdBar.style.width='0%',220)
}
function updateStatic(f){
  traceHelp.classList.add('hidden');const letter=sequence[index],e=evaluateLetter(letter,f);history.push({t:performance.now(),c:e.confidence});const r=rolling();confidenceEl.textContent=`${Math.round(Math.max(e.confidence,r))}%`;
  if(performance.now()<cooldown)return;
  if(repeatNeedsRelease){
    if(e.confidence<64){repeatNeedsRelease=false;feedback.className='feedback';feedback.textContent=`Good — now form ${letter} again.`}
    else{feedback.className='feedback';feedback.textContent=`Double ${letter}: release the handshape slightly, then make ${letter} again.`;holdBar.style.width='0%'}
    return;
  }
  const stable=(latest?.stability||0)>=.52,marginOk=e.margin>=5,fast=e.confidence>=FAST&&e.margin>=FAST_MARGIN&&(latest?.stability||0)>=.66;
  const candidate=Math.max(e.confidence,r),required=fast?140:e.confidence>=90?260:470,passing=stable&&marginOk&&candidate>=PASS;
  if(!passing){
    if(failSince==null)failSince=performance.now();
    if(performance.now()-failSince>FAIL_GRACE){clearHold();feedback.className=e.margin<5?'feedback warn':'feedback';feedback.textContent=e.margin<5?`Uncertain ${letter} vs ${e.competitor}. ${specificHint(letter,e.competitor)}`:!stable?'Let the transition settle for a moment.':`Match confidence ${candidate}% — keep shaping ${letter}.`}
    return;
  }
  failSince=null;if(holdAt==null)holdAt=performance.now();peak=Math.max(peak,e.confidence);const p=clamp((performance.now()-holdAt)/required);holdBar.style.width=`${Math.round(p*100)}%`;feedback.className='feedback good';feedback.textContent=fast?`Excellent ${letter} — quick pass…`:`${letter} ${candidate}% · ${Math.max(0,(required-(performance.now()-holdAt))/1000).toFixed(1)}s`;
  if(p>=1)accept({...e,confidence:Math.max(peak,e.confidence)},false)
}
function updateTrace(lm,f){
  const letter=sequence[index],g=guide(letter),now=performance.now(),tip=virtualTip(letter,lm),shape=motionStartScore(letter,f);traceHelp.classList.remove('hidden');traceHelp.textContent=`${letter}: follow the guide with your ${letter==='J'?'pinky':'index'} fingertip. Close and in order is enough.`;
  if(!tip)return;
  if(!trace||trace.letter!==letter){
    if(shape<.66){traceHold=null;feedback.textContent=letter==='J'?'Make the I handshape first.':'Use an index-only handshape first.';return}
    if(traceDist(tip,g.pts[0])>TRACE_TOL){traceHold=null;feedback.textContent='Move the highlighted fingertip into the green start circle.';return}
    if(traceHold==null)traceHold=now;const p=clamp((now-traceHold)/150);holdBar.style.width=`${Math.round(p*100)}%`;if(p<1)return;trace={letter,next:1,shape,hits:[0],started:now};traceHold=null;return;
  }
  if(shape<.40){feedback.textContent='Keep the starting handshape while moving. Reacquiring…';return}
  const target=g.pts[trace.next],d=traceDist(tip,target);if(d<=TRACE_TOL){trace.hits.push(d);trace.next++;holdBar.style.width=`${Math.round(trace.next/g.pts.length*100)}%`;if(trace.next>=g.pts.length){const path=Math.round(86+(1-clamp(avg(trace.hits)/TRACE_TOL))*14),conf=Math.round(shape*30+path*.70);accept({confidence:conf},true);trace=null;return}}
  feedback.textContent='Stay near the stencil and move toward the next point.';
}
async function init(){
  WORDS.forEach(w=>{const b=document.createElement('button');b.textContent=w;b.onclick=()=>{selectedWord=w;customWord.value='';[...wordGrid.children].forEach(x=>x.classList.toggle('selected',x===b))};if(w==='NAME')b.classList.add('selected');wordGrid.appendChild(b)});
  startWord.onclick=start;$('restartWord').onclick=()=>beginSequence(selectedWord);$('newWord').onclick=()=>{stop();cameraCard.classList.add('hidden');resultCard.classList.add('hidden');setup.classList.remove('hidden')};$('again').onclick=()=>{resultCard.classList.add('hidden');setup.classList.remove('hidden')};
}
async function start(){
  const typed=customWord.value.toUpperCase().replace(/[^A-Z]/g,'');if(typed)selectedWord=typed;if(!selectedWord)return;startWord.disabled=true;startWord.textContent='Starting…';
  try{if(!landmarker){cameraBadge.textContent='Loading hand model…';const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');landmarker=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:MODEL_URL,delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.50,minHandPresenceConfidence:.48,minTrackingConfidence:.42})}
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30,max:60}}});video.srcObject=stream;await video.play();setup.classList.add('hidden');resultCard.classList.add('hidden');cameraCard.classList.remove('hidden');beginSequence(selectedWord);resize();loop();cameraBadge.textContent='On-device comparative tracking'}
  catch(e){alert(`Could not start camera: ${e.message||e}`);startWord.disabled=false;startWord.textContent='Start camera'}
}
function beginSequence(word){selectedWord=word;sequence=word.split('');index=0;results=[];latest=null;prevVector=null;clearHold();history=[];trace=null;traceHold=null;tipFilter=null;repeatNeedsRelease=false;holdBar.style.width='0%';confidenceEl.textContent='—';renderWord()}
function resize(){const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d))}
function loop(){
  if(!stream||!landmarker)return;const now=performance.now();
  if(video.readyState>=2&&video.currentTime!==lastTime){lastTime=video.currentTime;let d;try{d=landmarker.detectForVideo(video,now)}catch{}const lm=d?.landmarks?.[0],handed=d?.handedness?.[0]?.[0]?.categoryName||'Right';
    if(lm){lastHandSeen=now;const f=makeFeatures(lm,handed),stability=frameStability(f.vector,prevVector);prevVector=f.vector;latest={lm,f,stability};drawHand(lm);const letter=sequence[index];if(motionLetter(letter)){confidenceEl.textContent=`${Math.round(motionStartScore(letter,f)*100)}%`;updateTrace(lm,f)}else updateStatic(f)}
    else{latest=null;prevVector=null;drawHand(null);if(now-lastHandSeen>220){clearHold();feedback.className='feedback';feedback.textContent='Show your signing hand clearly.'}}
  }
  animation=requestAnimationFrame(loop)
}
function finish(){stop();cameraCard.classList.add('hidden');resultCard.classList.remove('hidden');const s=Math.round(avg(results.map(r=>r.confidence)));resultWord.textContent=selectedWord;resultScore.textContent=`${s}%`;resultCopy.textContent=s>=90?'Strong guided fingerspelling run.':s>=82?'Solid run. Aim for smoother transitions next time.':'Worth another pass at a comfortable pace.';resultLetters.innerHTML='';results.forEach(r=>{const d=document.createElement('div');d.className='result-row';d.innerHTML=`<b>${r.letter}</b><strong>${r.confidence}%</strong><span>${r.motion?'trace':r.competitor?`vs ${r.competitor}`:'handshape'}</span>`;resultLetters.appendChild(d)})}
function stop(){cancelAnimationFrame(animation);stream?.getTracks()?.forEach(t=>t.stop());stream=null}
window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);init();
