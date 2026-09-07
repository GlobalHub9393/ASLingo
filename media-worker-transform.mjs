const MEDIA_FIX_MARKER = 'ASLINGO_MEDIA_FIX_V2';

function mustReplace(source, oldText, newText, label) {
  if (!source.includes(oldText)) {
    throw new Error(`ASLingo media transform could not find ${label}. worker.js changed; refusing an unsafe build.`);
  }
  return source.replace(oldText, newText);
}

export function applyMediaWorkerFix(source) {
  if (source.includes(MEDIA_FIX_MARKER)) return source;
  let out = source;

  out = mustReplace(
    out,
`function absoluteUrl(value) {
  try { return new URL(value, 'https://aslsignbank.com').href; }
  catch { return null; }
}`,
`function absoluteUrl(value) {
  try { return new URL(decodeXml(String(value || '')), 'https://aslsignbank.com').href; }
  catch { return null; }
}`,
    'absoluteUrl()'
  );

  out = mustReplace(
    out,
`async function resolveUpstreamVideo(id) {
  const sourceUrl = \`https://aslsignbank.com/dictionary/gloss/\${id}.html\`;
  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new Error(\`Sign page returned \${response.status}\`);
  return { sourceUrl, videoUrl: findVideo(await response.text()) };
}

async function probeVideo(videoUrl, sourceUrl) {
  const response = await fetch(videoUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': sourceUrl,
      'Accept': 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5',
      'Range': 'bytes=0-1',
    },
  });
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const statusOk = response.status === 200 || response.status === 206;
  const typeOk = type.startsWith('video/') || type.includes('octet-stream') || /\\.mp4(?:$|\\?)/i.test(videoUrl);
  try { await response.body?.cancel(); } catch {}
  return statusOk && typeOk;
}`,
`async function resolveUpstreamVideo(id) {
  const sourceUrl = \`https://aslsignbank.com/dictionary/gloss/\${id}.html\`;
  const response = await fetch(sourceUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new Error(\`Sign page returned \${response.status}\`);
  const html = await response.text();

  // Signbank can serve video through protected-media routes. Keep the anonymous
  // cookie from the gloss page when one is supplied so the media request is made
  // in the same anonymous browsing context.
  const rawCookie = response.headers.get('set-cookie') || '';
  const cookie = rawCookie ? rawCookie.split(';')[0] : null;

  return { sourceUrl, videoUrl: findVideo(html), cookie };
}

async function probeVideo(videoUrl, sourceUrl, cookie = null) {
  const tryRequest = async (withRange) => {
    const headers = new Headers({
      'User-Agent': USER_AGENT,
      'Referer': sourceUrl,
      'Accept': 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5',
    });
    if (cookie) headers.set('Cookie', cookie);
    if (withRange) headers.set('Range', 'bytes=0-1023');

    const response = await fetch(videoUrl, { redirect: 'follow', headers });
    const ok = response.status === 200 || response.status === 206;
    try { await response.body?.cancel(); } catch {}
    return ok;
  };

  // Some Signbank/protected-media responses do not advertise a useful MIME type,
  // and some do not honor byte ranges. A successful media response is enough.
  if (await tryRequest(true)) return true;
  return tryRequest(false);
}`,
    'Signbank resolver/probe'
  );

  out = mustReplace(
    out,
`  return candidates.sort((a, b) => b.score - a.score || a.sign.id - b.sign.id).slice(0, 12).map(x => x.sign);`,
`  // Keep course resolution under Cloudflare Free's external subrequest budget.
  // If none of the strongest 8 exact/translation candidates play, flag it for
  // curation rather than trying 12 variants in one Worker invocation.
  return candidates.sort((a, b) => b.score - a.score || a.sign.id - b.sign.id).slice(0, 8).map(x => x.sign);`,
    'course candidate cap'
  );

  out = mustReplace(
    out,
`    if (!resolved.videoUrl || !(await probeVideo(resolved.videoUrl, resolved.sourceUrl))) {`,
`    if (!resolved.videoUrl || !(await probeVideo(resolved.videoUrl, resolved.sourceUrl, resolved.cookie))) {`,
    'getVerifiedVideo probe'
  );

  out = mustReplace(
    out,
`    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);

    const upstream = await fetch(verified.videoUrl, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) return new Response(\`Upstream video returned \${upstream.status}\`, { status: 502 });`,
`    if (verified.cookie) headers.set('Cookie', verified.cookie);
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);

    let upstream = await fetch(verified.videoUrl, { headers, redirect: 'follow' });

    // Safari requests ranges aggressively. If Signbank's protected-media route
    // refuses that range, retry once as a normal media request rather than
    // incorrectly reporting the sign as unavailable.
    if (!(upstream.status === 200 || upstream.status === 206) && range) {
      try { await upstream.body?.cancel(); } catch {}
      headers.delete('Range');
      upstream = await fetch(verified.videoUrl, { headers, redirect: 'follow' });
    }

    if (!(upstream.status === 200 || upstream.status === 206)) {
      return new Response(\`Upstream video returned \${upstream.status}\`, { status: 502 });
    }`,
    'video stream fetch'
  );

  const auditFunction = `
/* ${MEDIA_FIX_MARKER} */
async function courseAuditBatchResponse(request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Audit body must be JSON.' }, { status: 400 }); }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length || items.length > 20) {
    return Response.json({ error: 'Send between 1 and 20 course items per audit batch.' }, { status: 400 });
  }

  const results = [];
  for (const raw of items) {
    const key = String(raw?.key || '').trim();
    const lesson = String(raw?.lesson || '').trim();

    if (!key || key.length > 80 || !lesson || lesson.length > 120) {
      results.push({ key, lesson, status: 'error', message: 'Invalid course item.' });
      continue;
    }

    try {
      const resolved = await resolveVerifiedCourseSign(key, lesson, new URL(request.url).origin);
      if (!resolved?.sign?.id) {
        results.push({
          key,
          lesson,
          status: 'unresolved',
          message: 'No playable Signbank video matched this lesson concept.',
        });
        continue;
      }

      results.push({
        key,
        lesson,
        status: 'verified',
        signbank_id: Number(resolved.sign.id),
        signbank_gloss: String(resolved.sign.gloss || ''),
        source_url: resolved.sourceUrl || resolved.sign.sourceUrl || null,
      });
    } catch (error) {
      results.push({
        key,
        lesson,
        status: 'error',
        message: String(error?.message || 'Verification failed.').slice(0, 240),
      });
    }
  }

  return Response.json(
    {
      results,
      verified: results.filter(r => r.status === 'verified').length,
      unresolved: results.filter(r => r.status === 'unresolved').length,
      errors: results.filter(r => r.status === 'error').length,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

`;

  const insertionPoint = "\nconst UNIT1_CAMERA_VOCAB = [";
  if (!out.includes(insertionPoint)) {
    throw new Error('ASLingo media transform could not find camera insertion point.');
  }
  out = out.replace(insertionPoint, `\n${auditFunction}const UNIT1_CAMERA_VOCAB = [`);

  out = mustReplace(
    out,
`    if (url.pathname === '/api/video-stream') return videoStreamResponse(request);`,
`    if (url.pathname === '/api/video-stream') return videoStreamResponse(request);
    if (url.pathname === '/api/course-audit-batch' && request.method === 'POST') return courseAuditBatchResponse(request);`,
    'worker route table'
  );

  return out;
}
