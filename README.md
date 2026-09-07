# ASLingo V1.0 course engine

This ZIP contains replacement root-level files for the flat GitHub/Cloudflare setup:

- `App.jsx` — full course UI + lesson engine
- `styles.css` — iPhone-first UI
- `sw.js` — bumps the PWA cache
- `worker.js` — include your fixed proxy worker if present in this ZIP

## Important
The complete 6-level course is already seeded in Neon but intentionally **unpublished** so the existing live app does not break before this UI is deployed.

After these files are uploaded and Cloudflare finishes deploying, tell ChatGPT **"V1 deployed"**. The course can then be published in Neon in one step.

Cloudflare settings stay:
- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: None
