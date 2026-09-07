ASLingo Local Camera Alphabet - Final Beta v3

Replace:
- local-camera.html
- local-camera.css
- local-camera.js

No package/vite changes are needed if MediaPipe beta is already deployed.

Alphabet behavior:
- Camera may be on without scoring.
- Tap START CHECKING to begin.
- Static letters auto-advance after staying above the chosen confidence threshold
  for the selected hold time.
- Default is 80% for 0.8 seconds.
- Confidence dropping below threshold resets the hold timer.

J / Z:
- They no longer use generic "amount of movement" scoring.
- J gets a visible J stencil and tracks LANDMARK 20 (pinky tip).
- Z gets a visible Z stencil and tracks LANDMARK 8 (index tip).
- The correct starting handshape is required before tracing begins.
- The fingertip must enter the start circle, then hit every checkpoint IN ORDER.
- Random waving cannot satisfy the ordered checkpoint trace.
- Dropping the required handshape or taking too long resets the trace.
- J/Z auto-advance immediately after a successful ordered trace.

Calibration:
- Old v1 teaching data is ignored by using a fresh calibration storage key.
- Calibration is allowed only for subtle A/E/M/N/S/T handshapes.
- Only one current calibration is kept per subtle letter.
- Calibration contributes only a small correction and cannot manufacture a pass.

This is the version to finish testing before wiring Camera Alphabet Check into
the end of the normal Alphabet lesson sequence.
