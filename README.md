# ASL Learn — Build 0.1

An iPhone-first personal ASL learning PWA with Neon Auth, Neon-synced progress, an alphabet course, placement quiz, smart alphabet practice, and a live ASL Signbank reference library.

## What is already live in Neon

Project: `ASL Learning`  
Project ID: `fragrant-breeze-36421525`  
Database: `asl_learning`

The database already contains:
- Neon Auth + Neon Data API
- RLS policies so each learner only sees/edits their own progress
- 26 alphabet letters
- 6 alphabet lessons
- 52 lesson items
- 16 dictionary categories
- progress, lesson, placement, practice, favorites/recently-viewed tables

The public client endpoints are already used as safe fallbacks in `src/lib/neon.js`, so you do **not** need to paste a database password into the site.

## Build 0.1 features

- Email/password Neon login + signup
- Required first-run 12-question alphabet placement check
- Home / Learn / Dictionary / Profile bottom navigation
- Alphabet lessons:
  - A–E
  - F–J
  - K–O
  - P–T
  - U–Z
  - A–Z review
- J and Z movement callouts
- 10-question practice mode weighted toward lower-mastery letters
- Per-letter mastery stored in Neon
- Lesson scores stored in Neon
- Live ASL Signbank catalog search
- Automatic category assignment
- On-demand video resolution — no manual folder of 3,500+ videos
- 0.5× / 1× playback + replay
- Favorites and recently viewed signs synced to Neon
- PWA manifest + service worker + iPhone home-screen icon

## Dictionary architecture

The app does **not** copy thousands of media files into this repo.

`functions/api/signs.js` reads ASL Signbank's current ECV catalog and builds the searchable reference list. `functions/api/video.js` resolves the public video source for an individual Signbank entry only when you open it.

Benefits:
- no manual video downloading
- much smaller repo
- catalog updates flow into the app automatically
- every entry can link directly back to its ASL Signbank source

If Signbank changes its page markup in the future, `functions/api/video.js` is the one small resolver that would need to be adjusted.

## Deploy on Cloudflare Pages

1. Create a new GitHub repository.
2. Upload the **contents** of this folder to the repository root.
3. In Cloudflare Pages, connect the repo.
4. Use:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: 22
5. Keep the root `/functions` directory in the repo. Cloudflare Pages uses it for `/api/signs` and `/api/video`.
6. Deploy.

### Important: Neon Auth trusted domain

After Cloudflare gives you the first URL, for example:

`https://your-project.pages.dev`

that exact origin needs to be added to Neon Auth's trusted-domain list before login will work from production.

Send the deployed URL back to ChatGPT and it can be added to the existing `ASL Learning` Neon project. Localhost is already permitted for development.

## Local development

```bash
npm install
npm run dev
```

Regular Vite dev mode serves the frontend but does not emulate the Cloudflare `/functions` directory. For the complete local experience:

```bash
npm install
npm run cf:preview
```

That builds the site and launches it through Wrangler Pages so the dictionary APIs are available too.

## Optional environment variables

The current public Neon endpoints are embedded as fallbacks. If you want to override them, copy `.env.example` to `.env.local`.

```bash
VITE_NEON_AUTH_URL=...
VITE_NEON_DATA_API_URL=...
```

Do **not** put a PostgreSQL connection string or database password in a Vite environment variable.

## ASL source note

ASL Signbank is a linguistic documentation/annotation resource, not a standalone ASL curriculum. This app uses its clips as a visual reference and explicitly presents them that way.

Reference used in the app:

Hochgesang, J. A., Crasborn, O., & Lillo-Martin, D. (2026 (2017–2026)). *ASL Signbank*. https://aslsignbank.com. https://doi.org/10.6084/m9.figshare.9741788

ASL Signbank's current conditions permit re-use/sharing of public images and videos for noncommercial use with attribution under its stated CC BY-NC-SA terms.

Alphabet artwork is loaded from public-domain ASL fingerspelling assets hosted by Wikimedia Commons.

## Next build ideas

Build 0.2 is ready to grow into actual vocabulary lessons without replacing the app structure. The obvious next pieces are:
- greetings / introductions course
- numbers + time course
- fingerspelling word recognition
- reverse practice (English → choose sign)
- dictionary sign → add to custom practice deck
- smarter spaced repetition
- streak / XP only if it adds value rather than getting annoying
