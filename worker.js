const ECV_URL = 'https://aslsignbank.com/static/ecv/asl.ecv';

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
  ['food-drink', ['food','eat','drink','water','coffee','tea','milk','breakfast','lunch','dinner','restaurant','hungry','thirsty','fruit','vegetable','meat','bread','cook','kitchen']],
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
    });
  }
  return signs.sort((a, b) => a.display.localeCompare(b.display, 'en', { sensitivity: 'base' }) || a.gloss.localeCompare(b.gloss));
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

async function signsResponse() {
  try {
    const response = await fetch(ECV_URL, { headers: { 'User-Agent': 'ASLingo/0.1 personal noncommercial learning tool' } });
    if (!response.ok) throw new Error(`Signbank ECV returned ${response.status}`);
    const signs = parseEcv(await response.text());
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

async function videoResponse(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!/^\d{1,8}$/.test(id || '')) return Response.json({ error: 'A numeric Signbank id is required.' }, { status: 400 });
  const sourceUrl = `https://aslsignbank.com/dictionary/gloss/${id}.html`;
  try {
    const response = await fetch(sourceUrl, { headers: { 'User-Agent': 'ASLingo/0.1 personal noncommercial learning tool' } });
    if (!response.ok) throw new Error(`Sign page returned ${response.status}`);
    const videoUrl = findVideo(await response.text());
    if (!videoUrl) return Response.json({ id: Number(id), sourceUrl, videoUrl: null, unavailable: true }, { status: 404 });
    return Response.json({ id: Number(id), sourceUrl, videoUrl }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to resolve sign video.', sourceUrl }, { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, app: 'ASLingo', version: '0.1.0' });
    if (url.pathname === '/api/signs') return signsResponse();
    if (url.pathname === '/api/video') return videoResponse(request);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
