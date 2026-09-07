function absoluteUrl(value) {
  try { return new URL(value, 'https://aslsignbank.com').href; }
  catch { return null; }
}

function findVideo(html) {
  const videoTag = html.match(/<video\b[^>]*\bid=["']videoplayer["'][^>]*>/i)?.[0]
    || html.match(/<video\b[^>]*>/i)?.[0];
  const srcFromVideo = videoTag?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (srcFromVideo) return absoluteUrl(srcFromVideo);

  const playerBlock = html.match(/<video\b[^>]*\bid=["']videoplayer["'][^>]*>[\s\S]*?<\/video>/i)?.[0]
    || html.match(/<video\b[^>]*>[\s\S]*?<\/video>/i)?.[0];
  const srcFromSource = playerBlock?.match(/<source\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (srcFromSource) return absoluteUrl(srcFromSource);

  const mp4 = html.match(/["']([^"']+\.mp4(?:\?[^"']*)?)["']/i)?.[1];
  return mp4 ? absoluteUrl(mp4) : null;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!/^\d{1,8}$/.test(id || '')) {
    return Response.json({ error: 'A numeric Signbank id is required.' }, { status: 400 });
  }

  const sourceUrl = `https://aslsignbank.com/dictionary/gloss/${id}.html`;
  try {
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'ASL-Learn/0.1 personal noncommercial learning tool' },
    });
    if (!response.ok) throw new Error(`Sign page returned ${response.status}`);
    const html = await response.text();
    const videoUrl = findVideo(html);
    if (!videoUrl) {
      return Response.json({ id: Number(id), sourceUrl, videoUrl: null, unavailable: true }, { status: 404 });
    }
    return Response.json(
      { id: Number(id), sourceUrl, videoUrl },
      { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } }
    );
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to resolve sign video.', sourceUrl }, { status: 502 });
  }
}
