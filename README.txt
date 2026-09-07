ASLingo Camera Review - Batch Beta

Replace these ROOT files in GitHub:
1. camera.html
2. worker.js

No new Cloudflare secret is required if GEMINI_API_KEY is already set.

Then open:
https://aslingo.pages.dev/camera.html

What changed:
- Full Alphabet Review: A through Z in ONE continuous recording and ONE Gemini request.
- Unit 1 Review: five First Contact prompts in ONE continuous recording and ONE Gemini request.
- Tap Next after each letter/turn; ASLingo records the time boundary for each segment.
- Alphabet results show per-letter recognition confidence and AI-vs-prompt agreement.
- Unit 1 results show per-turn recognized signs, confidence, and expected-concept coverage.
- Total signing time, AI analysis time, and framing quality are shown.
- Results are experimental recognition metrics, not proficiency grades.
- Raw clips are analyzed and not stored by ASLingo.

The worker now tries Gemini 2.5 Flash-Lite first and Gemini 3.5 Flash-Lite as a rate-limit fallback.
