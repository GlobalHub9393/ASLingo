ASLingo Neural Alphabet Lab v1.1 — inference fix

REPLACE:
- neural-alphabet.html
- neural-alphabet.css
- neural-alphabet.js

The first build successfully loaded the camera/model but failed during LiteRT.js inference on iPad/WebKit.
This version bypasses LiteRT.js for this page and uses the classic TensorFlow.js TFLite browser interpreter instead.
It also serializes inference and shows the exact runtime error on screen if anything still fails.

No package.json or Vite changes are required.
