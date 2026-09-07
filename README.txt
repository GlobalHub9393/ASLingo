ASLingo Local Camera Practice Beta

This is a SEPARATE proof-of-concept. It does not change the main course, Gemini camera beta,
dictionary, media audit, progress, friends, or Neon.

REPLACE:
- package.json
- vite.config.js

ADD:
- local-camera.html
- local-camera.js
- local-camera.css

After Cloudflare deploys, open:
https://aslingo.pages.dev/local-camera.html

What it does:
- Uses MediaPipe Hand Landmarker 1.0.1 in the browser.
- Tracks 21 landmarks for one hand.
- Camera frames are not uploaded to ASLingo or Gemini.
- Runs a constrained A-Z target checker locally.
- J and Z include short motion-path checks.
- Shows live hand skeleton, target confidence, handshape score, motion score, and tracking confidence.
- Optional "Teach this letter" stores a personalized landmark template in LOCAL browser storage.
- Personal templates are especially useful for subtle A/S/M/N/T handshapes.
- Zero Gemini calls and zero Cloudflare AI requests.

Important:
This is intentionally a proof-of-concept, not a claim of general ASL recognition.
The target-specific rules need tuning from real tests on an iPhone/iPad. That is exactly
what this page is for.
