ASLingo V3.2 — Hybrid Recognition

UPLOAD THESE FILES TO THE REPO ROOT
- neural-alphabet.js        (replace)
- neural-alphabet.html      (replace)
- neural-alphabet-entry.js  (replace/add)
- camera-geometry-fix.js    (replace/add)

No package.json change.
No Vite change.
No Neon migration.

WHAT V3.2 CHANGES

1. Keeps the V3.1 camera-geometry pipeline
   - phone camera can return 4:3 or another aspect ratio
   - frame is letterboxed, never stretched/cropped
   - MediaPipe receives canonical 960x540 / 16:9 geometry
   - visible camera and blue overlay stay in that same coordinate system

2. Adds a dedicated U / R / V specialist
   ASLingo's actual training data showed a clean landmark distinction:
   - R: index/middle x-order crosses
   - U: index/middle stay uncrossed and close
   - V: index/middle stay uncrossed and wide

   The specialist only runs after the neural model places the hand in the
   U/R/V family. It is NOT a replacement 24-letter rules engine.

3. Adds an A / S / T / M / N thumb specialist
   Uses relative thumb position and depth against index/middle/ring/pinky
   PIP landmarks. It only arbitrates inside this known confusion family.

4. Stronger learned corrections inside confusion families
   - family search radius is broader than generic memory
   - corrected mistakes get 1.35x training weight
   - repeated nearby examples can now outweigh an overconfident base model
   - one example can help but cannot receive the strongest override

5. Account memory across devices
   Signed-in recognition feedback is read from the user's own Neon rows
   (protected by the existing RLS), so training on an iPad can help later on
   the user's phone. LocalStorage still gives immediate learning before the
   server round-trip finishes.

6. Community guardrail is unchanged
   Global/community memory still requires:
   - at least 3 nearby examples
   - from at least 2 distinct contributors
   A single contributor cannot rewrite recognition for everyone.

7. C / O / E / B gets learned-family assistance only
   No new hand-written geometry rules were added for this lower-priority
   family because current results are already mostly good.

BEST TEST ORDER

A. U / R / V
   Try each 3-5 times. U is the most important test.

B. A / S / T / M / N
   Try the five in sequence without changing your normal signing angle.

C. Controls
   K / P
   O / C
   B / L
   X / Y

Watch CURRENT ASSIST.
It can show:
- Base model
- Device memory
- Account family memory
- U/R/V specialist
- A/S/T/M/N specialist
- Hybrid ... (geometry + learned memory agree)

Keep correcting genuine mistakes. Do not deliberately contort a sign to make
the app pass; those natural mistakes are the useful training data.
