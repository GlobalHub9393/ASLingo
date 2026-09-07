const nativeFetch = window.fetch.bind(window);

const normalizeValue = value => String(value || '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[-_/]/g, ' ')
  .replace(/[^a-z0-9 ]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const META_TRANSLATIONS = new Set([
  'interrogative','pronoun','noun','verb','adjective','adverb','conjunction','determiner',
  'deictic','indexical','classifier','gesture','person','people','thing','object','action','time'
]);

function baseGloss(gloss='') {
  const raw = String(gloss).trim();
  const match = raw.match(/^([A-Z][A-Z0-9_-]*?)([a-z][A-Za-z0-9]*)$/);
  return match ? match[1] : raw;
}

function preferredDisplay(sign) {
  const translations = Array.isArray(sign?.translations) ? sign.translations.filter(Boolean) : [];
  const glossTarget = normalizeValue(baseGloss(sign?.gloss || ''));
  const exact = translations.find(t => normalizeValue(t) === glossTarget);
  if (exact) return exact;
  const useful = translations.find(t => !META_TRANSLATIONS.has(normalizeValue(t)));
  if (useful) return useful;
  return sign?.display || sign?.gloss || 'Sign';
}

function repairSign(sign) {
  if (!sign || !Number.isFinite(Number(sign.id))) return sign;
  return {
    ...sign,
    display: preferredDisplay(sign),
    sourceUrl: `https://aslsignbank.com/dictionary/gloss/${Number(sign.id)}.html`,
  };
}

const fallbackSigns = [
  { id:1425, gloss:'WHAT', display:'what', translations:['what','interrogative','pronoun'], category:'questions' },
  { id:1426, gloss:'WHEN', display:'when', translations:['when','interrogative'], category:'questions' },
  { id:1427, gloss:'WHERE', display:'where', translations:['where','interrogative'], category:'questions' },
  { id:1428, gloss:'WHICH', display:'which', translations:['which','which one','interrogative'], category:'questions' },
  { id:1431, gloss:'WHY', display:'why', translations:['why','reason','interrogative'], category:'questions' },
].map(repairSign);

window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  let url;
  try {
    const input = args[0];
    url = new URL(typeof input === 'string' ? input : input.url, location.origin);
  } catch {
    return response;
  }

  if (!response.ok) return response;

  if (url.pathname === '/api/signs') {
    try {
      const data = await response.clone().json();
      const byId = new Map((data.signs || []).map(sign => [Number(sign.id), repairSign(sign)]));
      for (const fallback of fallbackSigns) {
        if (!byId.has(Number(fallback.id))) byId.set(Number(fallback.id), fallback);
      }

      const signs = [...byId.values()].sort((a,b) =>
        String(a.display || '').localeCompare(String(b.display || ''), 'en', { sensitivity:'base' }) ||
        String(a.gloss || '').localeCompare(String(b.gloss || ''), 'en', { sensitivity:'base' })
      );

      const headers = new Headers(response.headers);
      headers.set('content-type','application/json; charset=utf-8');
      headers.set('cache-control','no-store');

      return new Response(JSON.stringify({ ...data, signs, count: signs.length }), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }

  if (url.pathname === '/api/course-sign') {
    try {
      const data = await response.clone().json();
      if (!data?.sign) return response;
      const sign = repairSign(data.sign);
      const headers = new Headers(response.headers);
      headers.set('content-type','application/json; charset=utf-8');
      return new Response(JSON.stringify({
        ...data,
        sign,
        sourceUrl: `https://aslsignbank.com/dictionary/gloss/${Number(sign.id)}.html`,
      }), { status:response.status, statusText:response.statusText, headers });
    } catch {
      return response;
    }
  }

  return response;
};
