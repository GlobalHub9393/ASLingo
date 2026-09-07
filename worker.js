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


const UNIT1_CAMERA_VOCAB = [
  'hello','hi','me','you','my','your','name','what',
  'deaf','hearing','asl','sign','language','learn','know','understand',
  'please','thank you','sorry','again','slow','help','wait','ready',
  'nice','meet','where','from','live','yes','no','okay'
];

const CAMERA_CONVERSATION_PROMPTS = {
  'intro-name': {
    text: 'Say hello and tell me your name.',
    expected: ['hello','my','name'],
  },
  'ask-name': {
    text: 'Ask the other person their name.',
    expected: ['your','name','what'],
  },
  'nice-meet': {
    text: 'Say that it is nice to meet them.',
    expected: ['nice','meet','you'],
  },
  'where-from': {
    text: 'Ask where the other person is from.',
    expected: ['you','where','from'],
  },
  'repair': {
    text: 'Ask them to please sign again slowly.',
    expected: ['please','again','slow'],
  },
};

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function extractInteractionText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const step of payload?.steps || []) {
    for (const content of step?.content || []) {
      if (content?.type === 'text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

function normalizeCameraToken(value = '') {
  return normalizeEnglish(value).replace(/^i$/, 'me').replace(/^ok$/, 'okay');
}

async function callGeminiForAsl({ env, bytes, mimeType, mode, promptText }) {
  const base64 = arrayBufferToBase64(bytes);
  let textPrompt;
  let schema;

  if (mode === 'alphabet') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    textPrompt = [
      'You are an experimental ASL fingerspelling practice recognizer.',
      'Analyze only what is visibly signed in the short camera clip. Do not assume the learner matched a hidden target.',
      'Identify the single fingerspelled ASL letter from A through Z. Use UNCLEAR if the handshape or movement is not clear enough.',
      'Pay attention to handshape, thumb placement, palm orientation, and movement, especially J and Z.',
      'Confidence is your confidence in the visual recognition, not a grade of the learner.',
      'Give a very short note only when framing or ambiguity matters.'
    ].join(' ');
    schema = {
      type: 'object',
      properties: {
        recognized_letter: { type: 'string', enum: [...letters, 'UNCLEAR'] },
        overall_confidence: { type: 'integer', minimum: 0, maximum: 100 },
        framing_quality: { type: 'integer', minimum: 0, maximum: 100 },
        note: { type: 'string' },
      },
      required: ['recognized_letter','overall_confidence','framing_quality','note'],
    };
  } else {
    textPrompt = [
      'You are an experimental, constrained ASL practice recognizer.',
      `The learner was given this practice prompt: "${promptText}"`,
      `The ONLY vocabulary you may report is: ${UNIT1_CAMERA_VOCAB.join(', ')}.`,
      'Report only signs you can actually see in the video; do not fill in words merely because the prompt suggests them.',
      'The signer may use ASL word order rather than English word order. Do not penalize different order.',
      'Ignore any personal-name fingerspelling that is not confidently readable rather than inventing a name.',
      'Use handshape, movement, location, orientation, body position, and visible nonmanual cues where useful.',
      'Confidence is recognition confidence, not a proficiency score. Keep the note short and practical.'
    ].join(' ');
    schema = {
      type: 'object',
      properties: {
        recognized_sequence: {
          type: 'array',
          items: { type: 'string', enum: [...UNIT1_CAMERA_VOCAB, 'unclear'] },
          maxItems: 12,
        },
        token_confidences: {
          type: 'array',
          items: { type: 'integer', minimum: 0, maximum: 100 },
          maxItems: 12,
        },
        overall_confidence: { type: 'integer', minimum: 0, maximum: 100 },
        framing_quality: { type: 'integer', minimum: 0, maximum: 100 },
        note: { type: 'string' },
      },
      required: ['recognized_sequence','token_confidences','overall_confidence','framing_quality','note'],
    };
  }

  const requestBody = model => JSON.stringify({
    model,
    input: [
      {
        type: 'video',
        data: base64,
        mime_type: mimeType,
        processing: { type: 'static', fps: 6 },
      },
      { type: 'text', text: textPrompt },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema,
    },
  });

  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  let payload = {};
  let upstream = null;

  for (let i = 0; i < models.length; i++) {
    upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
        'Api-Revision': '2026-05-20',
      },
      body: requestBody(models[i]),
    });

    payload = await upstream.json().catch(() => ({}));
    if (upstream.ok) break;

    const upstreamMessage = payload?.error?.message || payload?.message || '';
    const isRateLimit = upstream.status === 429 ||
      /quota|rate.?limit|resource_exhausted/i.test(upstreamMessage);
    const isModelUnavailable = upstream.status === 404 ||
      /no longer available|not available to new users|model.*(?:unavailable|unsupported|not found)|unsupported model/i.test(upstreamMessage);
    const canTryNext = i < models.length - 1 && (isRateLimit || isModelUnavailable);

    if (canTryNext) continue;
    if (isRateLimit) {
      throw new Error('Camera AI is temporarily rate-limited. Wait about a minute, then try again.');
    }
    if (isModelUnavailable) {
      throw new Error('Camera AI model is temporarily unavailable. Try again shortly.');
    }
    throw new Error(upstreamMessage || `Gemini returned ${upstream.status}`);
  }

  const outputText = extractInteractionText(payload);
  if (!outputText) throw new Error('Gemini returned no recognition result.');
  try { return JSON.parse(outputText); }
  catch { throw new Error('Gemini returned an unreadable recognition result.'); }
}


function clampCameraPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function safeCameraNote(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function averageCamera(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

function parseGeminiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Gemini returned no recognition result.');

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try { return JSON.parse(cleaned); } catch {}

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  throw new Error('Gemini returned an unreadable recognition result.');
}

function cameraSessionPrompt(mode, segments) {
  if (mode === 'alphabet_session') {
    const intervals = segments.map((segment, index) => ({
      index,
      start_seconds: Number(segment.start_ms || 0) / 1000,
      end_seconds: Number(segment.end_ms || 0) / 1000,
    }));

    return [
      'You are an experimental ASL fingerspelling recognizer evaluating one continuous practice video.',
      `There are exactly ${intervals.length} marked intervals.`,
      'Each interval contains one fingerspelled ASL letter.',
      'The intended target letters are intentionally hidden from you. Do not infer an alphabetical sequence and do not use neighboring intervals to guess.',
      'Independently identify only what is visibly produced in each interval as A through Z or UNCLEAR.',
      'Pay close attention to handshape, thumb placement, palm orientation and movement, especially J and Z.',
      'Confidence is visual recognition confidence, not learner proficiency.',
      `Intervals: ${JSON.stringify(intervals)}`,
      'Return ONLY valid JSON, no markdown and no commentary, using exactly this shape:',
      '{"segment_results":[{"index":0,"recognized_letter":"A","confidence":90,"note":""}],"overall_confidence":90,"framing_quality":90,"note":""}',
      `Return exactly ${intervals.length} segment_results, one for every index.`,
    ].join(' ');
  }

  const intervals = segments.map((segment, index) => {
    const prompt = CAMERA_CONVERSATION_PROMPTS[segment.prompt_id];
    return {
      index,
      start_seconds: Number(segment.start_ms || 0) / 1000,
      end_seconds: Number(segment.end_ms || 0) / 1000,
      practice_prompt: prompt?.text || '',
    };
  });

  return [
    'You are an experimental constrained ASL practice recognizer evaluating one continuous Unit 1 review video.',
    `There are exactly ${intervals.length} marked conversation turns.`,
    `The ONLY vocabulary tokens you may report are: ${UNIT1_CAMERA_VOCAB.join(', ')}, unclear.`,
    'Use each time interval to inspect only that turn.',
    'The practice prompt is context, not an answer key. Report only signs you can actually see and never invent missing signs.',
    'The signer may use ASL word order rather than English word order.',
    'Ignore personal-name fingerspelling that is not confidently readable rather than inventing a name.',
    'Use visible handshape, movement, location, orientation, body position and nonmanual cues where useful.',
    'Confidence is visual recognition confidence, not a proficiency score.',
    `Turns: ${JSON.stringify(intervals)}`,
    'Return ONLY valid JSON, no markdown and no commentary, using exactly this shape:',
    '{"segment_results":[{"index":0,"recognized_sequence":["hello","my","name"],"token_confidences":[90,85,88],"confidence":88,"note":""}],"overall_confidence":88,"framing_quality":90,"note":""}',
    `Return exactly ${intervals.length} segment_results, one for every index.`,
  ].join(' ');
}

async function geminiVideoAttempt({ env, base64, mimeType, prompt, model, processing }) {
  const video = {
    type: 'video',
    data: base64,
    mime_type: mimeType,
  };
  if (processing) video.processing = processing;

  const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model,
      input: [
        video,
        { type: 'text', text: prompt },
      ],
      generation_config: {
        temperature: 0.1,
        max_output_tokens: 5000,
      },
    }),
  });

  const payload = await upstream.json().catch(() => ({}));
  return { upstream, payload };
}

async function callGeminiForAslSession({ env, bytes, mimeType, mode, segments }) {
  const base64 = arrayBufferToBase64(bytes);
  const prompt = cameraSessionPrompt(mode, segments);

  // 3.5 Flash-Lite supports video and agentic video understanding. Start there.
  // If Google's current endpoint rejects agentic processing for this request,
  // retry the SAME model with default static processing before changing models.
  const attempts = [
    { model: 'gemini-3.5-flash-lite', processing: 'agentic' },
    { model: 'gemini-3.5-flash-lite', processing: null },
    { model: 'gemini-3.5-flash', processing: null },
    { model: 'gemini-3.1-flash-lite', processing: null },
  ];

  let lastMessage = '';
  let sawRateLimit = false;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const { upstream, payload } = await geminiVideoAttempt({
      env,
      base64,
      mimeType,
      prompt,
      model: attempt.model,
      processing: attempt.processing,
    });

    if (upstream.ok) {
      const outputText = extractInteractionText(payload);
      return parseGeminiJson(outputText);
    }

    const message = payload?.error?.message || payload?.message || `Gemini returned ${upstream.status}`;
    lastMessage = message;

    const isRateLimit = upstream.status === 429 ||
      /quota|rate.?limit|resource_exhausted/i.test(message);
    const isInvalidArgument = upstream.status === 400 ||
      /invalid argument|invalid_request/i.test(message);
    const isModelUnavailable = upstream.status === 404 ||
      /no longer available|not available to new users|model.*(?:unavailable|unsupported|not found)|unsupported model/i.test(message);

    if (isRateLimit) {
      sawRateLimit = true;
      // Try a model with a separate quota bucket.
      continue;
    }

    // The first retry specifically removes agentic processing from the same model.
    if (isInvalidArgument && i === 0) continue;

    if (isModelUnavailable || isInvalidArgument) continue;

    throw new Error(message);
  }

  if (sawRateLimit && /quota|rate.?limit|resource_exhausted/i.test(lastMessage)) {
    throw new Error('Camera AI is temporarily rate-limited. Wait about a minute, then try again.');
  }

  if (/invalid argument|invalid_request/i.test(lastMessage)) {
    throw new Error('Google rejected the camera-analysis request. The app tried its compatibility fallbacks too.');
  }

  throw new Error(lastMessage || 'Camera AI could not analyze this review.');
}

async function aslSessionResponse(request, env) {
  if (!env.GEMINI_API_KEY) {
    return Response.json({ error: 'Camera AI is not configured.', code: 'AI_NOT_CONFIGURED' }, { status: 503 });
  }

  let form;
  try { form = await request.formData(); }
  catch { return Response.json({ error: 'Could not read the camera session upload.' }, { status: 400 }); }

  const mode = String(form.get('mode') || '');
  if (!['alphabet_session','unit1_session'].includes(mode)) {
    return Response.json({ error: 'Invalid camera review mode.' }, { status: 400 });
  }

  let segments;
  try { segments = JSON.parse(String(form.get('segments') || '[]')); }
  catch { return Response.json({ error: 'Camera review timing data was invalid.' }, { status: 400 }); }

  if (!Array.isArray(segments) || !segments.length || segments.length > 26) {
    return Response.json({ error: 'Camera review timing data was incomplete.' }, { status: 400 });
  }

  const video = form.get('video');
  if (!video || typeof video.arrayBuffer !== 'function') {
    return Response.json({ error: 'Camera review video was missing.' }, { status: 400 });
  }

  const mimeType = String(video.type || 'video/webm').split(';')[0].toLowerCase();
  const allowedTypes = new Set(['video/mp4','video/webm','video/quicktime','video/mov','video/mpeg','video/3gpp']);
  if (!allowedTypes.has(mimeType)) {
    return Response.json({ error: `Unsupported camera video type: ${mimeType}` }, { status: 415 });
  }

  const maxBytes = 18 * 1024 * 1024;
  if (Number(video.size || 0) > maxBytes) {
    return Response.json({ error: 'Camera review video is too large. Move through the prompts a little faster and try again.' }, { status: 413 });
  }

  const cleaned = [];
  for (let index = 0; index < segments.length; index++) {
    const raw = segments[index] || {};
    const startMs = Math.max(0, Number(raw.start_ms || 0));
    const endMs = Math.max(startMs, Number(raw.end_ms || 0));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return Response.json({ error: `Timing for review item ${index + 1} was invalid.` }, { status: 400 });
    }

    if (mode === 'alphabet_session') {
      const target = String(raw.target || '').toUpperCase();
      if (!/^[A-Z]$/.test(target)) return Response.json({ error: `Alphabet target ${index + 1} was invalid.` }, { status: 400 });
      cleaned.push({ index, start_ms: Math.round(startMs), end_ms: Math.round(endMs), target });
    } else {
      const promptId = String(raw.prompt_id || '');
      if (!CAMERA_CONVERSATION_PROMPTS[promptId]) {
        return Response.json({ error: `Unit 1 prompt ${index + 1} was invalid.` }, { status: 400 });
      }
      cleaned.push({ index, start_ms: Math.round(startMs), end_ms: Math.round(endMs), prompt_id: promptId });
    }
  }

  const bytes = await video.arrayBuffer();
  if (!bytes.byteLength) return Response.json({ error: 'Camera review video was empty.' }, { status: 400 });

  try {
    const ai = await callGeminiForAslSession({ env, bytes, mimeType, mode, segments: cleaned });
    const byIndex = new Map(
      (Array.isArray(ai.segment_results) ? ai.segment_results : [])
        .map(row => [Number(row?.index), row])
        .filter(([index]) => Number.isInteger(index))
    );

    if (mode === 'alphabet_session') {
      const results = cleaned.map((segment, index) => {
        const row = byIndex.get(index) || {};
        const recognized = String(row.recognized_letter || 'UNCLEAR').toUpperCase();
        return {
          index,
          target: segment.target,
          recognized_letter: /^[A-Z]$/.test(recognized) ? recognized : 'UNCLEAR',
          confidence: clampCameraPercent(row.confidence),
          target_match: recognized === segment.target,
          duration_ms: segment.end_ms - segment.start_ms,
          note: safeCameraNote(row.note, 120),
        };
      });
      return Response.json({
        mode,
        results,
        overall_confidence: clampCameraPercent(ai.overall_confidence || averageCamera(results.map(r => r.confidence))),
        framing_quality: clampCameraPercent(ai.framing_quality),
        agreement_percent: Math.round(results.filter(r => r.target_match).length / Math.max(results.length, 1) * 100),
        note: safeCameraNote(ai.note),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const results = cleaned.map((segment, index) => {
      const row = byIndex.get(index) || {};
      const prompt = CAMERA_CONVERSATION_PROMPTS[segment.prompt_id];
      const recognized = (Array.isArray(row.recognized_sequence) ? row.recognized_sequence : [])
        .map(normalizeCameraToken)
        .filter(token => token && token !== 'unclear' && UNIT1_CAMERA_VOCAB.includes(token));
      const recognizedSet = new Set(recognized);
      const detected = prompt.expected.filter(token => recognizedSet.has(normalizeCameraToken(token))).length;
      const coverage = Math.round(detected / Math.max(prompt.expected.length, 1) * 100);
      return {
        index,
        prompt_id: segment.prompt_id,
        prompt_text: prompt.text,
        recognized_sequence: recognized,
        token_confidences: Array.isArray(row.token_confidences)
          ? row.token_confidences.slice(0, recognized.length).map(clampCameraPercent)
          : [],
        confidence: clampCameraPercent(row.confidence),
        coverage_percent: coverage,
        expected_concepts: prompt.expected,
        duration_ms: segment.end_ms - segment.start_ms,
        note: safeCameraNote(row.note, 120),
      };
    });

    return Response.json({
      mode,
      results,
      overall_confidence: clampCameraPercent(ai.overall_confidence || averageCamera(results.map(r => r.confidence))),
      framing_quality: clampCameraPercent(ai.framing_quality),
      average_coverage_percent: averageCamera(results.map(r => r.coverage_percent)),
      note: safeCameraNote(ai.note),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error.message || 'Could not analyze this camera review.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}


async function aslAnalyzeResponse(request, env) {
  const url = new URL(request.url);
  if (!env.GEMINI_API_KEY) {
    return Response.json({ error: 'Camera AI is not configured.', code: 'AI_NOT_CONFIGURED' }, { status: 503 });
  }
  const mode = url.searchParams.get('mode');
  if (!['alphabet','conversation'].includes(mode)) return Response.json({ error: 'Invalid camera practice mode.' }, { status: 400 });

  const mimeType = (request.headers.get('content-type') || 'video/webm').split(';')[0].toLowerCase();
  const allowedTypes = new Set(['video/mp4','video/webm','video/quicktime','video/mov','video/mpeg','video/3gpp']);
  if (!allowedTypes.has(mimeType)) return Response.json({ error: `Unsupported camera video type: ${mimeType}` }, { status: 415 });

  const declared = Number(request.headers.get('content-length') || 0);
  const maxBytes = 12 * 1024 * 1024;
  if (declared > maxBytes) return Response.json({ error: 'Camera clip is too large. Keep attempts short.' }, { status: 413 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return Response.json({ error: 'Camera clip was empty.' }, { status: 400 });
  if (bytes.byteLength > maxBytes) return Response.json({ error: 'Camera clip is too large. Keep attempts short.' }, { status: 413 });

  try {
    if (mode === 'alphabet') {
      const target = (url.searchParams.get('target') || '').toUpperCase();
      if (!/^[A-Z]$/.test(target)) return Response.json({ error: 'A target letter is required.' }, { status: 400 });
      const result = await callGeminiForAsl({ env, bytes, mimeType, mode, promptText: '' });
      const recognized = String(result.recognized_letter || 'UNCLEAR').toUpperCase();
      return Response.json({
        recognized_letter: recognized,
        target_match: recognized === target,
        overall_confidence: Math.max(0, Math.min(100, Number(result.overall_confidence || 0))),
        framing_quality: Math.max(0, Math.min(100, Number(result.framing_quality || 0))),
        note: String(result.note || '').slice(0, 220),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const promptId = url.searchParams.get('prompt') || '';
    const prompt = CAMERA_CONVERSATION_PROMPTS[promptId];
    if (!prompt) return Response.json({ error: 'Unknown Unit 1 conversation prompt.' }, { status: 400 });
    const result = await callGeminiForAsl({ env, bytes, mimeType, mode, promptText: prompt.text });
    const recognized = (Array.isArray(result.recognized_sequence) ? result.recognized_sequence : [])
      .map(normalizeCameraToken)
      .filter(token => token && token !== 'unclear' && UNIT1_CAMERA_VOCAB.includes(token));
    const recognizedSet = new Set(recognized);
    const detected = prompt.expected.filter(token => recognizedSet.has(normalizeCameraToken(token))).length;
    const coverage = Math.round((detected / Math.max(prompt.expected.length, 1)) * 100);
    return Response.json({
      recognized_sequence: recognized,
      token_confidences: Array.isArray(result.token_confidences) ? result.token_confidences.slice(0, recognized.length) : [],
      overall_confidence: Math.max(0, Math.min(100, Number(result.overall_confidence || 0))),
      framing_quality: Math.max(0, Math.min(100, Number(result.framing_quality || 0))),
      coverage_percent: coverage,
      expected_concepts: prompt.expected,
      note: String(result.note || '').slice(0, 220),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error.message || 'Could not analyze this ASL clip.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, app: 'ASLingo', version: '0.5.1-camera-batch' });
    if (url.pathname === '/api/signs') return signsResponse();
    if (url.pathname === '/api/course-sign') return courseSignResponse(request);
    if (url.pathname === '/api/video') return videoResponse(request);
    if (url.pathname === '/api/video-stream') return videoStreamResponse(request);
    if (url.pathname === '/api/asl-session' && request.method === 'POST') return aslSessionResponse(request, env);
    if (url.pathname === '/api/asl-analyze' && request.method === 'POST') return aslAnalyzeResponse(request, env);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
