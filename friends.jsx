import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Check, Copy, Flame, Trash2, UserPlus, X } from 'lucide-react';
import { neon } from './neon.js';
import './friends.css';

const localDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function errText(error, fallback='Something went wrong.') {
  return error?.message || error?.error?.message || error?.error || fallback;
}

function FriendsApp() {
  const session = neon.auth.useSession();
  const user = session.data?.user;
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (session.isPending) return;
    if (!user) {
      location.href = '/';
      return;
    }
    loadSocial();
  }, [session.isPending, user?.id]);

  async function loadSocial() {
    setLoading(true);
    setError('');
    try {
      let mine = await neon.from('social_profiles').select('*').eq('user_id', user.id);
      if (mine.error) throw mine.error;

      if (!mine.data?.[0]) {
        mine = await neon.from('social_profiles').insert({
          user_id: user.id,
          display_name: user.name || user.email?.split('@')[0] || 'Learner',
        }).select();
        if (mine.error) throw mine.error;
      }

      const [profilesRes, linksRes] = await Promise.all([
        neon.from('social_profiles').select('*'),
        neon.from('friendships').select('*'),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (linksRes.error) throw linksRes.error;

      setMe(mine.data?.[0] || null);
      setProfiles(profilesRes.data || []);
      setLinks(linksRes.data || []);
    } catch (e) {
      setError(errText(e, 'Friends beta is not available yet.'));
    } finally {
      setLoading(false);
    }
  }

  const profileMap = useMemo(() => new Map(profiles.map(p => [p.user_id, p])), [profiles]);
  const accepted = links.filter(l => l.status === 'accepted');
  const inbound = links.filter(l => l.status === 'pending' && l.addressee_id === user?.id);
  const outbound = links.filter(l => l.status === 'pending' && l.requester_id === user?.id);

  const friends = accepted.map(link => {
    const otherId = link.requester_id === user.id ? link.addressee_id : link.requester_id;
    return { link, profile: profileMap.get(otherId) };
  }).filter(x => x.profile);

  async function addFriend() {
    const value = code.trim().toUpperCase();
    setMessage('');
    setError('');
    if (!value) return setError('Enter a friend code.');
    setBusy(true);
    try {
      const found = await neon.from('social_profiles').select('*').eq('friend_code', value).limit(1);
      if (found.error) throw found.error;
      const target = found.data?.[0];
      if (!target) throw new Error('No ASLingo user has that friend code.');
      if (target.user_id === user.id) throw new Error('That is your own friend code.');

      const existing = links.find(link =>
        (link.requester_id === user.id && link.addressee_id === target.user_id) ||
        (link.requester_id === target.user_id && link.addressee_id === user.id)
      );
      if (existing?.status === 'accepted') throw new Error('You are already friends.');
      if (existing?.status === 'pending') throw new Error('A friend request is already pending.');

      if (existing) {
        const reopened = await neon.from('friendships').update({
          requester_id: user.id,
          addressee_id: target.user_id,
          status: 'pending',
          responded_at: null,
        }).eq('id', existing.id).select();
        if (reopened.error) throw reopened.error;
      } else {
        const created = await neon.from('friendships').insert({
          requester_id: user.id,
          addressee_id: target.user_id,
          status: 'pending',
        }).select();
        if (created.error) throw created.error;
      }

      setCode('');
      setMessage(`Friend request sent to ${target.display_name}.`);
      await loadSocial();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function respond(link, status) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await neon.from('friendships').update({
        status,
        responded_at: new Date().toISOString(),
      }).eq('id', link.id).select();
      if (res.error) throw res.error;
      setMessage(status === 'accepted' ? 'Friend added.' : 'Request declined.');
      await loadSocial();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeFriend(link) {
    if (!confirm('Remove this friend? Your learning progress will not be affected.')) return;
    setBusy(true);
    try {
      const res = await neon.from('friendships').delete().eq('id', link.id);
      if (res.error) throw res.error;
      await loadSocial();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!me?.friend_code) return;
    try {
      await navigator.clipboard?.writeText(me.friend_code);
      setMessage('Friend code copied.');
    } catch {
      setMessage(`Your friend code is ${me.friend_code}.`);
    }
  }

  async function resetProgress() {
    const first = confirm('Reset ALL learning progress? This keeps your account and friends, but clears completed lessons, scores, letter/sign mastery, favorites, practice history, and your streak.');
    if (!first) return;
    const typed = prompt('Type RESET to confirm.');
    if (typed !== 'RESET') return;

    setBusy(true);
    setMessage('');
    setError('');
    try {
      const tables = [
        'practice_events',
        'user_dictionary_state',
        'user_letter_progress',
        'user_sign_progress',
        'favorites',
        'lesson_progress',
      ];

      for (const table of tables) {
        const res = await neon.from(table).delete().eq('user_id', user.id);
        if (res.error) throw res.error;
      }

      const profileRes = await neon.from('user_profiles').update({
        placement_level: null,
        onboarding_complete: false,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
      if (profileRes.error) throw profileRes.error;

      const socialRes = await neon.from('social_profiles').update({
        current_streak: 0,
        longest_streak: 0,
        last_active_on: null,
        total_study_days: 0,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
      if (socialRes.error) throw socialRes.error;

      alert('Progress reset. Your account and friends were kept.');
      location.href = '/';
    } catch (e) {
      setError(errText(e, 'Could not reset progress.'));
    } finally {
      setBusy(false);
    }
  }

  if (session.isPending || loading) return <div className="loading">Loading friends & streaks…</div>;
  if (!user) return null;

  const today = localDateKey();

  return <main className="social-page">
    <header className="topbar">
      <button className="back" onClick={() => location.href='/'} aria-label="Back to ASLingo"><ArrowLeft size={22}/></button>
      <div><p className="eyebrow">Social beta</p><h1>Friends & streaks</h1></div>
    </header>

    <section className="card hero">
      <div className="hero-grid">
        <div>
          <p className="eyebrow">Your streak</p>
          <div className="streak">🔥 {Number(me?.current_streak || 0)}</div>
          <p className="muted mini">{me?.last_active_on === today ? 'Studied today' : 'Complete a lesson or study quiz today to keep it going.'}</p>
        </div>
        <div>
          <p className="muted mini">Longest streak</p>
          <b>{Number(me?.longest_streak || 0)} days</b>
          <p className="muted mini">{Number(me?.total_study_days || 0)} total study days</p>
        </div>
      </div>
    </section>

    <section className="card">
      <p className="eyebrow">Your friend code</p>
      <div className="friend-code">
        <div className="code">{me?.friend_code || '--------'}</div>
        <button className="copy" onClick={copyCode}><Copy size={17}/></button>
      </div>
      <p className="muted mini">Share this code with another ASLingo user. It does not expose your email.</p>
    </section>

    <section className="card">
      <h2 className="section-title"><UserPlus size={19}/> Add a friend</h2>
      <div className="add-row">
        <input value={code} onChange={e=>setCode(e.target.value)} maxLength={12} placeholder="Friend code" />
        <button className="primary" disabled={busy} onClick={addFriend}>Send request</button>
      </div>
      {message && <div className="message">{message}</div>}
      {error && <div className="error">{error}</div>}
    </section>

    {inbound.length > 0 && <section className="card">
      <p className="eyebrow">Requests</p>
      {inbound.map(link => {
        const p = profileMap.get(link.requester_id);
        return <div className="friend" key={link.id}>
          <div className="avatar">{(p?.display_name || '?')[0].toUpperCase()}</div>
          <div className="friend-main">
            <b>{p?.display_name || 'ASLingo learner'}</b>
            <small>Wants to be friends</small>
            <div className="request-actions">
              <button className="primary" disabled={busy} onClick={()=>respond(link,'accepted')}><Check size={15}/> Accept</button>
              <button className="secondary" disabled={busy} onClick={()=>respond(link,'declined')}><X size={15}/> Decline</button>
            </div>
          </div>
        </div>;
      })}
    </section>}

    <section className="card">
      <p className="eyebrow">Friends</p>
      {friends.length ? friends.map(({link,profile:p}) => <div className="friend" key={link.id}>
        <div className="avatar">{(p.display_name || '?')[0].toUpperCase()}</div>
        <div className="friend-main">
          <b>{p.display_name}</b>
          <small><span className={`status-dot ${p.last_active_on===today?'today':''}`}></span>{p.last_active_on===today?'Studied today':'Not studied today'}</small>
        </div>
        <div className="friend-streak"><b>🔥 {Number(p.current_streak || 0)}</b><small>{Number(p.longest_streak || 0)} best</small></div>
        <button className="secondary" disabled={busy} onClick={()=>removeFriend(link)} aria-label={`Remove ${p.display_name}`}><Trash2 size={16}/></button>
      </div>) : <div className="empty">No friends yet. Share your code or add theirs above.</div>}
      {outbound.length > 0 && <p className="muted mini">{outbound.length} outgoing friend request{outbound.length===1?'':'s'} pending.</p>}
    </section>

    <section className="card">
      <p className="eyebrow">Reset</p>
      <h2 className="section-title">Reset learning progress</h2>
      <p className="reset-copy">This clears <b>lesson completion, quiz scores, mastery, favorites, practice history, and streaks</b>. Your login and friends stay intact.</p>
      <button className="danger" disabled={busy} onClick={resetProgress}><Trash2 size={17}/> Reset my progress</button>
    </section>

    <p className="footer-note">Friends & streaks are beta. Streaks advance when ASLingo detects a completed lesson or cumulative study quiz.</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<FriendsApp/>);
