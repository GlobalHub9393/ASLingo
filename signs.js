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
  ['descriptions', ['big','small','good','bad','beautiful','ugly','new','old','young','fast','slow','hot','cold','easy','hard','same','different','long','short','color','red','blue','green','black','white']]
];

function categoryFor(gloss, translations) {
  const text = `${gloss} ${translations.join(' ')}`.toLowerCase();
  for (const [slug, words] of GROUPS) {
    if (words.some(word => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text))) {
      return slug;
    }
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
    const translations = description
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
      .filter((v, index, arr) => arr.indexOf(v) === index);
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

export async function onRequestGet() {
  try {
    const response = await fetch(ECV_URL, {
      headers: { 'User-Agent': 'ASL-Learn/0.1 personal noncommercial learning tool' },
    });
    if (!response.ok) throw new Error(`Signbank ECV returned ${response.status}`);
    const xml = await response.text();
    const signs = parseEcv(xml);
    return Response.json(
      {
        signs,
        count: signs.length,
        source: 'ASL Signbank',
        citation: 'Hochgesang, J. A., Crasborn, O., & Lillo-Martin, D. (2026 (2017-2026)). ASL Signbank. https://aslsignbank.com. https://doi.org/10.6084/m9.figshare.9741788',
      },
      { headers: { 'Cache-Control': 'public, max-age=21600, s-maxage=21600' } }
    );
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to load ASL Signbank.' }, { status: 502 });
  }
}
