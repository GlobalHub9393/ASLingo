ASLingo Neural Alphabet Lab v3 — Live Learning

REPLACE:
- neural-alphabet.html
- neural-alphabet.css
- neural-alphabet.js

DATABASE:
- ASLingo-Live-Learning-Neon-Migration.sql

No package.json change.
No vite.config.js change.
No build-flat.mjs change.

NEW:
- “This is X” confirmation button.
- “Different letter…” correction picker.
- Each correction stores averaged 63-value MediaPipe landmarks, base model scores,
  predicted/actual labels, handedness, tracking quality, device class, browser,
  and camera dimensions. No image or video is stored.
- Local corrections affect recognition immediately and persist on that device.
- Signed-in corrections are stored in Neon for ASLingo’s global training pool.
- Community memory only influences recognition when nearby examples have at least
  3 supporting samples from at least 2 distinct contributors.
- Same device class gets only a small 8% weight bump; it is not the deciding factor.
- Recent landmark frames are averaged to reduce one-frame MediaPipe jitter.
- Raw softmax is no longer called “confidence”; UI says Strong / Moderate / Uncertain.

BEST FIRST TRAINING SET:
A S T M N
B L
E
K P
O C
