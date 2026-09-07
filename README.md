# ASLingo — Build 0.1 (GitHub Mobile Flat Edition)

This edition is intentionally **flat**: every file can live at the root of the GitHub repository. That makes it easy to upload from iPhone, where GitHub's web uploader does not preserve folders.

## Cloudflare Pages

- Framework preset: Vite (or None)
- Build command: `npm run build`
- Build output directory: `dist`

The build automatically copies the PWA files and creates `dist/_worker.js`. Cloudflare Pages Advanced Mode uses that worker for:

- `/api/health`
- `/api/signs`
- `/api/video`
- all other paths fall through to the static Vite app

No `/functions` folder is required in this edition.

## Backend

The app is already pointed at the ASL Learning Neon project created for ASLingo.

After Cloudflare gives the production `*.pages.dev` URL, add it to Neon Auth trusted origins.

## Files that belong at repo root

`App.jsx`, `main.jsx`, `styles.css`, `neon.js`, `index.html`, `package.json`, `vite.config.js`, `manifest.webmanifest`, `sw.js`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `worker.js`, `build-flat.mjs`, `README.md`.
