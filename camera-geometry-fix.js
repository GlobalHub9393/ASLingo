import { HandLandmarker } from '@mediapipe/tasks-vision';

/*
  ASLingo Camera Geometry v3.1

  Why this exists:
  SignBridge's static ASL model was trained from MediaPipe images letterboxed
  to 16:9 specifically because MediaPipe x/y landmarks are normalized by frame
  width/height. A phone camera may return 4:3 even when getUserMedia asks for
  16:9. Feeding that raw 4:3 frame into the model changes the landmark geometry.

  This compatibility layer does two things without changing the neural model:
    1) MediaPipe always receives a 960x540 canonical 16:9 frame.
       Non-16:9 camera feeds are LETTERBOXED, never stretched or cropped.
    2) The phone displays the same canonical 16:9 geometry with object-fit:
       contain, so the blue overlay and the image live in the same coordinates.

  No recognition rules, weights, adaptive-memory thresholds, feedback behavior,
  or Neon code are changed here.
*/

const TARGET_W = 960;
const TARGET_H = 540;
const TARGET_ASPECT = TARGET_W / TARGET_H;

const video = document.getElementById('camera');
const overlay = document.getElementById('overlay');
const cameraWrap = document.querySelector('.cameraWrap');
const trackerMeta = document.querySelector('.trackerMeta');

const processCanvas = document.createElement('canvas');
processCanvas.width = TARGET_W;
processCanvas.height = TARGET_H;
processCanvas.setAttribute('aria-hidden', 'true');
processCanvas.style.cssText =
  'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none;';
document.body.appendChild(processCanvas);

const processCtx = processCanvas.getContext('2d', {
  alpha: false,
  desynchronized: true,
});

let lastGeometry = null;

// Override the old mobile 4:3/cover behavior. The 16:9 box is intentional:
// it is the exact feature geometry the SignBridge static model was trained on.
const style = document.createElement('style');
style.textContent = `
  .cameraWrap {
    aspect-ratio: 16 / 9 !important;
    height: auto !important;
    background: #000 !important;
  }
  .cameraWrap video {
    object-fit: contain !important;
    object-position: center center !important;
    background: #000 !important;
  }
  .cameraWrap canvas {
    object-fit: fill !important;
    object-position: center center !important;
  }
  .cameraGeometryDiag {
    margin-top: 7px;
    padding: 8px 10px;
    border-radius: 11px;
    background: #f5f7fa;
    color: #66707d;
    font-size: 10px;
    font-weight: 750;
    line-height: 1.35;
  }
  .cameraGeometryDiag strong {
    color: #2b75e8;
  }
`;
document.head.appendChild(style);

const diag = document.createElement('div');
diag.className = 'cameraGeometryDiag';
diag.innerHTML = '<strong>Camera geometry:</strong> waiting for camera…';
if (trackerMeta) trackerMeta.insertAdjacentElement('afterend', diag);

function sourceDimensions(source) {
  const width =
    Number(source?.videoWidth) ||
    Number(source?.naturalWidth) ||
    Number(source?.width) ||
    0;
  const height =
    Number(source?.videoHeight) ||
    Number(source?.naturalHeight) ||
    Number(source?.height) ||
    0;
  return { width, height };
}

function fitLetterbox(width, height) {
  if (!width || !height) {
    return {
      sx: 0, sy: 0, sw: TARGET_W, sh: TARGET_H,
      dx: 0, dy: 0, dw: TARGET_W, dh: TARGET_H,
      sourceAspect: TARGET_ASPECT,
      bars: 'waiting',
    };
  }

  const sourceAspect = width / height;
  const scale = Math.min(TARGET_W / width, TARGET_H / height);
  const dw = width * scale;
  const dh = height * scale;
  const dx = (TARGET_W - dw) / 2;
  const dy = (TARGET_H - dh) / 2;

  let bars = 'none';
  if (dx > 0.5) bars = `${Math.round(dx)}px side bars`;
  else if (dy > 0.5) bars = `${Math.round(dy)}px top/bottom bars`;

  return {
    sx: 0,
    sy: 0,
    sw: width,
    sh: height,
    dx,
    dy,
    dw,
    dh,
    sourceAspect,
    bars,
  };
}

function drawCanonical(source) {
  const { width, height } = sourceDimensions(source);
  if (!width || !height || !processCtx) return false;

  const g = fitLetterbox(width, height);

  processCtx.save();
  processCtx.setTransform(1, 0, 0, 1, 0, 0);
  processCtx.fillStyle = '#000';
  processCtx.fillRect(0, 0, TARGET_W, TARGET_H);
  processCtx.drawImage(
    source,
    g.sx, g.sy, g.sw, g.sh,
    g.dx, g.dy, g.dw, g.dh,
  );
  processCtx.restore();

  lastGeometry = {
    sourceWidth: width,
    sourceHeight: height,
    ...g,
  };
  return true;
}

function ratioLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return '?';
  if (Math.abs(value - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(value - 4 / 3) < 0.02) return '4:3';
  return value.toFixed(3);
}

function updateDiagnostics() {
  if (!video) return;

  const track = video.srcObject?.getVideoTracks?.()[0];
  const settings = track?.getSettings?.() || {};
  const width = video.videoWidth || settings.width || 0;
  const height = video.videoHeight || settings.height || 0;
  const actualAspect =
    width && height
      ? width / height
      : Number(settings.aspectRatio || 0);

  const g = fitLetterbox(width, height);
  const frameRate = settings.frameRate
    ? ` · ${Math.round(settings.frameRate)}fps`
    : '';

  diag.innerHTML =
    `<strong>Camera geometry:</strong> ` +
    `${width || '?'}×${height || '?'} (${ratioLabel(actualAspect)})${frameRate}` +
    ` → 960×540 (16:9) · ${g.bars} · no crop`;

  if (cameraWrap) cameraWrap.style.aspectRatio = `${TARGET_W} / ${TARGET_H}`;

  // The existing app sizes the overlay from the video's CSS box. Trigger a
  // resize after the canonical 16:9 layout has been applied.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

if (video) {
  video.addEventListener('loadedmetadata', updateDiagnostics);
  video.addEventListener('resize', updateDiagnostics);
  video.addEventListener('playing', updateDiagnostics);
}

/*
  Patch the same HandLandmarker class used by neural-alphabet.js.

  The current app calls:
      handLandmarker.detectForVideo(video, timestamp)

  After this patch the exact same call becomes:
      raw phone video
        -> 16:9 letterbox canvas
        -> MediaPipe
        -> SignBridge feature normalization

  HandLandmarker accepts browser image/video sources. The returned normalized
  landmarks therefore correspond to the 960x540 processCanvas, which is also
  the geometry represented by the visible 16:9 camera box.
*/
const originalDetectForVideo = HandLandmarker.prototype.detectForVideo;

if (
  typeof originalDetectForVideo === 'function' &&
  !HandLandmarker.prototype.__aslingoCanonical169Patched
) {
  Object.defineProperty(
    HandLandmarker.prototype,
    '__aslingoCanonical169Patched',
    { value: true, configurable: false, enumerable: false },
  );

  HandLandmarker.prototype.detectForVideo = function patchedDetectForVideo(
    image,
    ...args
  ) {
    if (
      typeof HTMLVideoElement !== 'undefined' &&
      image instanceof HTMLVideoElement &&
      drawCanonical(image)
    ) {
      return originalDetectForVideo.call(this, processCanvas, ...args);
    }

    return originalDetectForVideo.call(this, image, ...args);
  };
}

// Keep the overlay backing store synchronized even when iOS changes viewport
// size after address-bar / orientation changes.
if (cameraWrap && overlay && typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => {
    updateDiagnostics();
  });
  observer.observe(cameraWrap);
}

window.__ASLINGO_CAMERA_GEOMETRY__ = {
  version: '3.1',
  targetWidth: TARGET_W,
  targetHeight: TARGET_H,
  targetAspect: TARGET_ASPECT,
  getLastGeometry: () => lastGeometry,
};
