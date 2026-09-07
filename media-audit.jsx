import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, CheckCircle2, LoaderCircle, PlayCircle } from 'lucide-react';
import { neon } from './neon.js';
import './media-audit.css';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function errorText(error, fallback='Something went wrong.') {
  return error?.message || error?.error?.message || error?.error || fallback;
}

function MediaAudit() {
  const session = neon.auth.useSession();
  const user = session.data?.user;
  const [items, setItems] = useState([]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session.isPending) return;
    if (!user) { location.href = '/'; return; }
    loadItems();
  }, [session.isPending, user?.id]);

  async function loadItems() {
    setError('');
    try {
      const response = await neon.from('lesson_blueprints').select('lesson_slug,sign_keys');
      if (response.error) throw response.error;

      const seen = new Set();
      const expanded = [];
      for (const bp of response.data || []) {
        for (const rawKey of bp.sign_keys || []) {
          const key = String(rawKey || '').trim();
          const token = `${bp.lesson_slug}::${key.toLowerCase()}`;
          if (!key || seen.has(token)) continue;
          seen.add(token);
          expanded.push({ key, lesson: bp.lesson_slug });
        }
      }
      expanded.sort((a,b)=>a.lesson.localeCompare(b.lesson)||a.key.localeCompare(b.key));
      setItems(expanded);

      const prior = await neon.from('course_media_audit').select('*').eq('audited_by', user.id);
      if (!prior.error) setResults(prior.data || []);
    } catch (e) {
      setError(errorText(e, 'Could not load course media audit.'));
    } finally {
      setLoaded(true);
    }
  }

  async function runAudit() {
    setRunning(true);
    setError('');
    setResults([]);

    try {
      const batchSize = 12;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const response = await fetch('/api/course-audit-batch', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ items: batch }),
        });
        const data = await response.json().catch(()=>({}));
        if (!response.ok) throw new Error(data.error || `Audit batch failed (${response.status}).`);

        const now = new Date().toISOString();
        const rows = (data.results || []).map(row => ({
          audited_by: user.id,
          lesson_slug: row.lesson,
          sign_key: row.key,
          status: row.status,
          signbank_id: row.signbank_id || null,
          signbank_gloss: row.signbank_gloss || null,
          source_url: row.source_url || null,
          message: row.message || null,
          checked_at: now,
        }));

        if (rows.length) {
          const saved = await neon.from('course_media_audit')
            .upsert(rows, { onConflict:'audited_by,lesson_slug,sign_key' })
            .select();
          if (saved.error) throw saved.error;

          setResults(prev => {
            const map = new Map(prev.map(row => [`${row.lesson_slug}::${row.sign_key}`, row]));
            for (const row of saved.data || rows) {
              map.set(`${row.lesson_slug}::${row.sign_key}`, row);
            }
            return [...map.values()];
          });
        }

        // Be polite to Signbank and avoid hammering hundreds of pages at once.
        await sleep(160);
      }
    } catch (e) {
      setError(errorText(e, 'Media audit stopped.'));
    } finally {
      setRunning(false);
    }
  }

  if (session.isPending || !loaded) return <div className="loading"><LoaderCircle size={24}/> Loading media audit…</div>;
  if (!user) return null;

  const verified = results.filter(r=>r.status==='verified').length;
  const unresolved = results.filter(r=>r.status==='unresolved').length;
  const errors = results.filter(r=>r.status==='error').length;
  const pct = Math.round(results.length / Math.max(items.length, 1) * 100);
  const problemRows = results
    .filter(r=>r.status!=='verified')
    .sort((a,b)=>a.lesson_slug.localeCompare(b.lesson_slug)||a.sign_key.localeCompare(b.sign_key));

  return <main className="page">
    <header className="top">
      <button className="back" onClick={()=>location.href='/'}><ArrowLeft size={21}/></button>
      <div><p className="eyebrow">Hidden maintenance tool</p><h1>Course media audit</h1></div>
    </header>

    <section className="card">
      <p className="eyebrow">Verify every lesson sign</p>
      <h2>{items.length} lesson/sign combinations</h2>
      <p className="muted">This checks the actual Signbank gloss page and then makes a real media request. Results are saved so the broken mappings can be repaired instead of discovered during lessons.</p>
      <div className="progress"><span style={{width:`${pct}%`}}/></div>
      <div className="stats">
        <div className="stat"><b>{results.length}/{items.length}</b><span>Checked</span></div>
        <div className="stat"><b className="good">{verified}</b><span>Verified playable</span></div>
        <div className="stat"><b className={unresolved?'warn':''}>{unresolved}</b><span>Unresolved</span></div>
      </div>
      <button className="primary" disabled={running || !items.length} onClick={runAudit}>
        {running ? <><LoaderCircle size={18}/> Auditing… {pct}%</> : <><PlayCircle size={18}/> Run full course audit</>}
      </button>
      <p className="note">You can leave this screen open while it runs. It deliberately checks in small batches instead of hammering Signbank.</p>
      {error && <div className="error">{error}</div>}
    </section>

    <section className="card">
      <p className="eyebrow">Needs repair</p>
      <h2>{problemRows.length ? `${problemRows.length} course entries` : results.length ? 'Nothing flagged yet' : 'Run the audit first'}</h2>
      {problemRows.slice(0,120).map(row=><div className="row" key={`${row.lesson_slug}::${row.sign_key}`}>
        <b className={row.status==='error'?'bad':'warn'}>{row.sign_key}</b>
        <small>{row.lesson_slug} · {row.status}{row.message?` · ${row.message}`:''}</small>
      </div>)}
      {problemRows.length>120 && <p className="note">Showing the first 120 flagged entries. The complete audit is saved in Neon.</p>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<MediaAudit/>);
