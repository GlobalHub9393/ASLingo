function makePracticeIcon(){
  const icon=document.createElement('span');
  icon.textContent='✋';
  icon.style.fontSize='20px';
  icon.style.lineHeight='22px';
  return icon;
}

function addPracticeTab(){
  const nav=document.querySelector('.bottom-nav');
  if(!nav || nav.querySelector('.aslingo-practice-tab')) return;

  nav.style.gridTemplateColumns='repeat(5,1fr)';
  const button=document.createElement('button');
  button.type='button';
  button.className='aslingo-practice-tab';
  button.appendChild(makePracticeIcon());
  const label=document.createElement('span');
  label.textContent='Practice';
  button.appendChild(label);
  button.addEventListener('click',()=>{ location.href='/practice.html'; });
  nav.appendChild(button);
}

function addAlphabetCameraFinish(){
  const modal=document.querySelector('.modal-screen');
  if(!modal) return;
  const small=modal.querySelector('.modal-bar small');
  const title=modal.querySelector('.modal-bar b');
  const result=modal.querySelector('.result-card');
  if(!small || !title || !result) return;

  // Only after the FINAL alphabet lesson, U-Z.
  if(small.textContent.trim()!=='Alphabet' || title.textContent.trim()!=='U-Z') return;
  if(result.querySelector('.alphabet-camera-finish')) return;

  const button=document.createElement('button');
  button.type='button';
  button.className='secondary-button alphabet-camera-finish';
  button.style.marginTop='10px';
  button.innerHTML='✋ Camera Alphabet Check <span style="font-size:10px;font-weight:900;background:#eaf2ff;color:#2469cf;padding:4px 7px;border-radius:999px">BETA</span>';
  button.addEventListener('click',()=>{ location.href='/local-camera.html'; });
  result.appendChild(button);

  const note=document.createElement('p');
  note.className='tiny-note alphabet-camera-finish-note';
  note.style.marginBottom='0';
  note.textContent='Optional: run the on-device A–Z hand tracker before moving on.';
  result.appendChild(note);
}

function scanPracticeEnhancements(){
  addPracticeTab();
  addAlphabetCameraFinish();
}

const observer=new MutationObserver(scanPracticeEnhancements);
observer.observe(document.documentElement,{childList:true,subtree:true});
scanPracticeEnhancements();
