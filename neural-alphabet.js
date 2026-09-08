import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MEDIAPIPE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const MODEL_URLS = [
  'https://cdn.jsdelivr.net/gh/mhmdtaha091/SignBridge@master/web/public/models/asl-default/model.json',
  'https://raw.githubusercontent.com/mhmdtaha091/SignBridge/master/web/public/models/asl-default/model.json',
  'https://signbridge-kappa.vercel.app/models/asl-default/model.json',
];

const MODEL_CACHE_KEY = 'aslingo-signbridge-asl-model-v1';

const $ = (id) => document.getElementById(id);
const intro = $('intro');
const cameraCard = $('cameraCard');
const start = $('start');
const stopBtn = $('stop');
const clearBtn = $('clear');
const introError = $('introError');
const errorBox = $('errorBox');
const video = $('camera');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const status = $('status');
const fps = $('fps');
const handMeta = $('handMeta');
const modelMeta = $('modelMeta');
const bigLetter = $('bigLetter');
const bigConfidence = $('bigConfidence');
const stableBar = $('stableBar');
const stableText = $('stableText');
const top3 = $('top3');
const note = $('note');
const historyEl = $('history');

let handLandmarker = null;
let model = null;
let stream = null;
let animation = 0;
let lastVideoTime = -1;
let lastFrameAt = performance.now();
let fpsEma = 0;
let lastInferAt = 0;

let smoothProbs = null;
let labelHistory = [];
let stableLabel = null;
let stableSince = 0;
let lastCommitted = null;
let history = [];

/* ---------- SignBridge model loading ---------- */

async function fetchModelJson() {
  const cached = localStorage.getItem(MODEL_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      validateModel(parsed);
      return parsed;
    } catch {
      localStorage.removeItem(MODEL_CACHE_KEY);
    }
  }

  let lastError = null;
  for (const url of MODEL_URLS) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = JSON.parse(text);
      validateModel(parsed);
      try {
        localStorage.setItem(MODEL_CACHE_KEY, text);
      } catch {
        // Cache is only a convenience.
      }
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn('ASLingo model source failed:', url, err);
    }
  }
  throw new Error(`Could not load the SignBridge ASL model. ${lastError?.message || ''}`.trim());
}

function validateModel(m) {
  if (!m || m.featureSize !== 63) throw new Error('Unexpected SignBridge feature size.');
  if (!Array.isArray(m.labels) || m.labels.length !== 24) throw new Error('Unexpected SignBridge label set.');
  if (!Array.isArray(m.weights) || m.weights.length !== 6) throw new Error('Unexpected SignBridge weight layout.');
  if (m.labels.includes('J') || m.labels.includes('Z')) throw new Error('Static model unexpectedly includes motion letters.');

  const [k1, b1, k2, b2, k3, b3] = m.weights;
  if (k1.length !== 63 || b1.length !== 128) throw new Error('Layer 1 dimensions do not match.');
  if (k2.length !== 128 || b2.length !== 64) throw new Error('Layer 2 dimensions do not match.');
  if (k3.length !== 64 || b3.length !== 24) throw new Error('Output layer dimensions do not match.');
}

function prepareModel(m) {
  const [k1, b1, k2, b2, k3, b3] = m.weights;
  return {
    labels: m.labels.slice(),
    valAccuracy: Number(m.valAccuracy || 0),
    k1: k1.map((row) => Float32Array.from(row)),
    b1: Float32Array.from(b1),
    k2: k2.map((row) => Float32Array.from(row)),
    b2: Float32Array.from(b2),
    k3: k3.map((row) => Float32Array.from(row)),
    b3: Float32Array.from(b3),
  };
}

/*
  Exact forward-pass shape used by SignBridge's bundled starter MLP:
  63 -> Dense(128, ReLU) -> Dropout(training only) ->
  Dense(64, ReLU) -> Dense(24, Softmax).

  We compute the inference math directly instead of using TFLite/LiteRT.
  That removes the model-runtime compatibility problem we hit on iPad.
*/
function dense(input, kernel, bias, relu) {
  const out = new Float32Array(bias.length);
  for (let j = 0; j < bias.length; j++) {
    let sum = bias[j];
    for (let i = 0; i < input.length; i++) sum += input[i] * kernel[i][j];
    out[j] = relu && sum < 0 ? 0 : sum;
  }
  return out;
}

function softmax(logits) {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  const out = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  const denom = sum || 1;
  for (let i = 0; i < out.length; i++) out[i] /= denom;
  return out;
}

function predictFeatures(features) {
  const h1 = dense(features, model.k1, model.b1, true);
  const h2 = dense(h1, model.k2, model.b2, true);
  const logits = dense(h2, model.k3, model.b3, false);
  return softmax(logits);
}

/* ---------- SignBridge-compatible landmark normalization ---------- */

function normalizeHand(landmarks, handedness) {
  if (!landmarks || landmarks.length !== 21) throw new Error('Expected 21 hand landmarks.');

  const wrist = landmarks[0];
  const mcp = landmarks[9];
  const scale = Math.hypot(
    mcp.x - wrist.x,
    mcp.y - wrist.y,
    mcp.z - wrist.z,
  );
  const s = scale > 1e-6 ? scale : 1;
  const mirror = handedness === 'Left' ? -1 : 1;

  const out = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = ((landmarks[i].x - wrist.x) / s) * mirror;
    out[i * 3 + 1] = (landmarks[i].y - wrist.y) / s;
    out[i * 3 + 2] = (landmarks[i].z - wrist.z) / s;
  }
  return out;
}

/* ---------- UI / smoothing ---------- */

function rankedPredictions(probs) {
  return model.labels
    .map((letter, i) => ({ letter, confidence: probs[i] }))
    .sort((a, b) => b.confidence - a.confidence);
}

function smooth(probabilities) {
  // An EMA makes a single bad MediaPipe frame less visually disruptive.
  const alpha = 0.38;
  if (!smoothProbs) {
    smoothProbs = Float32Array.from(probabilities);
  } else {
    for (let i = 0; i < probabilities.length; i++) {
      smoothProbs[i] = smoothProbs[i] * (1 - alpha) + probabilities[i] * alpha;
    }
  }
  return smoothProbs;
}

function renderPrediction(probabilities) {
  const ranked = rankedPredictions(smooth(probabilities));
  const first = ranked[0];
  const second = ranked[1];
  const now = performance.now();

  labelHistory.push({ t: now, label: first.letter });
  labelHistory = labelHistory.filter((x) => now - x.t < 600);

  const same = labelHistory.filter((x) => x.label === first.letter).length;
  const stability = labelHistory.length ? same / labelHistory.length : 0;
  const margin = first.confidence - second.confidence;

  bigLetter.textContent = first.letter;
  bigConfidence.textContent =
    `${Math.round(first.confidence * 100)}% model confidence · ` +
    `${Math.round(margin * 100)} pt lead`;

  stableBar.style.width = `${Math.round(stability * 100)}%`;
  stableText.textContent = `${Math.round(stability * 100)}%`;

  top3.innerHTML = '';
  ranked.slice(0, 3).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = `predCard ${i === 0 ? 'first' : ''}`;
    d.innerHTML = `<b>${p.letter}</b><span>${Math.round(p.confidence * 100)}%</span>`;
    top3.appendChild(d);
  });

  const commitReady =
    first.confidence >= 0.55 &&
    margin >= 0.08 &&
    stability >= 0.78 &&
    labelHistory.length >= 4;

  if (commitReady) {
    if (stableLabel !== first.letter) {
      stableLabel = first.letter;
      stableSince = now;
    }

    if (now - stableSince >= 260 && lastCommitted !== first.letter) {
      lastCommitted = first.letter;
      history.unshift({
        letter: first.letter,
        confidence: first.confidence,
        margin,
        time: new Date(),
      });
      history = history.slice(0, 14);
      renderHistory();
    }

    note.textContent =
      `Stable guess: ${first.letter}. ` +
      `Change to another handshape and watch whether the prediction changes with you.`;
  } else {
    if (stableLabel !== first.letter) {
      stableLabel = first.letter;
      stableSince = now;
    }
    if (lastCommitted && first.letter !== lastCommitted) lastCommitted = null;

    if (first.confidence < 0.40) {
      note.textContent = 'The model is genuinely unsure. Keep your whole hand visible and sign naturally.';
    } else if (margin < 0.08) {
      note.textContent = `${first.letter} and ${second.letter} are close. That ambiguity is useful data — don't contort your hand to force a pass.`;
    } else {
      note.textContent = 'Hold the handshape naturally for a moment so the prediction can stabilize.';
    }
  }
}

function renderHistory() {
  historyEl.innerHTML = '';
  if (!history.length) {
    historyEl.innerHTML = '<p class="fine">No stable predictions yet.</p>';
    return;
  }

  history.forEach((x) => {
    const d = document.createElement('div');
    d.className = 'historyRow';
    d.innerHTML =
      `<b>${x.letter}</b>` +
      `<strong>${Math.round(x.confidence * 100)}% confidence · ${Math.round(x.margin * 100)} pt lead</strong>` +
      `<span>${x.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>`;
    historyEl.appendChild(d);
  });
}

function clearPrediction() {
  smoothProbs = null;
  labelHistory = [];
  stableLabel = null;
  stableSince = 0;
  lastCommitted = null;
  bigLetter.textContent = '—';
  bigConfidence.textContent = 'Show your signing hand';
  stableBar.style.width = '0%';
  stableText.textContent = '—';
  top3.innerHTML = '';
}

/* ---------- Camera + MediaPipe ---------- */

function drawHand(landmarks) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;

  ctx.lineWidth = Math.max(2, w / 360);
  ctx.strokeStyle = 'rgba(74,171,255,.95)';
  for (const c of HandLandmarker.HAND_CONNECTIONS || []) {
    const a = landmarks[c.start];
    const b = landmarks[c.end];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }

  ctx.fillStyle = '#fff';
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(2.5, w / 250), 0, Math.PI * 2);
    ctx.fill();
  }
}

async function loadRecognition() {
  status.textContent = 'Loading neural model…';
  const raw = await fetchModelJson();
  model = prepareModel(raw);
  modelMeta.textContent =
    `SignBridge · ${model.labels.length} letters · ${Math.round(model.valAccuracy * 1000) / 10}% held-out`;

  status.textContent = 'Loading MediaPipe…';
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MEDIAPIPE_MODEL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  status.textContent = 'Model ready';
}

async function begin() {
  introError.classList.add('hidden');
  introError.textContent = '';
  start.disabled = true;
  start.textContent = 'Loading recognition…';

  try {
    if (!model || !handLandmarker) await loadRecognition();

    start.textContent = 'Requesting camera…';
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 540 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30, max: 60 },
      },
    });

    video.srcObject = stream;
    await video.play();

    intro.classList.add('hidden');
    cameraCard.classList.remove('hidden');
    resizeCanvas();
    status.textContent = 'Neural recognition running';
    lastFrameAt = performance.now();
    loop();
  } catch (err) {
    console.error(err);
    introError.classList.remove('hidden');
    introError.textContent = `Could not start: ${err?.message || err}`;
    start.disabled = false;
    start.textContent = 'Try again';
  }
}

function processFrame(now) {
  let result;
  try {
    result = handLandmarker.detectForVideo(video, now);
  } catch (err) {
    errorBox.classList.remove('hidden');
    errorBox.textContent = `MediaPipe error: ${err?.message || err}`;
    return;
  }

  const landmarks = result?.landmarks?.[0];
  const category = result?.handedness?.[0]?.[0];
  if (!landmarks) {
    drawHand(null);
    clearPrediction();
    handMeta.textContent = 'Waiting for hand…';
    note.textContent = 'Keep the full signing hand in frame.';
    return;
  }

  drawHand(landmarks);

  const handedness = category?.categoryName || 'Right';
  const handScore = Number(category?.score || 0);
  handMeta.textContent =
    `Tracker: ${handedness} · ${Math.round(handScore * 100)}% handedness confidence`;

  // Match SignBridge's live + training normalization exactly.
  const features = normalizeHand(landmarks, handedness);
  const probs = predictFeatures(features);
  renderPrediction(probs);
}

function loop() {
  if (!stream || !handLandmarker) return;

  animation = requestAnimationFrame(loop);

  const now = performance.now();
  const dt = now - lastFrameAt;
  lastFrameAt = now;
  if (dt > 0) {
    const instant = 1000 / dt;
    fpsEma = fpsEma ? fpsEma * 0.9 + instant * 0.1 : instant;
    fps.textContent = `${Math.round(fpsEma)} fps`;
  }

  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  // SignBridge's MLP is very fast; MediaPipe is the expensive part.
  // ~20 inference updates/sec is more than enough for visual feedback.
  if (now - lastInferAt < 50) return;
  lastInferAt = now;

  processFrame(now);
}

function resizeCanvas() {
  const r = video.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
}

function stopCamera() {
  cancelAnimationFrame(animation);
  stream?.getTracks()?.forEach((t) => t.stop());
  stream = null;
  clearPrediction();
  cameraCard.classList.add('hidden');
  intro.classList.remove('hidden');
  start.disabled = false;
  start.textContent = 'Start neural camera';
}

start.addEventListener('click', begin);
stopBtn.addEventListener('click', stopCamera);
clearBtn.addEventListener('click', () => {
  history = [];
  renderHistory();
});
window.addEventListener('resize', resizeCanvas);
window.addEventListener('pagehide', stopCamera);

renderHistory();
