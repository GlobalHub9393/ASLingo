ASLingo Media Foundation Repair

Replace:
- build-flat.mjs
- vite.config.js

Add:
- media-worker-transform.mjs
- media-audit.html
- media-audit.jsx
- media-audit.css

What this fixes:
1. Keeps true video verification, but removes false negatives from strict MIME checking.
2. Tries Signbank media with a Range request, then automatically retries without Range.
3. Carries the anonymous Signbank page cookie into protected-media requests when present.
4. Decodes HTML entities in Signbank video URLs.
5. Uses the exact same repaired verification for Dictionary videos and course lesson videos.
6. Adds a hidden batch verification endpoint at /api/course-audit-batch.
7. Adds /media-audit.html to verify every lesson/sign combination and save the results to Neon.

Important:
The course_media_audit Neon migration must be applied before running media-audit.html.
The normal Dictionary/lesson video repair itself does not depend on that table.
