ASLingo Tonight Build — Alphabet + Extra Practice + Guided Fingerspelling

REPLACE:
- local-camera.html
- local-camera.css
- local-camera.js
- main.jsx
- vite.config.js

ADD:
- practice-enhancer.js
- practice.html
- practice.css
- fingerspell.html
- fingerspell.css
- fingerspell.js

WHAT CHANGED

1) FINISHED ALPHABET HAND TRACKER
- Static letters keep the auto-check / hold / auto-advance behavior.
- X rule is more forgiving for the hooked index handshape.
- J and Z stencils are moved to the RIGHT side of the visible camera.
- J/Z checkpoints are much more forgiving. You only need to stay close and hit
  the checkpoints in order; not pixel-perfect dot-to-dot.
- J tracks pinky tip; Z tracks index fingertip.

2) INCLUDED AFTER THE ALPHABET COURSE
- The normal alphabet lessons remain unchanged.
- After completing the FINAL U-Z alphabet lesson, the Lesson Complete screen gets:
  "Camera Alphabet Check · BETA"
- It is optional and opens the finished on-device A-Z tracker.

3) NEW PRACTICE TAB
- Adds a fifth "Practice" tab to the normal bottom navigation.
- Practice opens /practice.html.
- Contains hand-tracking-only extra practice.

4) GUIDED FINGERSPELLING
- New /fingerspell.html.
- Pick a word or type your own word (letters only, max 12).
- ASLingo highlights the current letter.
- Hold >=80% confidence for 0.65 seconds and it automatically advances.
- J/Z use the forgiving motion stencil.
- At the end it reports overall word confidence and per-letter confidence.
- This is TARGET-GUIDED fingerspelling confidence, not unrestricted recognition yet.
- No Gemini API calls.

Suggested tonight test:
1. Finish U-Z alphabet lesson and confirm Camera Alphabet Check appears.
2. Bottom nav -> Practice.
3. Run one A-Z Camera Check.
4. Practice -> Guided Fingerspelling -> NAME.
5. Have Kayla sign in and do the same normal lesson/practice flow.
