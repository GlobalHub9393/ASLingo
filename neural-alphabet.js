import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { loadLiteRt, loadAndCompile, Tensor } from '@litertjs/core';

const MODEL_URL='https://raw.githubusercontent.com/Muhib-Mehdi/ASL-Recognition-System/main/model/keypoint_classifier/keypoint_classifier.tflite';
const WASM_URL='https://cdn.jsdelivr.net/npm/@litertjs/core/wasm/';
const LABELS='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MEDIAPIPE_MODEL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const $=id=>document.getElementById(id);
const intro=$('intro'),cameraCard=$('cameraCard'),start=$('start'),stopBtn=$('stop'),clearBtn=$('clear');
const video=$('camera'),canvas=$('overlay'),ctx=canvas.getContext('2d'),status=$('status'),fps=$('fps');
const bigLetter=$('bigLetter'),bigConfidence=$('bigConfidence'),stableBar=$('stableBar'),stableText=$('stableText'),top3=$('top3'),historyEl=$('history'),note=$('note');

let hand=null,model=null,stream=null,animation=0,lastVideoTime=-1,lastFrame=performance.now(),fpsSmooth=0;
let predictions=[],stableSince=null,lastLocked=null,history=[];

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

function preprocess(lm){
  const w=video.videoWidth||960,h=video.videoHeight||720;
  const points=lm.map(p=>[p.x*w,p.y*h]);
  const [bx,by]=points[0];
  const flat=[];
  for(const [x,y] of points){flat.push(x-bx,y-by)}
  const max=Math.max(...flat.map(v=>Math.abs(v)),1e-6);
  return new Float32Array(flat.map(v=>v/max));
}

function normalizeOutput(arr){
  const xs=Array.from(arr);
  const looksLikeProb=xs.every(v=>v>=0&&v<=1.0001) && xs.reduce((a,b)=>a+b,0)>.8 && xs.reduce((a,b)=>a+b,0)<1.2;
  if(looksLikeProb)return xs;
  const m=Math.max(...xs),e=xs.map(v=>Math.exp(v-m)),s=e.reduce((a,b)=>a+b,0)||1;
  return e.map(v=>v/s);
}

async function infer(lm){
  const input=new Tensor(preprocess(lm),[1,42]);
  let outputs=null;
  let moved=null;
  try{
    outputs=await model.run(input);

    let out;
    if(Array.isArray(outputs)) out=outputs[0];
    else if(outputs?.[0]) out=outputs[0];
    else out=Object.values(outputs||{})[0];

    if(!out) throw new Error('Neural model returned no output tensor.');

    // LiteRT.js 2.x may return a tensor located on the selected backend.
    // Move it to WASM before reading when necessary.
    moved=typeof out.moveTo==='function' ? await out.moveTo('wasm') : out;

    let data;
    if(typeof moved.toTypedArray==='function') data=moved.toTypedArray();
    else if(typeof moved.data==='function') data=await moved.data();
    else throw new Error('Could not read model output tensor.');

    const probs=normalizeOutput(data);
    return probs
      .map((p,i)=>({letter:LABELS[i],confidence:p}))
      .sort((a,b)=>b.confidence-a.confidence);
  }finally{
    try{
      if(moved && typeof moved.delete==='function') moved.delete();
      else if(moved && typeof moved.dispose==='function') moved.dispose();
    }catch{}
    try{
      if(outputs && typeof outputs.delete==='function') outputs.delete();
    }catch{}
    try{
      if(typeof input.delete==='function') input.delete();
      else if(typeof input.dispose==='function') input.dispose();
    }catch{}
  }
}

function draw(lm){
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);if(!lm)return;
  ctx.lineWidth=Math.max(2,w/260);ctx.strokeStyle='rgba(74,171,255,.95)';
  for(const c of HandLandmarker.HAND_CONNECTIONS||[]){const a=lm[c.start],b=lm[c.end];if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke()}
  ctx.fillStyle='#fff';for(const p of lm){ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/180),0,Math.PI*2);ctx.fill()}
}

function renderPrediction(ranked){
  if(!ranked?.length)return;
  const top=ranked[0],now=performance.now();
  predictions.push({t:now,letter:top.letter,c:top.confidence});predictions=predictions.filter(x=>now-x.t<650);
  const recent=predictions.filter(x=>now-x.t<360);
  const same=recent.filter(x=>x.letter===top.letter);
  const stability=recent.length?same.length/recent.length:0;
  const avgConf=same.length?same.reduce((a,b)=>a+b.c,0)/same.length:top.confidence;

  bigLetter.textContent=top.letter;
  bigConfidence.textContent=`${Math.round(top.confidence*100)}% model confidence`;
  stableBar.style.width=`${Math.round(stability*100)}%`;
  stableText.textContent=`${Math.round(stability*100)}% stable`;

  top3.innerHTML='';
  ranked.slice(0,3).forEach((r,i)=>{
    const d=document.createElement('div');d.className='predCard '+(i===0?'first':'');
    d.innerHTML=`<b>${r.letter}</b><span>${Math.round(r.confidence*100)}%</span>`;
    top3.appendChild(d);
  });

  const lockable=stability>=.78 && avgConf>=.55 && recent.length>=5;
  if(lockable){
    if(stableSince==null)stableSince=now;
    if(now-stableSince>=220 && lastLocked!==top.letter){
      lastLocked=top.letter;
      history.unshift({letter:top.letter,confidence:avgConf,time:new Date()});
      history=history.slice(0,12);
      renderHistory();
      note.textContent=`Stable prediction: ${top.letter}. Change your handshape and the model should move to a different letter.`;
    }
  }else{
    stableSince=null;
    if(lastLocked && top.letter!==lastLocked)lastLocked=null;
    note.textContent='Hold a letter naturally. ASLingo is waiting for a stable model prediction.';
  }
}

function renderHistory(){
  historyEl.innerHTML='';
  if(!history.length){historyEl.innerHTML='<p class="fine">No stable predictions yet.</p>';return}
  history.forEach(x=>{
    const d=document.createElement('div');d.className='historyRow';
    d.innerHTML=`<b>${x.letter}</b><strong>${Math.round(x.confidence*100)}% confidence</strong><span>${x.time.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}</span>`;
    historyEl.appendChild(d);
  });
}

async function loadAll(){
  status.textContent='Loading MediaPipe…';
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  hand=await HandLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:MEDIAPIPE_MODEL,delegate:'GPU'},
    runningMode:'VIDEO',numHands:1,
    minHandDetectionConfidence:.5,minHandPresenceConfidence:.48,minTrackingConfidence:.42
  });

  status.textContent='Loading neural runtime…';
  await loadLiteRt(WASM_URL);

  status.textContent='Loading ASL model…';
  // WASM is intentional for the first iPad test. It is tiny and avoids WebGPU compatibility variables.
  model=await loadAndCompile(MODEL_URL,{accelerator:'wasm'});
  status.textContent='Neural model ready';
}

async function begin(){
  start.disabled=true;start.textContent='Starting…';
  try{
    if(!hand||!model)await loadAll();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30,max:60}}});
    video.srcObject=stream;await video.play();intro.classList.add('hidden');cameraCard.classList.remove('hidden');resize();loop();
  }catch(e){
    console.error(e);status.textContent='Could not start';start.disabled=false;start.textContent='Try again';
    alert(`Neural Alphabet Lab could not start: ${e?.message||e}`);
  }
}

async function loop(){
  if(!stream||!hand||!model)return;
  const now=performance.now(),dt=now-lastFrame;lastFrame=now;if(dt>0)fpsSmooth=fpsSmooth*.9+(1000/dt)*.1;fps.textContent=`${Math.round(fpsSmooth)} fps`;
  if(video.readyState>=2&&video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime;
    let d;try{d=hand.detectForVideo(video,now)}catch(e){console.warn(e)}
    const lm=d?.landmarks?.[0];
    if(lm){
      draw(lm);status.textContent='Neural model running';
      try{const ranked=await infer(lm);renderPrediction(ranked)}catch(e){console.error('Model inference failed',e);status.textContent='Inference error'}
    }else{
      draw(null);bigLetter.textContent='—';bigConfidence.textContent='Show your hand';stableBar.style.width='0%';stableText.textContent='—';top3.innerHTML='';predictions=[];stableSince=null;lastLocked=null;note.textContent='Keep the whole signing hand visible.';
    }
  }
  animation=requestAnimationFrame(loop);
}

function resize(){const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d))}
function stop(){cancelAnimationFrame(animation);stream?.getTracks()?.forEach(t=>t.stop());stream=null;cameraCard.classList.add('hidden');intro.classList.remove('hidden');start.disabled=false;start.textContent='Start neural camera'}
start.addEventListener('click',begin);stopBtn.addEventListener('click',stop);clearBtn.addEventListener('click',()=>{history=[];renderHistory()});window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);renderHistory();
