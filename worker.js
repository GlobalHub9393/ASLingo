const ECV_URL = 'https://aslsignbank.com/static/ecv/asl.ecv';
const USER_AGENT = 'ASLingo/0.3 personal noncommercial learning tool';

let catalogMemo = { data: null, expires: 0, promise: null };
const verifiedVideoCache = new Map();
const courseResolutionCache = new Map();

function decodeXml(value = '') {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const GROUPS = [
  ['medical', ['doctor','nurse','hospital','medicine','medical','health','sick','pain','hurt','blood','surgery','disease','injury','therapy','dentist','pregnant']],
  ['food-drink', ['food','eat','drink','water','coffee','tea','milk','breakfast','lunch','dinner','restaurant','hungry','thirsty','fruit','vegetable','meat','bread','cook','kitchen','protein']],
  ['people-family', ['family','mother','mom','father','dad','parent','brother','sister','grandma','grandmother','grandpa','grandfather','husband','wife','child','children','baby','friend','person','people','boy','girl','man','woman','aunt','uncle','cousin']],
  ['feelings', ['happy','sad','angry','mad','love','hate','excited','nervous','afraid','scared','fear','emotion','feel','feeling','proud','embarrassed','surprised','worried','frustrated','bored','jealous']],
  ['school', ['school','student','teacher','class','college','university','learn','study','homework','test','quiz','book','read','write','education','degree','lesson']],
  ['work', ['work','job','boss','manager','employee','office','business','career','meeting','customer','money','pay','salary','company','store','sell','sale']],
  ['technology', ['computer','phone','iphone','internet','website','email','text','technology','video','camera','app','software','online','digital','wifi']],
  ['animals', ['animal','dog','cat','bird','horse','fish','bear','cow','pig','lion','tiger','pet','rabbit','frog']],
  ['clothing', ['shirt','pants','dress','shoe','shoes','hat','coat','jacket','clothes','clothing','sock','socks','wear']],
  ['places', ['home','house','place','city','state','country','room','bathroom','bedroom','outside','inside','park','airport','hotel','church','library','bank','beach']],
  ['numbers-time', ['number','time','today','tomorrow','yesterday','morning','afternoon','evening','night','day','week','month','year','hour','minute','second','monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december']],
  ['questions', ['who','what','where','when','why','how','which','question','ask']],
  ['conversation', ['hello','hi','goodbye','bye','please','thank','thanks','sorry','yes','no','okay','ok','understand','communicate','conversation','talk','sign language','asl','name','meet','nice']],
  ['actions', ['go','come','walk','run','sit','stand','give','take','make','do','help','want','need','have','get','put','open','close','start','stop','play','drive','buy','bring','look','watch','see']],
  ['descriptions', ['big','small','good','bad','beautiful','ugly','new','old','young','fast','slow','hot','cold','easy','hard','same','different','long','short','color','red','blue','green','black','white']],
];

function normalizeEnglish(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalGloss(value = '') {
  return String(value)
    .toUpperCase()
    .replace(/[’']/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function baseGloss(value = '') {
  const raw = String(value).trim();
  const match = raw.match(/^([A-Z][A-Z0-9_-]*?)([a-z][A-Za-z0-9]*)$/);
  return match ? match[1] : raw;
}

function isJunkGloss(gloss = '') {
  const raw = String(gloss).trim();
  return /^&=/.test(raw) || /^wesseltest/i.test(raw) || /^xxx/i.test(raw) || /^i\(/i.test(raw) || /^~/.test(raw) || /^test[-_]/i.test(raw);
}

function categoryFor(gloss, translations) {
  const text = `${gloss} ${translations.join(' ')}`.toLowerCase();
  for (const [slug, words] of GROUPS) {
    if (words.some(word => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text))) return slug;
  }
  return 'other';
}

function parseEcv(xml) {
  const signs = [];
  const entryRegex = /<CV_ENTRY_ML\b([^>]*)>([\s\S]*?)<\/CV_ENTRY_ML>/g;
  let entry;
  while ((entry = entryRegex.exec(xml))) {
    const attrs = entry[1];
    const body = entry[2];
    const idMatch = attrs.match(/\bCVE_ID="([^"]+)"/);
    const valueMatch = body.match(/<CVE_VALUE\b([^>]*)>([\s\S]*?)<\/CVE_VALUE>/);
    if (!idMatch || !valueMatch) continue;
    const id = Number(idMatch[1]);
    if (!Number.isFinite(id)) continue;
    const valueAttrs = valueMatch[1];
    const gloss = decodeXml(valueMatch[2].trim());
    const descMatch = valueAttrs.match(/\bDESCRIPTION="([^"]*)"/);
    const description = decodeXml(descMatch?.[1] || '');
    const translations = description.split(',').map(v => v.trim()).filter(Boolean).filter((v, index, arr) => arr.indexOf(v) === index);
    signs.push({
      id,
      gloss,
      display: translations[0] || gloss,
      translations,
      category: categoryFor(gloss, translations),
      sourceUrl: `https://aslsignbank.com/dictionary/gloss/${id}.html`,
      teachingEligible: !isJunkGloss(gloss),
    });
  }
  return signs.sort((a, b) => a.display.localeCompare(b.display, 'en', { sensitivity: 'base' }) || a.gloss.localeCompare(b.gloss));
}

async function loadCatalog() {
  const now = Date.now();
  if (catalogMemo.data && catalogMemo.expires > now) return catalogMemo.data;
  if (catalogMemo.promise) return catalogMemo.promise;
  catalogMemo.promise = (async () => {
    const response = await fetch(ECV_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`Signbank ECV returned ${response.status}`);
    const signs = parseEcv(await response.text());
    catalogMemo = { data: signs, expires: Date.now() + 6 * 60 * 60 * 1000, promise: null };
    return signs;
  })().catch(error => {
    catalogMemo.promise = null;
    throw error;
  });
  return catalogMemo.promise;
}

function absoluteUrl(value) {
  try { return new URL(value, 'https://aslsignbank.com').href; }
  catch { return null; }
}

function findVideo(html) {
  const videoTag = html.match(/<video\b[^>]*\bid=["']videoplayer["'][^>]*>/i)?.[0] || html.match(/<video\b[^>]*>/i)?.[0];
  const srcFromVideo = videoTag?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (srcFromVideo) return absoluteUrl(srcFromVideo);
  const playerBlock = html.match(/<video\b[^>]*\bid=["']videoplayer["'][^>]*>[\s\S]*?<\/video>/i)?.[0] || html.match(/<video\b[^>]*>[\s\S]*?<\/video>/i)?.[0];
  const srcFromSource = playerBlock?.match(/<source\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (srcFromSource) return absoluteUrl(srcFromSource);
  const mp4 = html.match(/["']([^"']+\.mp4(?:\?[^"']*)?)["']/i)?.[1];
  return mp4 ? absoluteUrl(mp4) : null;
}

async function resolveUpstreamVideo(id) {
  const sourceUrl = `https://aslsignbank.com/dictionary/gloss/${id}.html`;
  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new Error(`Sign page returned ${response.status}`);
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
  const typeOk = type.startsWith('video/') || type.includes('octet-stream') || /\.mp4(?:$|\?)/i.test(videoUrl);
  try { await response.body?.cancel(); } catch {}
  return statusOk && typeOk;
}

async function getVerifiedVideo(id) {
  const key = String(id);
  const cached = verifiedVideoCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const resolved = await resolveUpstreamVideo(id);
    if (!resolved.videoUrl || !(await probeVideo(resolved.videoUrl, resolved.sourceUrl))) {
      verifiedVideoCache.set(key, { value: null, expires: Date.now() + 30 * 60 * 1000 });
      return null;
    }
    verifiedVideoCache.set(key, { value: resolved, expires: Date.now() + 24 * 60 * 60 * 1000 });
    return resolved;
  } catch {
    verifiedVideoCache.set(key, { value: null, expires: Date.now() + 10 * 60 * 1000 });
    return null;
  }
}

const GLOBAL_GLOSS_OVERRIDES = {
  'hi': ['HELLO'],
  'me': ['I', 'IX_1'],
  'you': ['IX'],
  'my': ['POSS_1'],
  'your': ['POSS'],
  'thank you': ['THANK-YOU'],
  'how many': ['HOW-MANY'],
  'how much': ['HOW-MUCH', 'HOW-MANY'],
  'not yet': ['NOT-YET'],
  'wake up': ['WAKE-UP', 'WAKE'],
  'every day': ['EVERY-DAY', 'DAILY'],
  'living room': ['LIVING-ROOM'],
  'long ago': ['LONG-AGO'],
  'dont understand': ['NOT-UNDERSTAND', 'DONT-UNDERSTAND'],
  'dont know': ['NOT-KNOW', 'DONT-KNOW'],
  'dont like': ['DISLIKE', 'NOT-LIKE'],
  'dont want': ['NOT-WANT'],
  'dont have': ['NOT-HAVE', 'NONE'],
  'cant': ['CANNOT', 'CAN-NOT'],
  'fingerspell': ['FINGERSPELL', 'FINGERSPELLING'],
};

const LESSON_GLOSS_OVERRIDES = {
  'l2-places-directions-3': { 'left': ['LEFT-HAND'], 'right': ['RIGHT-HAND'] },
  'l4-spatial-reference-4': { 'left': ['LEFT-HAND'], 'right': ['RIGHT-HAND'] },
  'l2-food-shopping-4': { 'card': ['CREDIT-CARD'] },
  'l3-health-feelings-2': { 'back': ['BACK-BODY'] },
  'l1-first-contact-4': { 'live': ['LIVEa'] },
  'l1-people-family-4': { 'live': ['LIVEa'] },
  'l6-capstone-1': { 'live': ['LIVEa'] },
  'l5-opinions-2': { 'right': ['RIGHT'] },
  'l6-clarification-4': { 'right': ['RIGHT'] },
  'l6-natural-receptive-1': { 'right': ['RIGHT'] },
};

const LESSON_ID_OVERRIDES = {
  'l1-first-contact-1': {
    'hello': 482,
    'hi': 482,
    'me': 1751,
    'you': 1712,
    'my': 2154,
    'your': 919,
    'name': 511,
    'what': 1425,
  },
  'l2-places-directions-3': { 'left': 1683, 'right': 977 },
  'l4-spatial-reference-4': { 'left': 1683, 'right': 977 },
  'l3-health-feelings-2': { 'back': 2084 },
  'l1-first-contact-4': { 'live': 1642 },
  'l1-people-family-4': { 'live': 1642 },
  'l6-capstone-1': { 'live': 1642 },
  'l5-opinions-2': { 'right': 533 },
  'l6-clarification-4': { 'right': 533 },
  'l6-natural-receptive-1': { 'right': 533 },
};

function targetForms(key) {
  const t = normalizeEnglish(key);
  const forms = new Set([t]);
  if (t.startsWith('dont ')) forms.add(`not ${t.slice(5)}`);
  if (t === 'cant') forms.add('cannot');
  if (t === 'wont') forms.add('will not');
  return [...forms];
}

function rankCourseCandidates(key, lesson, catalog) {
  const target = normalizeEnglish(key);
  const forms = targetForms(key);
  const lessonPrefs = LESSON_GLOSS_OVERRIDES[lesson]?.[target] || [];
  const globalPrefs = GLOBAL_GLOSS_OVERRIDES[target] || [];
  const prefs = [...lessonPrefs, ...globalPrefs].map(canonicalGloss);
  const strictLessonOverride = lessonPrefs.length > 0;

  const candidates = [];
  for (const sign of catalog) {
    if (!sign.teachingEligible) continue;
    const rawGloss = normalizeEnglish(sign.gloss);
    const base = normalizeEnglish(baseGloss(sign.gloss));
    const display = normalizeEnglish(sign.display);
    const translations = (sign.translations || []).map(normalizeEnglish);
    const canon = canonicalGloss(sign.gloss);
    let score = -1;

    const prefIndex = prefs.indexOf(canon);
    if (prefIndex >= 0) score = 10000 - prefIndex * 20;
    else if (strictLessonOverride) continue;
    else if (forms.includes(rawGloss)) score = 7000;
    else if (forms.includes(base)) score = 6800;
    else if (forms.includes(display)) score = 6500;
    else if (translations.some(t => forms.includes(t))) score = 6200;
    else continue;

    if (/^[A-Z0-9_-]+$/.test(String(sign.gloss))) score += 80;
    if ((sign.translations || []).some(t => normalizeEnglish(t) === target)) score += 40;
    score -= Math.min(String(sign.gloss).length, 60) / 100;
    candidates.push({ sign, score });
  }
  return candidates.sort((a, b) => b.score - a.score || a.sign.id - b.sign.id).slice(0, 12).map(x => x.sign);
}

async function resolveVerifiedCourseSign(key, lesson, origin) {
  const normalizedKey = normalizeEnglish(key);
  const cacheKey = `${lesson || 'global'}::${normalizedKey}`;
  const cached = courseResolutionCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const catalog = await loadCatalog();
  const forcedId = LESSON_ID_OVERRIDES[lesson]?.[normalizedKey];
  let candidates = [];
  if (forcedId) {
    const forced = catalog.find(s => s.id === forcedId && s.teachingEligible);
    if (forced) candidates.push(forced);
  }
  const ranked = rankCourseCandidates(key, lesson, catalog);
  for (const sign of ranked) if (!candidates.some(s => s.id === sign.id)) candidates.push(sign);

  for (const sign of candidates) {
    const verified = await getVerifiedVideo(sign.id);
    if (!verified) continue;
    const proxiedUrl = new URL('/api/video-stream', origin);
    proxiedUrl.searchParams.set('id', String(sign.id));
    const value = {
      sign: { ...sign, display: key },
      videoUrl: proxiedUrl.toString(),
      sourceUrl: verified.sourceUrl,
    };
    courseResolutionCache.set(cacheKey, { value, expires: Date.now() + 24 * 60 * 60 * 1000 });
    return value;
  }

  courseResolutionCache.set(cacheKey, { value: null, expires: Date.now() + 20 * 60 * 1000 });
  return null;
}

async function signsResponse() {
  try {
    const catalog = await loadCatalog();
    const signs = catalog.filter(sign => sign.teachingEligible).map(({ teachingEligible, ...sign }) => sign);
    return Response.json({
      signs,
      count: signs.length,
      source: 'ASL Signbank',
      citation: 'Hochgesang, J. A., Crasborn, O., & Lillo-Martin, D. (2017-2026). ASL Signbank. https://aslsignbank.com. https://doi.org/10.6084/m9.figshare.9741788',
    }, { headers: { 'Cache-Control': 'public, max-age=21600, s-maxage=21600' } });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to load ASL Signbank.' }, { status: 502 });
  }
}

async function courseSignResponse(request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const lesson = url.searchParams.get('lesson') || '';
  if (!key.trim() || key.length > 80) return Response.json({ error: 'A course sign key is required.' }, { status: 400 });
  try {
    const result = await resolveVerifiedCourseSign(key, lesson, url.origin);
    if (!result) return Response.json({ error: `No verified teaching video found for ${key}.`, unavailable: true }, { status: 404, headers: { 'Cache-Control': 'public, max-age=1200' } });
    return Response.json(result, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to resolve course sign.' }, { status: 502 });
  }
}

async function videoResponse(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!/^\d{1,8}$/.test(id || '')) return Response.json({ error: 'A numeric Signbank id is required.' }, { status: 400 });
  const verified = await getVerifiedVideo(id);
  if (!verified) return Response.json({ id: Number(id), videoUrl: null, unavailable: true }, { status: 404 });
  const proxiedUrl = new URL('/api/video-stream', url.origin);
  proxiedUrl.searchParams.set('id', id);
  return Response.json({ id: Number(id), sourceUrl: verified.sourceUrl, videoUrl: proxiedUrl.toString() }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
}

async function videoStreamResponse(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!/^\d{1,8}$/.test(id || '')) return new Response('Invalid sign id', { status: 400 });

  try {
    const verified = await getVerifiedVideo(id);
    if (!verified?.videoUrl) return new Response('Video unavailable', { status: 404 });
    const headers = new Headers({
      'User-Agent': USER_AGENT,
      'Referer': verified.sourceUrl,
      'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
    });
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);

    const upstream = await fetch(verified.videoUrl, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) return new Response(`Upstream video returned ${upstream.status}`, { status: 502 });

    const outHeaders = new Headers();
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) outHeaders.set(name, value);
    }
    if (!outHeaders.has('content-type')) outHeaders.set('Content-Type', 'video/mp4');
    outHeaders.set('Cache-Control', range ? 'public, max-age=86400' : 'public, max-age=604800, s-maxage=604800');
    outHeaders.set('Access-Control-Allow-Origin', '*');
    outHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
  } catch (error) {
    return new Response(error.message || 'Unable to stream sign video', { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, app: 'ASLingo', version: '0.3.0' });
    if (url.pathname === '/api/signs') return signsResponse();
    if (url.pathname === '/api/course-sign') return courseSignResponse(request);
    if (url.pathname === '/api/video') return videoResponse(request);
    if (url.pathname === '/api/video-stream') return videoStreamResponse(request);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
