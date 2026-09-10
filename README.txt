ASLingo Camera Geometry Fix v3.1

REPLACE:
- neural-alphabet.html

ADD:
- neural-alphabet-entry.js
- camera-geometry-fix.js

DO NOT REPLACE:
- neural-alphabet.js
- neural-alphabet.css
- package.json
- vite.config.js
- Neon / database files

WHAT THIS FIXES
The current phone CSS forces the visible camera to 4:3 while the SignBridge
model was specifically trained with MediaPipe input letterboxed to 16:9.
The current video also uses object-fit: cover, which can crop the image while
the landmark canvas still maps 0..1 across the full element.

This build makes the camera pipeline mathematically consistent:

RAW PHONE CAMERA (whatever iOS actually returns)
  -> no stretch
  -> no crop
  -> centered letterbox into 960x540 / 16:9
  -> MediaPipe HandLandmarker
  -> unchanged SignBridge model

The visible phone camera is also 16:9 with object-fit: contain, so it shows the
same geometry that MediaPipe receives. The blue overlay therefore shares the
same normalized coordinate system.

A diagnostic line is added beneath the tracker, for example:
Camera geometry: 1280x960 (4:3) -> 960x540 (16:9) · 120px side bars · no crop

WHY 16:9, NOT "WHATEVER THE PHONE RETURNS"
SignBridge's own training extractor explicitly letterboxes its training images
to 16:9 because MediaPipe normalizes x by width and y by height, which makes
the feature geometry aspect-ratio dependent. Matching the training geometry is
more important than making the camera card fill the phone screen.

THIS BUILD DOES NOT CHANGE
- neural network weights
- recognition thresholds
- A/S/T/M/N logic
- adaptive local memory
- community memory
- feedback / "This is X"
- Neon
- J/Z

TEST ORDER
1. First look ONLY at the overlay:
   - wrist dot should sit on wrist
   - MCP/palm connections should remain in the palm
   - fingertips should land on fingertips
2. Screenshot the diagnostic line.
3. Then test:
   B / L
   A / S / T / M / N
   K / P
   O / C

Do not add lots of corrections until the overlay itself looks trustworthy.
