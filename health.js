export function onRequestGet() {
  return Response.json({ ok: true, app: 'ASL Learn', version: '0.1.0' });
}
