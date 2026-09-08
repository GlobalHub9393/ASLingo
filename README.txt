ASLingo MediaPipe Comparative Tracker v4.1

REPLACE:
- hand-classifier.js
- local-camera.js

Why this patch exists:
The first real v4 A-Z run exposed six clear false negatives:
E, K, O, P, R, X.

Changes:
- E: broad bent-finger + fingertip/thumb gathering model, rather than one ideal curl.
- K: stronger thumb-at-two-finger-base evidence; V is penalized when K thumb geometry is present.
- O: stronger fingertip/thumb convergence; C/E are less likely to win when the O closes.
- P: scores the same K core plus stronger downward orientation so it can beat K.
- R: adds actual 2D finger-segment crossing detection, not only fingertip x-order.
- X: accepts a broader anatomically hooked index range instead of demanding one exact PIP/DIP angle.
- Feedback percentage is rounded (no more 77.0909090909%).

No personal calibration is added. The comparative / lookalike architecture remains intact.
Fingerspelling automatically benefits because it imports hand-classifier.js.
