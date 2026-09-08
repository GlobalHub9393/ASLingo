ASLingo MediaPipe Comparative Tracker v4

REPLACE
- local-camera.html
- local-camera.js
- fingerspell.js

ADD
- hand-classifier.js

No package.json or Vite changes are needed.

WHAT CHANGED
1. Removed personal calibration / “teach me that I’m right.”
2. Palm-relative 3D landmark normalization:
   - whole-hand rotation and hand size matter much less
   - joint angles and anatomical relationships matter more
3. Every target is compared with its closest lookalikes.
   - A/S/M/N/T/E are a dedicated confusion family
   - T/N/M use thumb position between successive finger lanes
   - U/V/W, G/Q/L, H/U/R, K/P, etc. compete against one another
4. Match confidence is reduced when a lookalike scores almost as well.
   - a high raw fit cannot pass if the nearest competitor is essentially tied
5. Fast pass:
   - >=95 match confidence
   - >=10 point lead over closest lookalike
   - stable geometry
   - ~150 ms / a few good frames, not one frame
6. Normal pass:
   - 90-94 gets a shorter hold
   - 82-89 uses the normal hold
   - brief bad frames get a grace period instead of resetting immediately
7. Transition suppression:
   - palm-relative geometry must settle before auto-pass
8. J/Z:
   - smoothed “virtual fingertip” using the whole final finger segment
   - forgiving checkpoints, order matters more than exact dots
   - brief tracking jitter/dropout does not instantly reset the trace
9. Guided fingerspelling uses the same classifier.
   - double letters require a small release before accepting the repeated letter

Important: “confidence” means confidence in the tracked target geometry versus
lookalikes. It is not a linguistic grade or certification of ASL correctness.

Recommended test order:
A, S, T, M, N, E
U, V, W
X
G, Q, L
H, U, R
K, P
then full A-Z and NAME / STORE / WATER in fingerspelling.
