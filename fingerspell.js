import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WORDS=['NAME','DOG','CAT','PHONE','STORE','WATER','FAMILY','FRIEND','WORK','HOME','THANK','PLEASE'];
const PASS=80, HOLD_MS=650, TRACE_TOL=.115;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const dist2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

const setup=document.getElementById('setup'), cameraCard=document.getElementById('cameraCard'), resultCard=document.getElementById('resultCard');
const video=document.getElementById('camera'), canvas=document.getElementById('overlay'), ctx=canvas.getContext('2d');
const wordGrid=document.getElementById('wordGrid'), customWord=document.getElementById('customWord'), startWord=document.getElementById('startWord');
const wordDisplay=document.getElementById('wordDisplay'), targetText=document.getElementById('targetText'), letterCount=document.getElementById('letterCount');
const sessionConfidence=document.getElementById('sessionConfidence'), confidenceEl=document.getElementById('confidence'), holdBar=document.getElementById('holdBar');
const feedback=document.getElementById('feedback'), cameraBadge=document.getElementById('cameraBadge'), traceHelp=document.getElementById('traceHelp');
const resultWord=document.getElementById('resultWord'), resultScore=document.getElementById('resultScore'), resultCopy=document.getElementById('resultCopy'), resultLetters=document.getElementById('resultLetters');

let selectedWord='NAME', sequence=[], index=0, results=[], stream=null, landmarker=null, animation=0, latest=null, lastTime=-1;
let holdAt=null, peak=0, trace=null, traceHold=null, cooldown=0;

function angle(a,b,c){const ab=[a.x-b.x,a.y-b.y,a.z-b.z],cb=[c.x-b.x,c.y-b.y,c.z-b.z];const dot=ab[0]*cb[0]+ab[1]*cb[1]+ab[2]*cb[2],ma=Math.hypot(...ab),mc=Math.hypot(...cb);return !ma||!mc?0:Math.acos(clamp(dot/(ma*mc),-1,1))*180/Math.PI}
function ext(l,m,p,d,t){const pa=angle(l[m],l[p],l[d]),da=angle(l[p],l[d],l[t]);const s=clamp(((pa-80)/90)*.68+((da-80)/90)*.32),r=clamp((dist(l[t],l[0])/(dist(l[p],l[0])+1e-6)-.93)/.35);return clamp(s*.72+r*.28)}
function features(l){
  const index=ext(l,5,6,7,8),middle=ext(l,9,10,11,12),ring=ext(l,13,14,15,16),pinky=ext(l,17,18,19,20);
  const ta=angle(l[1],l[2],l[4]),tr=dist(l[4],l[5])/(dist(l[5],l[17])+1e-6),thumb=clamp(((ta-55)/95)*.55+((tr-.45)/.9)*.45);
  const palm=dist(l[5],l[17])+1e-6,ti=dist(l[4],l[8])/palm,tm=dist(l[4],l[12])/palm,im=dist(l[8],l[12])/palm,mr=dist(l[12],l[16])/palm,rp=dist(l[16],l[20])/palm,tp=avg([8,12,16,20].map(i=>dist(l[i],l[0])/palm));
  const dx=l[8].x-l[5].x,dy=l[8].y-l[5].y,a=Math.atan2(dy,dx),horizontal=clamp(1-Math.abs(Math.sin(a))),downward=clamp((dy+.02)/.28);
  const cross=Math.sign(l[8].x-l[12].x)!==Math.sign(l[5].x-l[9].x)?1:0;
  return {thumb,index,middle,ring,pinky,thumbIndex:ti,thumbMiddle:tm,indexMiddle:im,middleRing:mr,ringPinky:rp,tipPalmAvg:tp,horizontal,downward,crossIndexMiddle:cross}
}
const close=(v,t,tol)=>clamp(1-Math.abs(v-t)/tol);
const state=(v,w)=>w?v:1-v;
function pattern(f,p){return avg([f.index,f.middle,f.ring,f.pinky].map((v,i)=>state(v,p[i])))}
function startShape(letter,f){const P=p=>pattern(f,p); if(letter==='J')return clamp(P([0,0,0,1])*.88+(1-f.thumb)*.12); return clamp(P([1,0,0,0])*.88+f.thumb*.12)}
function score(letter,f){
  const P=p=>pattern(f,p),cti=close(f.thumbIndex,.18,.22),ctm=close(f.thumbMiddle,.20,.26),spread=clamp((f.indexMiddle-.20)/.52),together=1-spread,fist=P([0,0,0,0]);
  switch(letter){
    case'A':return .68*fist+.32*f.thumb; case'B':return .75*P([1,1,1,1])+.25*(1-f.thumb);
    case'C':return .45*avg([close(f.index,.45,.5),close(f.middle,.45,.5),close(f.ring,.45,.5),close(f.pinky,.45,.5)])+.35*close(f.thumbIndex,.75,.65)+.20*f.thumb;
    case'D':return .62*P([1,0,0,0])+.23*ctm+.15*(1-f.thumb); case'E':return .58*fist+.27*close(f.tipPalmAvg,1.05,.75)+.15*(1-f.thumb);
    case'F':return .58*P([0,1,1,1])+.30*cti+.12*f.thumb; case'G':return .48*P([1,0,0,0])+.27*f.thumb+.25*f.horizontal;
    case'H':return .52*P([1,1,0,0])+.25*together+.23*f.horizontal; case'I':return .78*P([0,0,0,1])+.22*(1-f.thumb);
    case'J':return startShape('J',f); case'K':return .54*P([1,1,0,0])+.25*spread+.21*f.thumb; case'L':return .66*P([1,0,0,0])+.34*f.thumb;
    case'M':return .76*fist+.24*close(f.thumbMiddle,.48,.4); case'N':return .78*fist+.22*close(f.thumbMiddle,.34,.34); case'O':return .54*fist+.34*cti+.12*ctm;
    case'P':return .48*P([1,1,0,0])+.24*spread+.28*f.downward; case'Q':return .48*P([1,0,0,0])+.26*f.thumb+.26*f.downward;
    case'R':return .52*P([1,1,0,0])+.28*together+.20*f.crossIndexMiddle; case'S':return .80*fist+.20*f.thumb; case'T':return .78*fist+.22*cti;
    case'U':return .68*P([1,1,0,0])+.32*together; case'V':return .66*P([1,1,0,0])+.34*spread; case'W':return .76*P([1,1,1,0])+.24*avg([spread,close(f.middleRing-.15,.0,.4)]);
    case'X':return .58*close(f.index,.42,.50)+.34*avg([1-f.middle,1-f.ring,1-f.pinky])+.08*(1-f.thumb);
    case'Y':return .72*P([0,0,0,1])+.28*f.thumb; case'Z':return startShape('Z',f); default:return 0;
  }
}
function guide(letter){
  return letter==='J'
    ? {finger:20,pts:[{x:.26,y:.27},{x:.26,y:.43},{x:.27,y:.58},{x:.31,y:.68},{x:.39,y:.71}]}
    : {finger:8,pts:[{x:.40,y:.29},{x:.28,y:.29},{x:.16,y:.29},{x:.28,y:.46},{x:.40,y:.64},{x:.28,y:.64},{x:.16,y:.64}]};
}
function traceDist(a,b){return Math.hypot(a.x-b.x,(a.y-b.y)*.78)}
function drawGuide(letter){
  if(!['J','Z'].includes(letter))return;
  const g=guide(letter),w=canvas.width,h=canvas.height,pts=g.pts.map(p=>({x:p.x*w,y:p.y*h})),n=trace?.letter===letter?trace.next:0;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Math.max(7,w/90);ctx.strokeStyle='rgba(92,151,244,.30)';ctx.setLineDash([10,10]);ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();ctx.setLineDash([]);
  pts.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,i===n?Math.max(12,w/42):Math.max(8,w/58),0,Math.PI*2);ctx.fillStyle=i===0&&!trace?'rgba(38,176,103,.85)':i<n?'rgba(38,176,103,.68)':i===n?'rgba(45,118,233,.82)':'rgba(255,255,255,.5)';ctx.fill()});ctx.restore();
}
function drawHand(l){
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);drawGuide(sequence[index]);if(!l)return;
  ctx.lineWidth=Math.max(2,w/260);ctx.strokeStyle='rgba(88,181,255,.92)';
  for(const c of HandLandmarker.HAND_CONNECTIONS||[]){const a=l[c.start],b=l[c.end];if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke()}
  ctx.fillStyle='rgba(255,255,255,.96)';for(const p of l){ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(3,w/180),0,Math.PI*2);ctx.fill()}
}
function renderWord(){
  wordDisplay.innerHTML='';sequence.forEach((l,i)=>{const s=document.createElement('span');s.className='word-letter '+(i<index?'done':i===index?'active':'');s.textContent=l;wordDisplay.appendChild(s)});
  targetText.textContent=`Sign ${sequence[index]||''}`;letterCount.textContent=`${Math.min(index+1,sequence.length)}/${sequence.length}`;
  const done=results.filter(Boolean);sessionConfidence.textContent=done.length?`Word confidence ${Math.round(avg(done.map(r=>r.confidence)))}%`:'Word confidence —';
}
function accept(conf,motion=false){
  results[index]={letter:sequence[index],confidence:Math.round(conf),motion};holdAt=null;peak=0;holdBar.style.width='100%';feedback.className='feedback good';feedback.textContent=`✓ ${sequence[index]} accepted`;
  if(index>=sequence.length-1){setTimeout(finish,420);return}
  index++;trace=null;traceHold=null;latest=null;cooldown=performance.now()+400;renderWord();setTimeout(()=>holdBar.style.width='0%',300)
}
function updateTrace(l,f){
  const letter=sequence[index],g=guide(letter),tip=l[g.finger],shape=startShape(letter,f),now=performance.now();traceHelp.classList.remove('hidden');traceHelp.textContent=`${letter}: ${letter==='J'?'pinky':'index'} fingertip — stay near the guide and hit the dots in order.`;
  if(!trace||trace.letter!==letter){
    if(shape<.68){traceHold=null;feedback.textContent=letter==='J'?'Make the I handshape first.':'Point your index finger first.';return}
    if(traceDist(tip,g.pts[0])>TRACE_TOL){traceHold=null;feedback.textContent='Move the highlighted fingertip into the green start circle.';return}
    if(traceHold==null)traceHold=now;holdBar.style.width=`${Math.round(clamp((now-traceHold)/180)*100)}%`;if(now-traceHold<180)return;
    trace={letter,next:1,shape};traceHold=null;feedback.textContent='Follow the guide to the next blue checkpoint.';return;
  }
  if(shape<.45){trace=null;holdBar.style.width='0%';feedback.textContent='Keep the starting handshape while tracing. Start again.';return}
  const target=g.pts[trace.next];if(traceDist(tip,target)<=TRACE_TOL){trace.next++;holdBar.style.width=`${Math.round(trace.next/g.pts.length*100)}%`;if(trace.next>=g.pts.length){accept(Math.max(84,Math.round(shape*34+66)),true);trace=null;return}}
  feedback.textContent='Stay close to the guide and reach the next dot. Close is enough — just keep the order.';
}
function updateStatic(f){
  traceHelp.classList.add('hidden');const letter=sequence[index],s=Math.round(clamp(score(letter,f))*100);confidenceEl.textContent=`${s}%`;
  if(performance.now()<cooldown)return;
  if(s<PASS){holdAt=null;peak=0;holdBar.style.width='0%';feedback.className='feedback';feedback.textContent=`Get ${letter} to ${PASS}% and hold it.`;return}
  if(holdAt==null)holdAt=performance.now();peak=Math.max(peak,s);const p=clamp((performance.now()-holdAt)/HOLD_MS);holdBar.style.width=`${Math.round(p*100)}%`;feedback.className='feedback good';feedback.textContent=`Got ${letter} — hold ${(Math.max(0,HOLD_MS-(performance.now()-holdAt))/1000).toFixed(1)}s`;if(p>=1)accept(peak)
}
async function init(){
  WORDS.forEach(w=>{const b=document.createElement('button');b.textContent=w;b.onclick=()=>{selectedWord=w;customWord.value='';[...wordGrid.children].forEach(x=>x.classList.toggle('selected',x===b))};if(w==='NAME')b.classList.add('selected');wordGrid.appendChild(b)});
  startWord.onclick=start;document.getElementById('restartWord').onclick=()=>beginSequence(selectedWord);document.getElementById('newWord').onclick=()=>{stop();cameraCard.classList.add('hidden');resultCard.classList.add('hidden');setup.classList.remove('hidden')};document.getElementById('again').onclick=()=>{resultCard.classList.add('hidden');setup.classList.remove('hidden')};
}
async function start(){
  const typed=customWord.value.toUpperCase().replace(/[^A-Z]/g,'');if(typed)selectedWord=typed;if(!selectedWord)return;
  startWord.disabled=true;startWord.textContent='Starting…';
  try{
    if(!landmarker){cameraBadge.textContent='Loading hand model…';const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');landmarker=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:MODEL_URL,delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.5})}
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:960},height:{ideal:720},frameRate:{ideal:30,max:60}}});video.srcObject=stream;await video.play();setup.classList.add('hidden');resultCard.classList.add('hidden');cameraCard.classList.remove('hidden');beginSequence(selectedWord);resize();loop();cameraBadge.textContent='On-device hand tracking';
  }catch(e){alert(`Could not start camera: ${e.message||e}`);startWord.disabled=false;startWord.textContent='Start camera'}
}
function beginSequence(word){selectedWord=word;sequence=word.split('');index=0;results=[];holdAt=null;peak=0;trace=null;traceHold=null;latest=null;holdBar.style.width='0%';confidenceEl.textContent='—';renderWord()}
function resize(){const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d))}
function loop(){
  if(!stream||!landmarker)return;const now=performance.now();
  if(video.readyState>=2&&video.currentTime!==lastTime){lastTime=video.currentTime;let d;try{d=landmarker.detectForVideo(video,now)}catch{}const l=d?.landmarks?.[0];if(l){latest={l,f:features(l)};drawHand(l);const letter=sequence[index];if(['J','Z'].includes(letter)){confidenceEl.textContent=`${Math.round(startShape(letter,latest.f)*100)}%`;updateTrace(l,latest.f)}else updateStatic(latest.f)}else{latest=null;drawHand(null);holdAt=null;holdBar.style.width='0%';feedback.className='feedback';feedback.textContent='Show your signing hand clearly.'}}
  animation=requestAnimationFrame(loop)
}
function finish(){stop();cameraCard.classList.add('hidden');resultCard.classList.remove('hidden');const s=Math.round(avg(results.map(r=>r.confidence)));resultWord.textContent=selectedWord;resultScore.textContent=`${s}%`;resultCopy.textContent=s>=88?'Strong guided fingerspelling run.':s>=78?'Solid run. Repeat it once and aim for smoother transitions.':'Worth another pass at a comfortable pace.';resultLetters.innerHTML='';results.forEach((r,i)=>{const d=document.createElement('div');d.className='result-row';d.innerHTML=`<b>${r.letter}</b><strong>${r.confidence}%</strong><span>${r.motion?'trace':'handshape'}</span>`;resultLetters.appendChild(d)})}
function stop(){cancelAnimationFrame(animation);stream?.getTracks()?.forEach(t=>t.stop());stream=null}
window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);init();
