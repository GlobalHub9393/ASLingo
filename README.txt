ASLingo Camera Practice Beta

Upload/replace these ROOT files in GitHub:
1. camera.html        (new)
2. worker.js          (replace existing)
3. build-flat.mjs     (replace existing)

Cloudflare setup required once:
- Open ASLingo in Cloudflare Pages.
- Settings -> Variables and Secrets (Production).
- Add a SECRET named: GEMINI_API_KEY
- Paste your Google Gemini API key as the value.
- Redeploy after saving the secret if Cloudflare does not automatically restart the deployment.

Then open:
https://aslingo.pages.dev/camera.html

Beta scope:
- Alphabet camera recognition: A-Z, one letter at a time.
- Unit 1 / First Contact: five guided conversation turns using only studied vocabulary.
- Displays recognition confidence, prompt match/coverage, signing time, analysis time, and framing quality.
- Raw video is forwarded for AI analysis and is not stored by ASLingo in this beta.
- No pass/fail and no proficiency score.

If this beta works well enough, the next step is integrating a Camera Practice card at the end of the Alphabet unit and every completed course unit, plus saving summary metrics to Neon.
