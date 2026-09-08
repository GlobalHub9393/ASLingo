ASLingo — SignBridge Neural Alphabet Lab v2

REPLACE ONLY:
- neural-alphabet.html
- neural-alphabet.css
- neural-alphabet.js

ADD:
- THIRD_PARTY_NOTICES.txt

NO package.json change.
NO vite.config.js change.
NO build-flat.mjs change.

Why this is different from the failed neural builds:
- It does NOT use LiteRT.
- It does NOT use TFLite.
- It does NOT use ONNX.
- It does NOT require TensorFlow.js at runtime.
- It loads SignBridge's MIT-licensed model weights as plain JSON and performs
  the tiny 3-layer MLP forward pass directly in JavaScript.
- That removes the model-runner compatibility issue that failed on the iPad.

Pipeline:
Camera (960x540 / 16:9)
-> MediaPipe HandLandmarker
-> exact SignBridge 63-feature normalization
-> Dense 128 ReLU
-> Dense 64 ReLU
-> Dense 24 Softmax
-> top-3 blind prediction + stability smoothing.

J and Z are intentionally not part of this static model.

FIRST TEST:
E K O P R X
then
A S T M N
then
U V W

Do not adjust your hand to make the app agree. The point is to test the model.
