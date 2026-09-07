ASLingo Local Camera Auto-Check v2

Replace:
- local-camera.html
- local-camera.css
- local-camera.js

No package/vite changes needed if the first MediaPipe beta is already deployed.

What changed:
- Camera can be on without checking.
- New START CHECKING button.
- Default pass rule: >=80% continuously for 0.8 seconds.
- Both confidence threshold and hold time are adjustable on screen.
- When the condition is met, ASLingo automatically accepts the letter and moves to the next one.
- Confidence must stay above threshold continuously; dropping below resets the hold timer.
- J and Z now score the SHAPE of the fingertip trajectory, not just "did the hand move?"
- J requires a stem + hook/turn pattern.
- Z requires two horizontal-ish outer strokes with a diagonal return stroke.
- Calibration is renamed "Calibrate my hand" and appears ONLY for A/E/M/N/S/T.
- One calibration per subtle letter; repeated calibration cannot stack.
- Calibration contributes only 16% of shape confidence, so it cannot make a bad generic handshape pass by itself.
- Partial manual sessions no longer report a misleading all-alphabet average.

Next step after this works:
- Build actual fingerspelling recognition where ASLingo predicts letters in sequence instead of showing the target first.
