import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { neon } from './neon.js';

const MEDIAPIPE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const MODEL_URLS = [
  'https://cdn.jsdelivr.net/gh/mhmdtaha091/SignBridge@master/web/public/models/asl-default/model.json',
  'https://raw.githubusercontent.com/mhmdtaha091/SignBridge/master/web/public/models/asl-default/model.json',
  'https://signbridge-kappa.vercel.app/models/asl-default/model.json',
];

const MODEL_CACHE_KEY = 'aslingo-signbridge-asl-model-v1';
const LOCAL_MEMORY_KEY = 'aslingo-recognition-local-memory-v1';
const MODEL_VERSION = 'signbridge-static-v2+aslingo-live-memory-v1';
const STATIC_LABELS = 'ABCDEFGHIKLMNOPQRSTUVWXY'.split('');
const SESSION_ID = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
const recognitionSignal = $('recognitionSignal');
const stableBar = $('stableBar');
const stableText = $('stableText');
const top3 = $('top3');
const note = $('note');
const historyEl = $('history');
const feedbackPanel = $('feedbackPanel');
const confirmBtn = $('confirmBtn');
const changeBtn = $('changeBtn');
const letterPicker = $('letterPicker');
const letterGrid = $('letterGrid');
const closePicker = $('closePicker');
const localCount = $('localCount');
const communityCount = $('communityCount');
const assistState = $('assistState');
const toast = $('toast');

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

let featureWindow = [];
let baseProbWindow = [];
let currentSnapshot = null;
let currentHandedness = 'Right';
let currentTrackingScore = 0;

let appUser = null;
let backendReady = false;
let localSamples = loadLocalSamples();
let communitySamples = [];
let lastCommunityLoad = 0;
let communityTimer = null;

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function loadLocalSamples() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_MEMORY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x) => STATIC_LABELS.includes(x.label) && Array.isArray(x.features) && x.features.length === 63)
      .slice(0, 250);
  } catch {
    return [];
  }
}

function saveLocalSamples() {
  try { localStorage.setItem(LOCAL_MEMORY_KEY, JSON.stringify(localSamples.slice(0, 250))); } catch {}
}

function detectDeviceInfo() {
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints || 0;
  const isiPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touch > 1);
  const isiPhone = /iPhone/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  let deviceClass = 'desktop';
  if (isiPad) deviceClass = 'tablet-ios';
  else if (isiPhone) deviceClass = 'phone-ios';
  else if (isAndroid && /Mobile/i.test(ua)) deviceClass = 'phone-android';
  else if (isAndroid) deviceClass = 'tablet-android';

  let browser = 'browser';
  if (/CriOS/i.test(ua)) browser = 'chrome-ios';
  else if (/FxiOS/i.test(ua)) browser = 'firefox-ios';
  else if (/EdgiOS/i.test(ua)) browser = 'edge-ios';
  else if (/Safari/i.test(ua) && /Version/i.test(ua)) browser = 'safari';
  else if (/Chrome/i.test(ua)) browser = 'chrome';

  return {
    deviceClass,
    platform: navigator.platform || navigator.userAgentData?.platform || 'unknown',
    browser,
  };
}

function averageVectors(rows) {
  if (!rows.length) return null;
  const n = rows[0].length;
  const out = new Float32Array(n);
  for (const row of rows) for (let i = 0; i < n; i++) out[i] += Number(row[i] || 0);
  for (let i = 0; i < n; i++) out[i] /= rows.length;
  return out;
}

function rmse(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Number(a[i]) - Number(b[i]);
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

function normalizeDistribution(arr) {
  let s = 0;
  for (const v of arr) s += v;
  if (!s) return arr;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / s;
  return out;
}

function blend(a, b, strength) {
  const out = new Float32Array(a.length);
  const w = clamp(strength);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - w) + b[i] * w;
  return normalizeDistribution(out);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

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
      try { localStorage.setItem(MODEL_CACHE_KEY, text); } catch {}
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
  return softmax(dense(h2, model.k3, model.b3, false));
}

function normalizeHand(landmarks, handedness) {
  if (!landmarks || landmarks.length !== 21) throw new Error('Expected 21 hand landmarks.');
  const wrist = landmarks[0];
  const mcp = landmarks[9];
  const scale = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, mcp.z - wrist.z);
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

function voteFromSamples(samples, features, { community = false } = {}) {
  if (!samples.length) return null;
  const device = detectDeviceInfo().deviceClass;
  const near = [];

  for (const sample of samples) {
    if (!STATIC_LABELS.includes(sample.label) || !Array.isArray(sample.features) || sample.features.length !== 63) continue;
    const distance = rmse(features, sample.features);
    if (!Number.isFinite(distance) || distance > 0.42) continue;

    let weight = Math.exp(-(distance * distance) / (2 * 0.18 * 0.18));
    weight *= clamp(Number(sample.sample_quality ?? sample.quality ?? 0.85), 0.35, 1);
    if (sample.device_class && sample.device_class === device) weight *= 1.08;
    near.push({ ...sample, distance, weight });
  }

  near.sort((a, b) => a.distance - b.distance);
  const chosen = near.slice(0, community ? 12 : 8);
  if (!chosen.length) return null;

  const scores = new Map();
  const contributors = new Map();
  const counts = new Map();

  for (const row of chosen) {
    scores.set(row.label, (scores.get(row.label) || 0) + row.weight);
    counts.set(row.label, (counts.get(row.label) || 0) + 1);
    if (community && row.contributor_token) {
      if (!contributors.has(row.label)) contributors.set(row.label, new Set());
      contributors.get(row.label).add(row.contributor_token);
    }
  }

  const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner) return null;

  const distribution = new Float32Array(model.labels.length);
  for (const [label, score] of scores.entries()) {
    const idx = model.labels.indexOf(label);
    if (idx >= 0) distribution[idx] = score;
  }

  const winnerLabel = winner[0];
  return {
    distribution: normalizeDistribution(distribution),
    winnerLabel,
    winnerCount: counts.get(winnerLabel) || 0,
    uniqueContributors: community ? (contributors.get(winnerLabel)?.size || 0) : 1,
    bestDistance: chosen[0].distance,
    neighbors: chosen,
  };
}

function applyAdaptiveMemory(baseProbs, features) {
  let finalProbs = Float32Array.from(baseProbs);
  let personalStrength = 0;
  let communityStrength = 0;
  const personalVote = voteFromSamples(localSamples, features);

  if (personalVote && personalVote.bestDistance < 0.32) {
    personalStrength = clamp((0.34 - personalVote.bestDistance) / 0.22, 0, 1) * 0.48;
    if (personalVote.winnerCount >= 2) personalStrength = Math.min(0.55, personalStrength + 0.07);
    finalProbs = blend(finalProbs, personalVote.distribution, personalStrength);
  }

  const candidateCommunity = voteFromSamples(communitySamples, features, { community: true });
  const communityCorroborated =
    candidateCommunity &&
    candidateCommunity.bestDistance < 0.32 &&
    candidateCommunity.winnerCount >= 3 &&
    candidateCommunity.uniqueContributors >= 2;

  const communityVote = communityCorroborated ? candidateCommunity : null;
  if (communityVote) {
    communityStrength = clamp((0.34 - communityVote.bestDistance) / 0.20, 0, 1) * 0.34;
    if (communityVote.uniqueContributors >= 3) communityStrength = Math.min(0.42, communityStrength + 0.06);
    finalProbs = blend(finalProbs, communityVote.distribution, communityStrength);
  }

  return { probs: finalProbs, personalStrength, communityStrength, personalVote, communityVote };
}

async function resolveUser() {
  try {
    const result = await neon.auth.getSession();
    appUser = result?.data?.user || result?.user || null;
  } catch {
    appUser = null;
  }
  return appUser;
}

async function loadCommunitySamples(force = false) {
  if (!appUser) {
    communityCount.textContent = 'Sign in to share';
    return;
  }
  if (!force && Date.now() - lastCommunityLoad < 15000) return;
  lastCommunityLoad = Date.now();

  try {
    const res = await neon
      .from('recognition_community_samples')
      .select('id,contributor_token,label,predicted_label,feedback_kind,features,sample_quality,device_class,model_version,created_at')
      .order('created_at', { ascending: false })
      .limit(1200);
    if (res.error) throw res.error;

    communitySamples = (res.data || [])
      .filter((x) => STATIC_LABELS.includes(x.label) && Array.isArray(x.features) && x.features.length === 63)
      .map((x) => ({ ...x, features: x.features.map(Number) }));

    backendReady = true;
    communityCount.textContent = `${communitySamples.length} shared`;
    renderLearningMeta();
  } catch (err) {
    backendReady = false;
    communityCount.textContent = 'Backend not active';
    console.warn('Community recognition memory unavailable:', err);
  }
}

function scoresObject(probabilities) {
  const obj = {};
  model.labels.forEach((label, i) => { obj[label] = Number(probabilities[i] || 0); });
  return obj;
}

async function saveFeedback(actualLabel, feedbackKind) {
  const snap = currentSnapshot;
  if (!snap || !STATIC_LABELS.includes(actualLabel)) {
    showToast('Hold a steady handshape first.');
    return;
  }

  const localRow = {
    label: actualLabel,
    features: Array.from(snap.features),
    quality: snap.sampleQuality,
    sample_quality: snap.sampleQuality,
    device_class: detectDeviceInfo().deviceClass,
    created_at: new Date().toISOString(),
  };

  localSamples.unshift(localRow);
  localSamples = localSamples.slice(0, 250);
  saveLocalSamples();
  renderLearningMeta();

  const wasRight = actualLabel === snap.predictedLabel;
  showToast(wasRight ? `Saved: this is ${actualLabel}. ASLingo will remember this handshape.` : `Learned correction: ${snap.predictedLabel} → ${actualLabel}.`);

  const adapted = applyAdaptiveMemory(snap.baseProbs, snap.features);
  renderPrediction(adapted.probs, snap.baseProbs, snap.features, snap.stability, adapted);

  if (!appUser) {
    showToast(`Saved on this device. Sign in to add it to ASLingo's shared training memory.`);
    return;
  }

  const device = detectDeviceInfo();
  const payload = {
    user_id: appUser.id,
    session_id: SESSION_ID,
    model_version: MODEL_VERSION,
    feedback_kind: feedbackKind,
    predicted_label: snap.predictedLabel,
    actual_label: actualLabel,
    features: Array.from(snap.features),
    model_scores: scoresObject(snap.baseProbs),
    predicted_score: snap.predictedScore,
    predicted_margin: snap.predictedMargin,
    handedness: snap.handedness,
    tracking_score: snap.trackingScore,
    sample_quality: snap.sampleQuality,
    device_class: device.deviceClass,
    platform: device.platform,
    browser_family: device.browser,
    camera_width: video.videoWidth || null,
    camera_height: video.videoHeight || null,
    aspect_ratio: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : null,
  };

  try {
    const res = await neon.from('recognition_feedback').insert(payload).select('id');
    if (res.error) throw res.error;
    backendReady = true;
    await loadCommunitySamples(true);
    showToast(wasRight ? `Saved: ${actualLabel}. Added to shared ASLingo training memory.` : `Correction saved globally: ${snap.predictedLabel} → ${actualLabel}.`);
  } catch (err) {
    backendReady = false;
    console.warn('Could not save global recognition feedback:', err);
    showToast(`Saved on this device. Shared learning database is not active yet.`);
  }
}

function rankedPredictions(probs) {
  return model.labels
    .map((letter, i) => ({ letter, score: Number(probs[i] || 0) }))
    .sort((a, b) => b.score - a.score);
}

function smooth(probabilities) {
  const alpha = 0.38;
  if (!smoothProbs) smoothProbs = Float32Array.from(probabilities);
  else for (let i = 0; i < probabilities.length; i++) smoothProbs[i] = smoothProbs[i] * (1 - alpha) + probabilities[i] * alpha;
  return smoothProbs;
}

function recognitionWord(first, second, stability) {
  const margin = first.score - second.score;
  if (first.score >= 0.72 && margin >= 0.18 && stability >= 0.75) return 'Strong';
  if (first.score >= 0.48 && margin >= 0.08 && stability >= 0.58) return 'Moderate';
  return 'Uncertain';
}

function renderPrediction(probabilities, baseProbs, features, suppliedStability = null, memoryInfo = null) {
  const smoothed = smooth(probabilities);
  const ranked = rankedPredictions(smoothed);
  const first = ranked[0];
  const second = ranked[1];
  const now = performance.now();

  labelHistory.push({ t: now, label: first.letter });
  labelHistory = labelHistory.filter((x) => now - x.t < 650);
  const same = labelHistory.filter((x) => x.label === first.letter).length;
  const stability = suppliedStability ?? (labelHistory.length ? same / labelHistory.length : 0);
  const margin = first.score - second.score;

  bigLetter.textContent = first.letter;
  recognitionSignal.textContent = `${recognitionWord(first, second, stability)} recognition · ${Math.round(margin * 100)} pt lead`;
  stableBar.style.width = `${Math.round(stability * 100)}%`;
  stableText.textContent = `${Math.round(stability * 100)}%`;

  top3.innerHTML = '';
  ranked.slice(0, 3).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = `predCard ${i === 0 ? 'first' : ''}`;
    d.innerHTML = `<b>${p.letter}</b><span>${Math.round(p.score * 100)} model score</span>`;
    top3.appendChild(d);
  });

  feedbackPanel.classList.remove('hidden');
  confirmBtn.textContent = `✓ This is ${first.letter}`;

  const baseRanked = rankedPredictions(baseProbs || probabilities);
  const baseFirst = baseRanked[0];
  let assist = 'Base model';
  if (memoryInfo?.communityStrength > 0.02 && memoryInfo?.communityVote) assist = `Community assist: ${memoryInfo.communityVote.winnerLabel}`;
  else if (memoryInfo?.personalStrength > 0.02 && memoryInfo?.personalVote) assist = `Device memory: ${memoryInfo.personalVote.winnerLabel}`;
  assistState.textContent = assist;

  const sampleQuality = clamp(currentTrackingScore * 0.55 + stability * 0.45, 0, 1);
  currentSnapshot = {
    features: Float32Array.from(features),
    baseProbs: Float32Array.from(baseProbs || probabilities),
    finalProbs: Float32Array.from(probabilities),
    predictedLabel: first.letter,
    basePredictedLabel: baseFirst.letter,
    predictedScore: first.score,
    predictedMargin: margin,
    handedness: currentHandedness,
    trackingScore: currentTrackingScore,
    stability,
    sampleQuality,
  };

  const commitReady = first.score >= 0.52 && margin >= 0.07 && stability >= 0.74 && labelHistory.length >= 4;
  if (commitReady) {
    if (stableLabel !== first.letter) { stableLabel = first.letter; stableSince = now; }
    if (now - stableSince >= 260 && lastCommitted !== first.letter) {
      lastCommitted = first.letter;
      history.unshift({ letter: first.letter, signal: recognitionWord(first, second, stability), margin, time: new Date() });
      history = history.slice(0, 14);
      renderHistory();
    }
  } else if (stableLabel !== first.letter) {
    stableLabel = first.letter;
    stableSince = now;
  }

  note.textContent = recognitionWord(first, second, stability) === 'Uncertain'
    ? `${first.letter} and ${second.letter} are not cleanly separated. If you know what you signed, this is an especially useful training example.`
    : `ASLingo's current guess is ${first.letter}. Confirm it or correct it while your hand is still in position.`;
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
    d.innerHTML = `<b>${x.letter}</b><strong>${x.signal} · ${Math.round(x.margin * 100)} pt lead</strong><span>${x.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>`;
    historyEl.appendChild(d);
  });
}

function renderLearningMeta() {
  localCount.textContent = `${localSamples.length} example${localSamples.length === 1 ? '' : 's'}`;
  if (backendReady) communityCount.textContent = `${communitySamples.length} shared`;
}

function clearPrediction() {
  smoothProbs = null;
  labelHistory = [];
  stableLabel = null;
  stableSince = 0;
  lastCommitted = null;
  currentSnapshot = null;
  featureWindow = [];
  baseProbWindow = [];
  bigLetter.textContent = '—';
  recognitionSignal.textContent = 'Show your signing hand';
  stableBar.style.width = '0%';
  stableText.textContent = '—';
  top3.innerHTML = '';
  feedbackPanel.classList.add('hidden');
  letterPicker.classList.add('hidden');
  assistState.textContent = 'Base model';
}

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
  model = prepareModel(await fetchModelJson());
  modelMeta.textContent = `SignBridge · ${model.labels.length} letters · ${Math.round(model.valAccuracy * 1000) / 10}% held-out`;
  status.textContent = 'Loading MediaPipe…';
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate: 'GPU' },
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
    await resolveUser();
    if (!model || !handLandmarker) await loadRecognition();
    start.textContent = 'Requesting camera…';
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30, max: 60 } },
    });
    video.srcObject = stream;
    await video.play();
    intro.classList.add('hidden');
    cameraCard.classList.remove('hidden');
    resizeCanvas();
    renderLearningMeta();
    status.textContent = 'Live learning recognition';
    lastFrameAt = performance.now();
    loadCommunitySamples(true);
    communityTimer = setInterval(() => loadCommunitySamples(true), 45000);
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
  try { result = handLandmarker.detectForVideo(video, now); }
  catch (err) {
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
  currentHandedness = category?.categoryName || 'Right';
  currentTrackingScore = Number(category?.score || 0);
  handMeta.textContent = `Tracker: ${currentHandedness} · ${Math.round(currentTrackingScore * 100)}% handedness signal`;

  const features = normalizeHand(landmarks, currentHandedness);
  const baseProbs = predictFeatures(features);
  featureWindow.push({ t: now, value: Array.from(features) });
  baseProbWindow.push({ t: now, value: Array.from(baseProbs) });
  featureWindow = featureWindow.filter((x) => now - x.t < 420);
  baseProbWindow = baseProbWindow.filter((x) => now - x.t < 420);

  const avgFeatures = averageVectors(featureWindow.slice(-8).map((x) => x.value)) || features;
  const avgBase = averageVectors(baseProbWindow.slice(-8).map((x) => x.value)) || baseProbs;
  const normalizedBase = normalizeDistribution(avgBase);
  const adapted = applyAdaptiveMemory(normalizedBase, avgFeatures);
  renderPrediction(adapted.probs, normalizedBase, avgFeatures, null, adapted);
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
  clearInterval(communityTimer);
  communityTimer = null;
  stream?.getTracks()?.forEach((t) => t.stop());
  stream = null;
  clearPrediction();
  cameraCard.classList.add('hidden');
  intro.classList.remove('hidden');
  start.disabled = false;
  start.textContent = 'Start neural camera';
}

function buildLetterPicker() {
  letterGrid.innerHTML = '';
  STATIC_LABELS.forEach((letter) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = letter;
    b.addEventListener('click', async () => {
      letterPicker.classList.add('hidden');
      await saveFeedback(letter, letter === currentSnapshot?.predictedLabel ? 'confirmed' : 'corrected');
    });
    letterGrid.appendChild(b);
  });
}

confirmBtn.addEventListener('click', async () => {
  if (!currentSnapshot?.predictedLabel) return;
  await saveFeedback(currentSnapshot.predictedLabel, 'confirmed');
});
changeBtn.addEventListener('click', () => { if (currentSnapshot) letterPicker.classList.remove('hidden'); });
closePicker.addEventListener('click', () => letterPicker.classList.add('hidden'));
start.addEventListener('click', begin);
stopBtn.addEventListener('click', stopCamera);
clearBtn.addEventListener('click', () => {
  history = [];
  renderHistory();
  showToast('Recent prediction history cleared. Training memory was kept.');
});
window.addEventListener('resize', resizeCanvas);
window.addEventListener('pagehide', stopCamera);

buildLetterPicker();
renderHistory();
renderLearningMeta();
