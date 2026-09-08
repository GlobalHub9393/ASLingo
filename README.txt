ASLingo Neural Alphabet Lab

REPLACE:
- package.json
- vite.config.js
- practice.html

ADD:
- neural-alphabet.html
- neural-alphabet.css
- neural-alphabet.js

What this is:
- A SEPARATE proof-of-concept page. It does not replace the existing checker.
- Blind recognition: the model is not told which letter you intend.
- MediaPipe provides 21 hand landmarks.
- A trained TFLite neural model predicts A-Z from the 42 normalized x/y landmark values.
- LiteRT.js runs the model locally in the browser.
- No Gemini.
- No ASLingo server inference.
- No personal calibration.
- The page shows top-3 model predictions plus stability over recent frames.

Model:
Muhib-Mehdi/ASL-Recognition-System
MIT licensed.
The model is loaded at runtime from the project's public raw GitHub TFLite file.
Its published pipeline uses wrist-relative 2D landmarks normalized by max absolute coordinate.
ASLingo reproduces that preprocessing in the browser.

Important:
- Treat J/Z as unsupported for this STATIC lab even though the model has A-Z labels.
  Motion letters need a temporal sequence model.
- This page is specifically to answer one question:
  "Does a trained model recognize your normal handshapes better than our hand-written rules?"
- If yes, the next build should move toward a temporal fingerspelling model rather than more rule tuning.

First test:
E, K, O, P, R, X
then A/S/T/M/N
then U/V/W.
Do NOT try to make the hand fit the model. Sign naturally and record what it predicts.

Runtime: @litertjs/core 2.5.3 (current package at build time).
