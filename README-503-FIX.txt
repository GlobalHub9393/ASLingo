ASLingo Media Audit 503 / Resume Fix

Replace:
- media-audit.jsx
- media-worker-transform.mjs

The 503 happened because the audit bundled 12 signs into one Cloudflare Worker request.
On the Free plan Cloudflare allows 50 external subrequests per invocation, and each
sign may require several Signbank page/video checks.

This fix:
- sends ONE sign per audit request
- resumes from saved verified results
- retries unresolved/error rows
- caps automatic variant probing at 8 candidates
- keeps the 60 results already saved in Neon

After deploy, open /media-audit.html and tap Run full course audit again.
