import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL='https://raw.githubusercontent.com/Muhib-Mehdi/ASL-Recognition-System/main/model/keypoint_classifier/keypoint_classifier.tflite';
const LABELS='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MEDIAPIPE_MODEL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const TF_CORE='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.22.0/dist/tf-core.min.js';
const TF_CPU='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-cpu@4.22.0/dist/tf-backend-cpu.min.js';
const TF_TFLITE='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.9/dist/tf-tflite.min.js';

const $=id=>document.getElementById(id);
const intro=$('intro'),cameraCard=$('cameraCard'),start=$('start'),stopBtn=$('stop'),clearBtn=$('clear');
const video=$('camera'),canvas=$('overlay'),ctx=canvas.getContext('2d'),status=$('status'),fps=$('fps');
const bigLetter=$('bigLetter'),bigConfidence=$('bigConfidence'),stableBar=$('stableBar'),stableText=$('stableText'),top3=$('top3'),historyEl=$('history'),note=$('note'),errorBox=$('errorBox');

let hand=null,model=null,stream=null,animation=0,lastVideoTime=-1,lastFrame=performance.now(),fpsSmooth=0,inferBusy=false;
let predictions=[],stableSince=null,lastLocked=null,history=[];

function showError(label,e){console.error(label,e);errorBox.classList.remove('hidden');errorBox.textContent=`${label}: ${e?.message||e}`}
function clearError(){errorBox.classList.add('hidden');errorBox.textContent=''}
function loadScript(src){return new Promise((resolve,reject)=>{const found=document.querySelector(`script[data-aslingo-src="${src}"]`);if(found){if(found.dataset.loaded==='1')return resolve();found.addEventListener('load',resolve,{once:true});found.addEventListener('error',()=>reject(new Error(`Could not load ${src}`)),{once:true});return}const s=document.createElement('script');s.src=src;s.async=true;s.dataset.aslingoSrc=src;s.onload=()=>{s.dataset.loaded='1';resolve()};s.onerror=()=>reject(new Error(`Could not load ${src}`));document.head.appendChild(s)})}

function preprocess(lm){
  const w=video.videoWidth||960,h=video.videoHeight||720;
  const pts=lm.map(p=>[p.x*w,p.y*h]),[bx,by]=pts[0],flat=[];
  for(const [x,y] of pts)flat.push(x-bx,y-by);
  const max=Math.max(...flat.map(v=>Math.abs(v)),1e-6);
  return flat.map(v=>v/max);
}
function normalizeOutput(arr){
  const xs=Array.from(arr),sum=xs.reduce((a,b)=>a+b,0);
  if(xs.every(v=>v>=0&&v<=1.0001)&&sum>.8&&sum<1.2)return xs;
  const m=Math.max(...xs),e=xs.map(v=>Math.exp(v-m)),s=e.reduce((a,b)=>a+b,0)||1;return e.map(v=>v/s)
}
async function infer(lm){
  const input=window.tf.tensor2d(preprocess(lm),[1,42],'float32');
  let output=null;
  try{
    output=model.predict(input);
    if(Array.isArray(output))output=output[0];
    else if(output&&typeof output.data!=='function')output=Object.values(output)[0];
    if(!output||typeof output.data!=='function')throw new Error('Model returned an unreadable output tensor.');
    const data=await output.data();
    if(data.length!==26)throw new Error(`Expected 26 output scores, got ${data.length}.`);
    return normalizeOutput(data).map((p,i)=>({letter:LABELS[i],confidence:p})).sort((a,b)=>b.confidence-a.confidence);
  }finally{try{input.dispose()}catch{}try{output?.dispose?.()}catch{}}
}

function draw(lm){
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);if(!lm)return;
  ctx.lineWidth=Math.max(2,w/260);ctx.strokeStyle='rgba(74,171,255,.95)';
  for(const c of HandLandmarker.HAND_CONNECTIONS||[]){const a=lm[c.start],b=lm[c.end];if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke()}
  ctx.fillStyle='#fff';for(const p of lm){ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/180),0,Math.PI*2);ctx.fill()}
}
function renderPrediction(ranked){
  if(!ranked?.length)return;const top=ranked[0],now=performance.now();
  predictions.push({t:now,letter:top.letter,c:top.confidence});predictions=predictions.filter(x=>now-x.t<650);
  const recent=predictions.filter(x=>now-x.t<360),same=recent.filter(x=>x.letter===top.letter),stability=recent.length?same.length/recent.length:0,avgConf=same.length?same.reduce((a,b)=>a+b.c,0)/same.length:top.confidence;
  bigLetter.textContent=top.letter;bigConfidence.textContent=`${Math.round(top.confidence*100)}% model confidence`;stableBar.style.width=`${Math.round(stability*100)}%`;stableText.textContent=`${Math.round(stability*100)}% stable`;
  top3.innerHTML='';ranked.slice(0,3).forEach((r,i)=>{const d=document.createElement('div');d.className='predCard '+(i===0?'first':'');d.innerHTML=`<b>${r.letter}</b><span>${Math.round(r.confidence*100)}%</span>`;top3.appendChild(d)});
  const lockable=stability>=.78&&avgConf>=.55&&recent.length>=5;
  if(lockable){if(stableSince==null)stableSince=now;if(now-stableSince>=220&&lastLocked!==top.letter){lastLocked=top.letter;history.unshift({letter:top.letter,confidence:avgConf,time:new Date()});history=history.slice(0,12);renderHistory();note.textContent=`Stable prediction: ${top.letter}. Change your handshape and the model should move to a different letter.`}}
  else{stableSince=null;if(lastLocked&&top.letter!==lastLocked)lastLocked=null;note.textContent='Hold a letter naturally. ASLingo is waiting for a stable model prediction.'}
}
function renderHistory(){historyEl.innerHTML='';if(!history.length){historyEl.innerHTML='<p class="fine">No stable predictions yet.</p>';return}history.forEach(x=>{const d=document.createElement('div');d.className='historyRow';d.innerHTML=`<b>${x.letter}</b><strong>${Math.round(x.confidence*100)}% confidence</strong><span>${x.time.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}</span>`;historyEl.appendChild(d)})}

async function loadAll(){
  clearError();status.textContent='Loading MediaPipe…';
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  hand=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:MEDIAPIPE_MODEL,delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.5,minHandPresenceConfidence:.48,minTrackingConfidence:.42});

  status.textContent='Loading browser ML runtime…';await loadScript(TF_CORE);await loadScript(TF_CPU);
  if(!window.tf)throw new Error('TensorFlow.js did not initialize.');
  await window.tf.setBackend('cpu');await window.tf.ready();

  status.textContent='Loading TFLite runtime…';await loadScript(TF_TFLITE);
  if(!window.tflite?.loadTFLiteModel)throw new Error('TFLite browser runtime did not initialize.');

  status.textContent='Loading ASL model…';
  const response=await fetch(MODEL_URL,{cache:'force-cache'});if(!response.ok)throw new Error(`Model download failed (${response.status}).`);
  const bytes=await response.arrayBuffer();
  model=await window.tflite.loadTFLiteModel(bytes,{numThreads:1});
  status.textContent='Neural model ready';
}
async function begin(){
  start.disabled=true;start.textContent='Starting…';
  try{if(!hand||!model)await loadAll();stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30,max:60}}});video.srcObject=stream;await video.play();intro.classList.add('hidden');cameraCard.classList.remove('hidden');resize();loop()}
  catch(e){showError('Startup error',e);status.textContent='Could not start';start.disabled=false;start.textContent='Try again';alert(`Neural Alphabet Lab could not start: ${e?.message||e}`)}
}
async function processFrame(now){
  let d;try{d=hand.detectForVideo(video,now)}catch(e){showError('MediaPipe error',e);return}
  const lm=d?.landmarks?.[0];
  if(!lm){draw(null);bigLetter.textContent='—';bigConfidence.textContent='Show your hand';stableBar.style.width='0%';stableText.textContent='—';top3.innerHTML='';predictions=[];stableSince=null;lastLocked=null;note.textContent='Keep the whole signing hand visible.';return}
  draw(lm);if(inferBusy)return;inferBusy=true;
  try{const ranked=await infer(lm);status.textContent='Neural model running';clearError();renderPrediction(ranked)}
  catch(e){status.textContent='Inference error';showError('Inference error',e)}
  finally{inferBusy=false}
}
function loop(){if(!stream||!hand||!model)return;const now=performance.now(),dt=now-lastFrame;lastFrame=now;if(dt>0)fpsSmooth=fpsSmooth*.9+(1000/dt)*.1;fps.textContent=`${Math.round(fpsSmooth)} fps`;if(video.readyState>=2&&video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;processFrame(now)}animation=requestAnimationFrame(loop)}
function resize(){const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d))}
function stop(){cancelAnimationFrame(animation);stream?.getTracks()?.forEach(t=>t.stop());stream=null;cameraCard.classList.add('hidden');intro.classList.remove('hidden');start.disabled=false;start.textContent='Start neural camera'}
start.addEventListener('click',begin);stopBtn.addEventListener('click',stop);clearBtn.addEventListener('click',()=>{history=[];renderHistory()});window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);renderHistory();
