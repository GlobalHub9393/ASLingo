import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, CircleUserRound, Clock3,
  GraduationCap, Heart, Home, LibraryBig, LoaderCircle, LogOut, Play,
  RotateCcw, Search, Settings2, Shuffle, Sparkles, Star, X
} from 'lucide-react';
import { neon } from './neon.js';

const CATEGORY_META = {
  conversation: ['Conversation', 'Everyday exchange and common responses'],
  'people-family': ['People & Family', 'People, relationships, and family'],
  'food-drink': ['Food & Drink', 'Eating, drinking, and food'],
  feelings: ['Feelings', 'Emotions and states'],
  questions: ['Questions', 'Who, what, where, when, why, how'],
  'numbers-time': ['Numbers & Time', 'Dates, time, and quantity'],
  places: ['Places', 'Locations and travel'],
  actions: ['Actions', 'Common verbs and movements'],
  descriptions: ['Descriptions', 'Qualities and descriptors'],
  school: ['School', 'Learning and education'],
  work: ['Work', 'Jobs, business, and money'],
  medical: ['Medical', 'Health and care'],
  animals: ['Animals', 'Animals and pets'],
  clothing: ['Clothing', 'Clothes and what you wear'],
  technology: ['Technology', 'Phones, computers, and digital life'],
  other: ['Other', 'Everything else'],
};

const cx = (...values) => values.filter(Boolean).join(' ');
const shuffle = array => [...array].sort(() => Math.random() - 0.5);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function errorText(error, fallback = 'Something went wrong.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error?.message || error.error || fallback;
}

function makeQuestion(target, allLetters) {
  const distractors = shuffle(allLetters.filter(item => item.letter !== target.letter)).slice(0, 3);
  return { target, options: shuffle([target, ...distractors]) };
}

function App() {
  const session = neon.auth.useSession();
  if (session.isPending) return <FullScreenLoading label="Opening ASLingo…" />;
  if (!session.data?.user) return <AuthScreen />;
  return <SignedInApp session={session.data} />;
}

function AuthScreen() {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!email.trim()) return setError('Enter your email.');
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    if (mode === 'signup' && !name.trim()) return setError('Enter your name.');
    setBusy(true);
    try {
      const result = mode === 'signup'
        ? await neon.auth.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await neon.auth.signIn.email({ email: email.trim(), password });
      if (result?.error) throw result.error;
    } catch (err) {
      setError(errorText(err, mode === 'signup' ? 'Could not create your account.' : 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark" aria-hidden="true">ASL</div>
        <p className="eyebrow">Your personal course</p>
        <h1>{mode === 'signup' ? 'Start learning.' : 'Welcome back.'}</h1>
        <p className="muted">Alphabet first. Unlimited practice. A visual sign reference when you need it.</p>

        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && (
            <label>
              <span>Name</span>
              <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
            </label>
          )}
          <label>
            <span>Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="8+ characters" />
          </label>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <button className="primary-button" disabled={busy} type="submit">
            {busy && <LoaderCircle className="spin" size={19} />}
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button className="text-button" type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}>
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
        <p className="tiny-note">Progress is saved to your private Neon account.</p>
      </section>
    </main>
  );
}

function SignedInApp({ session }) {
  const user = session.user;
  const [tab, setTab] = useState('home');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [letters, setLetters] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [lessonItems, setLessonItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [profile, setProfile] = useState(null);
  const [letterProgress, setLetterProgress] = useState([]);
  const [lessonProgress, setLessonProgress] = useState([]);
  const [dictionaryState, setDictionaryState] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [activeSign, setActiveSign] = useState(null);

  useEffect(() => { loadCore(); }, [user.id]);

  async function loadCore() {
    setLoading(true);
    setLoadError('');
    try {
      const [lettersRes, lessonsRes, itemsRes, catsRes, profileRes, lpRes, lessonPRes, dictRes] = await Promise.all([
        neon.from('alphabet_letters').select('*').order('sort_order'),
        neon.from('lessons').select('*').order('sort_order'),
        neon.from('lesson_items').select('*').order('sort_order'),
        neon.from('categories').select('*').order('sort_order'),
        neon.from('user_profiles').select('*').eq('user_id', user.id),
        neon.from('user_letter_progress').select('*').eq('user_id', user.id),
        neon.from('lesson_progress').select('*').eq('user_id', user.id),
        neon.from('user_dictionary_state').select('*').eq('user_id', user.id),
      ]);
      const firstError = [lettersRes, lessonsRes, itemsRes, catsRes, profileRes, lpRes, lessonPRes, dictRes].find(r => r.error)?.error;
      if (firstError) throw firstError;
      setLetters(lettersRes.data || []);
      setLessons(lessonsRes.data || []);
      setLessonItems(itemsRes.data || []);
      setCategories(catsRes.data || []);
      setProfile(profileRes.data?.[0] || null);
      setLetterProgress(lpRes.data || []);
      setLessonProgress(lessonPRes.data || []);
      setDictionaryState(dictRes.data || []);
    } catch (err) {
      setLoadError(errorText(err, 'Could not load your course data.'));
    } finally {
      setLoading(false);
    }
  }

  async function finishPlacement(result) {
    const level = result.score >= 85 ? 'Alphabet Strong' : result.score >= 60 ? 'Alphabet Developing' : 'Beginner';
    const now = new Date().toISOString();
    const profileRow = {
      user_id: user.id,
      display_name: user.name || user.email?.split('@')[0] || 'Learner',
      placement_level: level,
      onboarding_complete: true,
      updated_at: now,
    };
    const progressRows = result.answers.map(answer => ({
      user_id: user.id,
      letter: answer.letter,
      times_seen: 1,
      times_correct: answer.correct ? 1 : 0,
      mastery_score: answer.correct ? 30 : 0,
      status: 'learning',
      last_seen: now,
    }));

    const [profileRes, progressRes] = await Promise.all([
      neon.from('user_profiles').upsert(profileRow, { onConflict: 'user_id' }).select(),
      neon.from('user_letter_progress').upsert(progressRows, { onConflict: 'user_id,letter' }).select(),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (progressRes.error) throw progressRes.error;
    setProfile(profileRes.data?.[0] || profileRow);
    setLetterProgress(prev => {
      const map = new Map(prev.map(row => [row.letter, row]));
      (progressRes.data || progressRows).forEach(row => map.set(row.letter, row));
      return [...map.values()];
    });
  }

  async function savePracticeAnswers(answers) {
    const byLetter = new Map();
    answers.forEach(answer => {
      const current = byLetter.get(answer.letter) || { seen: 0, correct: 0 };
      current.seen += 1;
      if (answer.correct) current.correct += 1;
      byLetter.set(answer.letter, current);
    });
    const currentMap = new Map(letterProgress.map(row => [row.letter, row]));
    const now = new Date().toISOString();
    const rows = [...byLetter.entries()].map(([letter, sessionCounts]) => {
      const existing = currentMap.get(letter);
      const seen = Number(existing?.times_seen || 0) + sessionCounts.seen;
      const correct = Number(existing?.times_correct || 0) + sessionCounts.correct;
      const mastery = Math.round((correct / Math.max(seen, 1)) * 100);
      return {
        user_id: user.id,
        letter,
        times_seen: seen,
        times_correct: correct,
        mastery_score: mastery,
        status: seen >= 4 && mastery >= 80 ? 'mastered' : 'learning',
        last_seen: now,
      };
    });
    if (!rows.length) return;
    const result = await neon.from('user_letter_progress').upsert(rows, { onConflict: 'user_id,letter' }).select();
    if (result.error) throw result.error;
    setLetterProgress(prev => {
      const map = new Map(prev.map(row => [row.letter, row]));
      (result.data || rows).forEach(row => map.set(row.letter, row));
      return [...map.values()];
    });
  }

  async function finishLesson(lesson, answers) {
    await savePracticeAnswers(answers);
    const correct = answers.filter(item => item.correct).length;
    const score = Math.round((correct / Math.max(answers.length, 1)) * 100);
    const row = {
      user_id: user.id,
      lesson_slug: lesson.slug,
      completed: true,
      score,
      completed_at: new Date().toISOString(),
    };
    const result = await neon.from('lesson_progress').upsert(row, { onConflict: 'user_id,lesson_slug' }).select();
    if (result.error) throw result.error;
    setLessonProgress(prev => [...prev.filter(item => item.lesson_slug !== lesson.slug), result.data?.[0] || row]);
    return score;
  }

  function itemsForLesson(lesson) {
    const keys = lessonItems.filter(item => item.lesson_slug === lesson.slug).map(item => item.ref_key);
    return letters.filter(letter => keys.includes(letter.letter));
  }

  async function recordSignView(sign) {
    const existing = dictionaryState.find(row => row.signbank_id === sign.id);
    const row = {
      user_id: user.id,
      signbank_id: sign.id,
      gloss: sign.display || sign.gloss,
      category_slug: sign.category || 'other',
      favorite: Boolean(existing?.favorite),
      status: existing?.status || 'new',
      times_viewed: Number(existing?.times_viewed || 0) + 1,
      last_viewed: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setDictionaryState(prev => [...prev.filter(item => item.signbank_id !== sign.id), row]);
    const result = await neon.from('user_dictionary_state').upsert(row, { onConflict: 'user_id,signbank_id' }).select();
    if (!result.error && result.data?.[0]) {
      setDictionaryState(prev => [...prev.filter(item => item.signbank_id !== sign.id), result.data[0]]);
    }
  }

  async function toggleFavorite(sign) {
    const existing = dictionaryState.find(row => row.signbank_id === sign.id);
    const row = {
      user_id: user.id,
      signbank_id: sign.id,
      gloss: sign.display || sign.gloss,
      category_slug: sign.category || existing?.category_slug || 'other',
      favorite: !existing?.favorite,
      status: existing?.status || 'new',
      times_viewed: Number(existing?.times_viewed || 0),
      last_viewed: existing?.last_viewed || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setDictionaryState(prev => [...prev.filter(item => item.signbank_id !== sign.id), row]);
    const result = await neon.from('user_dictionary_state').upsert(row, { onConflict: 'user_id,signbank_id' }).select();
    if (result.error) throw result.error;
    if (result.data?.[0]) setDictionaryState(prev => [...prev.filter(item => item.signbank_id !== sign.id), result.data[0]]);
  }

  function openSign(sign) {
    setActiveSign(sign);
    recordSignView(sign).catch(() => null);
  }

  if (loading) return <FullScreenLoading label="Loading your course…" />;
  if (loadError) return <RetryScreen message={loadError} onRetry={loadCore} />;
  if (!profile?.onboarding_complete) {
    return <PlacementQuiz letters={letters} name={user.name} onComplete={finishPlacement} />;
  }

  const completedLessons = new Set(lessonProgress.filter(row => row.completed).map(row => row.lesson_slug));
  const nextLesson = lessons.find(lesson => !completedLessons.has(lesson.slug)) || lessons.at(-1);
  const mastered = letterProgress.filter(row => row.status === 'mastered').length;

  return (
    <div className="app-shell">
      <div className="app-content">
        {tab === 'home' && (
          <HomeTab
            user={user}
            profile={profile}
            mastered={mastered}
            lessons={lessons}
            completedLessons={completedLessons}
            nextLesson={nextLesson}
            dictionaryState={dictionaryState}
            onContinue={() => nextLesson && setActiveLesson(nextLesson)}
            onPractice={() => setPracticeOpen(true)}
            onDictionary={() => setTab('dictionary')}
            onOpenSign={openSign}
          />
        )}
        {tab === 'learn' && (
          <LearnTab
            lessons={lessons}
            lessonProgress={lessonProgress}
            itemsForLesson={itemsForLesson}
            onStart={setActiveLesson}
            onPractice={() => setPracticeOpen(true)}
          />
        )}
        {tab === 'dictionary' && (
          <DictionaryTab
            categories={categories}
            dictionaryState={dictionaryState}
            onOpenSign={openSign}
          />
        )}
        {tab === 'profile' && (
          <ProfileTab
            user={user}
            profile={profile}
            mastered={mastered}
            lessonProgress={lessonProgress}
            dictionaryState={dictionaryState}
          />
        )}
      </div>

      <BottomNav tab={tab} setTab={setTab} />

      {activeLesson && (
        <LessonPlayer
          lesson={activeLesson}
          letters={itemsForLesson(activeLesson)}
          allLetters={letters}
          onClose={() => setActiveLesson(null)}
          onFinish={finishLesson}
        />
      )}
      {practiceOpen && (
        <PracticePlayer
          letters={letters}
          progress={letterProgress}
          onClose={() => setPracticeOpen(false)}
          onFinish={savePracticeAnswers}
        />
      )}
      {activeSign && (
        <SignDetail
          sign={activeSign}
          favorite={Boolean(dictionaryState.find(row => row.signbank_id === activeSign.id)?.favorite)}
          onFavorite={() => toggleFavorite(activeSign)}
          onClose={() => setActiveSign(null)}
        />
      )}
    </div>
  );
}

function PlacementQuiz({ letters, name, onComplete }) {
  const [started, setStarted] = useState(false);
  const [questions] = useState(() => shuffle(letters).slice(0, Math.min(12, letters.length)).map(letter => makeQuestion(letter, letters)));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!started) {
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card">
          <div className="placement-icon"><Sparkles size={30} /></div>
          <p className="eyebrow">First things first</p>
          <h1>Let’s see what you already know{name ? `, ${name.split(' ')[0]}` : ''}.</h1>
          <p className="muted">12 quick alphabet questions. This doesn’t lock anything—it only gives the app a starting point.</p>
          <div className="mini-feature"><Clock3 size={19} /><span>About 2 minutes</span></div>
          <div className="mini-feature"><Shuffle size={19} /><span>Random letters every time</span></div>
          <button className="primary-button" onClick={() => setStarted(true)}>Start skill check</button>
          <button className="secondary-button" onClick={() => setStarted(true)}>I’m brand new — start anyway</button>
        </section>
      </main>
    );
  }

  const question = questions[index];
  if (!question) return <FullScreenLoading label="Preparing your result…" />;

  async function next() {
    if (!selected) return;
    const entry = { letter: question.target.letter, correct: selected === question.target.letter };
    const nextAnswers = [...answers, entry];
    setAnswers(nextAnswers);
    setSelected(null);
    if (index < questions.length - 1) return setIndex(index + 1);
    setSaving(true);
    setError('');
    try {
      const correct = nextAnswers.filter(item => item.correct).length;
      await onComplete({ score: Math.round((correct / nextAnswers.length) * 100), answers: nextAnswers });
    } catch (err) {
      setError(errorText(err, 'Could not save your placement result.'));
      setSaving(false);
    }
  }

  return (
    <main className="quiz-shell">
      <div className="quiz-topbar">
        <span>Placement</span>
        <div className="quiz-progress"><i style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
        <span>{index + 1}/{questions.length}</span>
      </div>
      <section className="quiz-stage">
        <p className="eyebrow">Which letter is this?</p>
        <AlphabetVisual letter={question.target} large />
        <div className="choice-grid">
          {question.options.map(option => (
            <button key={option.letter} className={cx('choice-button', selected === option.letter && 'selected')} onClick={() => setSelected(option.letter)}>
              {option.letter}
            </button>
          ))}
        </div>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button" disabled={!selected || saving} onClick={next}>
          {saving && <LoaderCircle className="spin" size={19} />}{index === questions.length - 1 ? 'See my level' : 'Next'}
        </button>
      </section>
    </main>
  );
}

function HomeTab({ user, profile, mastered, lessons, completedLessons, nextLesson, dictionaryState, onContinue, onPractice, onDictionary, onOpenSign }) {
  const firstName = (user.name || profile.display_name || 'there').split(' ')[0];
  const favorites = dictionaryState.filter(row => row.favorite).slice(0, 4);
  const recent = [...dictionaryState].filter(row => row.last_viewed).sort((a, b) => new Date(b.last_viewed).getTime() - new Date(a.last_viewed).getTime()).slice(0, 4);
  const completion = lessons.length ? Math.round((completedLessons.size / lessons.length) * 100) : 0;

  return (
    <div className="screen">
      <header className="screen-header">
        <div><p className="eyebrow">ASLingo</p><h1>Hey, {firstName}.</h1></div>
        <div className="level-pill">{profile.placement_level}</div>
      </header>

      <section className="hero-card">
        <div className="hero-card-top">
          <div>
            <span className="section-kicker">Continue learning</span>
            <h2>{nextLesson?.title || 'Alphabet Review'}</h2>
            <p>{nextLesson?.description || 'Keep your recognition sharp.'}</p>
          </div>
          <ProgressRing value={completion} />
        </div>
        <button className="hero-action" onClick={onContinue}><Play size={19} fill="currentColor" /> Continue</button>
      </section>

      <div className="stat-row">
        <div className="stat-card"><strong>{mastered}</strong><span>letters mastered</span></div>
        <div className="stat-card"><strong>{completedLessons.size}/{lessons.length}</strong><span>lessons complete</span></div>
      </div>

      <section className="section-block">
        <div className="section-heading"><h2>Quick practice</h2></div>
        <button className="wide-row-card" onClick={onPractice}>
          <div className="row-icon"><Shuffle size={22} /></div>
          <div><strong>Alphabet drill</strong><span>10 questions weighted toward weak letters</span></div>
          <ChevronRight size={20} />
        </button>
        <button className="wide-row-card" onClick={onDictionary}>
          <div className="row-icon"><LibraryBig size={22} /></div>
          <div><strong>Explore the sign reference</strong><span>Search the live ASL Signbank catalog</span></div>
          <ChevronRight size={20} />
        </button>
      </section>

      {!!recent.length && (
        <section className="section-block">
          <div className="section-heading"><h2>Recently viewed</h2></div>
          <div className="compact-list">
            {recent.map(item => (
              <button key={item.signbank_id} onClick={() => onOpenSign({ id: item.signbank_id, gloss: item.gloss, display: item.gloss, category: item.category_slug })}>
                <span>{item.gloss}</span><ChevronRight size={18} />
              </button>
            ))}
          </div>
        </section>
      )}

      {!!favorites.length && (
        <section className="section-block last-section">
          <div className="section-heading"><h2>Favorites</h2><Star size={19} /></div>
          <div className="chip-wrap">
            {favorites.map(item => <button className="favorite-chip" key={item.signbank_id} onClick={() => onOpenSign({ id: item.signbank_id, gloss: item.gloss, display: item.gloss, category: item.category_slug })}><Heart size={15} fill="currentColor" />{item.gloss}</button>)}
          </div>
        </section>
      )}
    </div>
  );
}

function LearnTab({ lessons, lessonProgress, itemsForLesson, onStart, onPractice }) {
  const progressMap = new Map(lessonProgress.map(row => [row.lesson_slug, row]));
  return (
    <div className="screen">
      <header className="screen-header single"><div><p className="eyebrow">Learn</p><h1>ASL Alphabet</h1><p className="muted">Learn the handshapes, then train recognition speed.</p></div></header>
      <div className="course-path">
        {lessons.map((lesson, index) => {
          const progress = progressMap.get(lesson.slug);
          const complete = Boolean(progress?.completed);
          const itemCount = itemsForLesson(lesson).length;
          return (
            <button key={lesson.slug} className={cx('lesson-card', complete && 'complete')} onClick={() => onStart(lesson)}>
              <div className="lesson-number">{complete ? <Check size={20} /> : index + 1}</div>
              <div className="lesson-copy">
                <strong>{lesson.title}</strong>
                <span>{lesson.description}</span>
                <small>{lesson.lesson_type === 'review' ? `${itemCount} letters · mixed review` : `${itemCount} letters · learn + quiz`}</small>
              </div>
              <div className="lesson-score">{complete ? `${Math.round(progress.score || 0)}%` : <ChevronRight size={20} />}</div>
            </button>
          );
        })}
      </div>
      <button className="practice-banner" onClick={onPractice}><Shuffle size={22} /><div><strong>Practice without a lesson</strong><span>Random 10-question alphabet drill</span></div><ChevronRight size={20} /></button>
      <section className="coming-card last-section"><GraduationCap size={23} /><div><strong>Vocabulary courses come next</strong><span>The course engine is already built to expand beyond the alphabet.</span></div></section>
    </div>
  );
}

function DictionaryTab({ categories, dictionaryState, onOpenSign }) {
  const [signs, setSigns] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [visible, setVisible] = useState(80);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/signs')
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not load the sign catalog.');
        return body;
      })
      .then(body => { if (active) setSigns(body.signs || []); })
      .catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, []);

  useEffect(() => setVisible(80), [query, category, onlyFavorites]);

  const favorites = useMemo(() => new Set(dictionaryState.filter(row => row.favorite).map(row => row.signbank_id)), [dictionaryState]);
  const filtered = useMemo(() => {
    if (!signs) return [];
    const needle = query.trim().toLowerCase();
    return signs.filter(sign => {
      if (category !== 'all' && sign.category !== category) return false;
      if (onlyFavorites && !favorites.has(sign.id)) return false;
      if (!needle) return true;
      return sign.gloss.toLowerCase().includes(needle)
        || sign.display.toLowerCase().includes(needle)
        || sign.translations.some(value => value.toLowerCase().includes(needle));
    });
  }, [signs, query, category, onlyFavorites, favorites]);

  const categoryList = categories.length ? categories : Object.keys(CATEGORY_META).map((slug, i) => ({ slug, name: CATEGORY_META[slug][0], sort_order: i }));

  return (
    <div className="screen dictionary-screen">
      <header className="screen-header single"><div><p className="eyebrow">Reference</p><h1>Dictionary</h1><p className="muted">Search ASL Signbank’s live sign catalog and see documented variants.</p></div></header>
      <div className="search-box"><Search size={20} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a word or gloss…" autoCapitalize="none" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={18} /></button>}</div>
      <div className="filter-strip">
        <button className={cx('filter-chip', category === 'all' && !onlyFavorites && 'active')} onClick={() => { setCategory('all'); setOnlyFavorites(false); }}>All</button>
        <button className={cx('filter-chip', onlyFavorites && 'active')} onClick={() => setOnlyFavorites(!onlyFavorites)}><Heart size={15} fill={onlyFavorites ? 'currentColor' : 'none'} /> Favorites</button>
        {categoryList.map(cat => <button key={cat.slug} className={cx('filter-chip', category === cat.slug && !onlyFavorites && 'active')} onClick={() => { setCategory(cat.slug); setOnlyFavorites(false); }}>{cat.name}</button>)}
      </div>

      {!signs && !error && <div className="dictionary-loading"><LoaderCircle className="spin" /><strong>Loading the live sign catalog…</strong><span>The first load pulls thousands of entries, then your browser keeps the experience fast.</span></div>}
      {error && <div className="error-card"><strong>Dictionary unavailable</strong><span>{error}</span><button onClick={() => location.reload()}>Try again</button></div>}
      {signs && (
        <>
          <div className="results-line"><strong>{filtered.length.toLocaleString()}</strong> {filtered.length === 1 ? 'sign' : 'signs'}{category !== 'all' ? ` · ${CATEGORY_META[category]?.[0] || category}` : ''}</div>
          <div className="dictionary-list">
            {filtered.slice(0, visible).map(sign => (
              <button key={sign.id} className="sign-row" onClick={() => onOpenSign(sign)}>
                <div className="sign-row-main"><strong>{sign.display}</strong><span>{sign.gloss !== sign.display ? sign.gloss : (sign.translations.slice(1, 3).join(' · ') || 'ASL Signbank')}</span></div>
                <div className="sign-row-meta">{favorites.has(sign.id) && <Heart size={16} fill="currentColor" />}<span>{CATEGORY_META[sign.category]?.[0] || 'Other'}</span><ChevronRight size={19} /></div>
              </button>
            ))}
          </div>
          {!filtered.length && <div className="empty-state"><Search size={28} /><strong>No matches</strong><span>Try a broader English word or switch categories.</span></div>}
          {visible < filtered.length && <button className="secondary-button load-more" onClick={() => setVisible(v => v + 100)}>Show 100 more</button>}
          <div className="source-note last-section">Reference videos and sign metadata: ASL Signbank (2026). This app uses Signbank as a visual reference, not as a substitute for learning ASL in context.</div>
        </>
      )}
    </div>
  );
}

function ProfileTab({ user, profile, mastered, lessonProgress, dictionaryState }) {
  const favorites = dictionaryState.filter(row => row.favorite).length;
  const viewed = dictionaryState.filter(row => row.times_viewed > 0).length;
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try { await neon.auth.signOut(); }
    finally { setSigningOut(false); }
  }

  return (
    <div className="screen">
      <header className="profile-header"><div className="avatar">{(user.name || user.email || 'A').slice(0, 1).toUpperCase()}</div><h1>{user.name || 'ASLingoer'}</h1><p>{user.email}</p><span>{profile.placement_level}</span></header>
      <div className="profile-stats"><div><strong>{mastered}</strong><span>mastered letters</span></div><div><strong>{lessonProgress.filter(row => row.completed).length}</strong><span>lessons</span></div><div><strong>{favorites}</strong><span>favorites</span></div><div><strong>{viewed}</strong><span>signs viewed</span></div></div>
      <section className="profile-section"><div className="profile-section-title"><Settings2 size={20} /><h2>About this build</h2></div><p>Version 0.1 starts with alphabet learning, smart practice, Neon-synced progress, favorites, and a live categorized sign reference.</p></section>
      <section className="profile-section"><div className="profile-section-title"><BookOpen size={20} /><h2>Sources & attribution</h2></div><p>Alphabet artwork is based on public-domain ASL fingerspelling materials hosted by Wikimedia Commons.</p><p>Sign reference content: Hochgesang, J. A., Crasborn, O., & Lillo-Martin, D. (2026 (2017–2026)). <em>ASL Signbank</em>.</p><a href="https://aslsignbank.com" target="_blank" rel="noreferrer">Open ASL Signbank</a></section>
      <button className="signout-button last-section" disabled={signingOut} onClick={signOut}>{signingOut ? <LoaderCircle className="spin" size={19} /> : <LogOut size={19} />} Sign out</button>
    </div>
  );
}

function LessonPlayer({ lesson, letters, allLetters, onClose, onFinish }) {
  const reviewOnly = lesson.lesson_type === 'review';
  const [phase, setPhase] = useState(reviewOnly ? 'quiz' : 'learn');
  const [learnIndex, setLearnIndex] = useState(0);
  const [questions] = useState(() => {
    const pool = reviewOnly ? shuffle(letters).slice(0, Math.min(10, letters.length)) : shuffle(letters);
    return pool.map(letter => makeQuestion(letter, allLetters));
  });
  const [quizIndex, setQuizIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [doneScore, setDoneScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const currentLetter = letters[learnIndex];
  const question = questions[quizIndex];

  async function answerNext() {
    if (!selected || !question) return;
    const nextAnswers = [...answers, { letter: question.target.letter, correct: selected === question.target.letter }];
    setAnswers(nextAnswers);
    setSelected(null);
    if (quizIndex < questions.length - 1) return setQuizIndex(quizIndex + 1);
    setSaving(true);
    try {
      const score = await onFinish(lesson, nextAnswers);
      setDoneScore(score);
    } catch (err) {
      setError(errorText(err, 'Could not save this lesson.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay-screen">
      <div className="overlay-topbar"><button onClick={onClose}><X size={23} /></button><strong>{lesson.title}</strong><span>{doneScore !== null ? 'Done' : phase === 'learn' ? `${learnIndex + 1}/${letters.length}` : `${quizIndex + 1}/${questions.length}`}</span></div>
      {doneScore !== null ? (
        <section className="completion-stage"><div className="completion-check"><Check size={38} /></div><p className="eyebrow">Lesson complete</p><h1>{doneScore}%</h1><p>{doneScore >= 80 ? 'Nice recognition. Those letters are moving toward mastery.' : 'Good start. The app will keep these letters in your practice rotation.'}</p><button className="primary-button" onClick={onClose}>Back to course</button></section>
      ) : phase === 'learn' ? (
        <section className="learn-stage">
          <div className="lesson-progress"><i style={{ width: `${((learnIndex + 1) / letters.length) * 100}%` }} /></div>
          <p className="eyebrow">Learn the handshape</p>
          <AlphabetVisual letter={currentLetter} large />
          <h1 className="giant-letter">{currentLetter?.letter}</h1>
          <p className="tip-copy">{currentLetter?.tips}</p>
          {currentLetter?.movement_note && <div className="movement-note"><RotateCcw size={19} /><span>{currentLetter.movement_note}</span></div>}
          <button className="primary-button" onClick={() => {
            if (learnIndex < letters.length - 1) setLearnIndex(learnIndex + 1);
            else setPhase('quiz');
          }}>{learnIndex < letters.length - 1 ? 'Next letter' : 'Start quiz'}</button>
        </section>
      ) : (
        <section className="quiz-stage lesson-quiz-stage">
          <div className="lesson-progress"><i style={{ width: `${((quizIndex + 1) / questions.length) * 100}%` }} /></div>
          <p className="eyebrow">Which letter is this?</p>
          <AlphabetVisual letter={question?.target} large />
          <div className="choice-grid">{question?.options.map(option => <button key={option.letter} className={cx('choice-button', selected === option.letter && 'selected')} onClick={() => setSelected(option.letter)}>{option.letter}</button>)}</div>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary-button" disabled={!selected || saving} onClick={answerNext}>{saving && <LoaderCircle className="spin" size={19} />}{quizIndex === questions.length - 1 ? 'Finish lesson' : 'Next'}</button>
        </section>
      )}
    </div>
  );
}

function PracticePlayer({ letters, progress, onClose, onFinish }) {
  const progressMap = new Map(progress.map(row => [row.letter, row]));
  const weighted = [...letters].sort((a, b) => Number(progressMap.get(a.letter)?.mastery_score || 0) - Number(progressMap.get(b.letter)?.mastery_score || 0));
  const pool = [...weighted.slice(0, 14), ...shuffle(letters).slice(0, 8)];
  const [questions] = useState(() => shuffle(pool).slice(0, 10).map(letter => makeQuestion(letter, letters)));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [score, setScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const question = questions[index];

  async function next() {
    if (!selected) return;
    const nextAnswers = [...answers, { letter: question.target.letter, correct: selected === question.target.letter }];
    setAnswers(nextAnswers); setSelected(null);
    if (index < questions.length - 1) return setIndex(index + 1);
    setSaving(true);
    try {
      await onFinish(nextAnswers);
      setScore(Math.round((nextAnswers.filter(a => a.correct).length / nextAnswers.length) * 100));
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  return (
    <div className="overlay-screen">
      <div className="overlay-topbar"><button onClick={onClose}><X size={23} /></button><strong>Alphabet Drill</strong><span>{score !== null ? 'Done' : `${index + 1}/10`}</span></div>
      {score !== null ? <section className="completion-stage"><div className="completion-check"><Check size={38} /></div><p className="eyebrow">Practice saved</p><h1>{score}%</h1><p>Your weak-letter weighting will adjust from this result.</p><button className="primary-button" onClick={onClose}>Done</button></section> : <section className="quiz-stage lesson-quiz-stage"><div className="lesson-progress"><i style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div><p className="eyebrow">Which letter is this?</p><AlphabetVisual letter={question?.target} large /><div className="choice-grid">{question?.options.map(option => <button key={option.letter} className={cx('choice-button', selected === option.letter && 'selected')} onClick={() => setSelected(option.letter)}>{option.letter}</button>)}</div>{error && <div className="error-banner">{error}</div>}<button className="primary-button" disabled={!selected || saving} onClick={next}>{saving && <LoaderCircle className="spin" size={19} />}{index === questions.length - 1 ? 'Finish' : 'Next'}</button></section>}
    </div>
  );
}

function SignDetail({ sign, favorite, onFavorite, onClose }) {
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/video?id=${encodeURIComponent(sign.id)}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok && !body.unavailable) throw new Error(body.error || 'Video unavailable.');
        return body;
      })
      .then(body => { if (active) setVideo(body); })
      .catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [sign.id]);

  function setSpeed(speed) {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    videoRef.current.play().catch(() => null);
  }

  async function favoriteClick() {
    setFavoriteBusy(true);
    try { await onFavorite(); }
    finally { setFavoriteBusy(false); }
  }

  const translations = sign.translations || [];
  return (
    <div className="overlay-screen sign-overlay">
      <div className="overlay-topbar"><button onClick={onClose}><ArrowLeft size={23} /></button><strong>Sign reference</strong><button className={cx('heart-top', favorite && 'active')} disabled={favoriteBusy} onClick={favoriteClick}><Heart size={22} fill={favorite ? 'currentColor' : 'none'} /></button></div>
      <section className="sign-detail-stage">
        <div className="sign-title"><p className="eyebrow">{CATEGORY_META[sign.category]?.[0] || 'ASL Signbank'}</p><h1>{sign.display || sign.gloss}</h1>{sign.gloss && sign.gloss !== sign.display && <span>ID gloss: {sign.gloss}</span>}</div>
        <div className="video-card">
          {!video && !error && <div className="video-loading"><LoaderCircle className="spin" /><span>Resolving video…</span></div>}
          {video?.videoUrl && <video ref={videoRef} src={video.videoUrl} controls autoPlay muted playsInline loop preload="metadata" />}
          {(video?.unavailable || error) && <div className="video-unavailable"><Play size={30} /><strong>Video couldn’t be embedded</strong><span>You can still open this entry directly in ASL Signbank.</span></div>}
        </div>
        {video?.videoUrl && <div className="video-actions"><button onClick={() => { if (videoRef.current) { videoRef.current.currentTime = 0; videoRef.current.playbackRate = 1; videoRef.current.play().catch(() => null); } }}><RotateCcw size={18} /> Replay</button><button onClick={() => setSpeed(.5)}>0.5×</button><button onClick={() => setSpeed(1)}>1×</button></div>}
        {!!translations.length && <div className="translation-card"><strong>English translation equivalents</strong><div className="chip-wrap">{translations.slice(0, 18).map(value => <span className="translation-chip" key={value}>{value}</span>)}</div></div>}
        <div className="reference-warning"><strong>Visual reference, not a complete lesson</strong><p>ASL Signbank documents real ASL forms and variation. Context, facial grammar, and community usage matter beyond an isolated clip.</p></div>
        <a className="source-link" href={sign.sourceUrl || video?.sourceUrl || `https://aslsignbank.com/dictionary/gloss/${sign.id}.html`} target="_blank" rel="noreferrer">View this sign in ASL Signbank <ChevronRight size={18} /></a>
        <p className="source-note">Source: ASL Signbank (2026). Used under its noncommercial reuse terms with attribution.</p>
      </section>
    </div>
  );
}

function AlphabetVisual({ letter, large = false }) {
  const [failed, setFailed] = useState(false);
  if (!letter) return null;
  return (
    <div className={cx('alphabet-visual', large && 'large')}>
      {!failed ? <img src={letter.image_url} alt={`ASL fingerspelling handshape for ${letter.letter}`} onError={() => setFailed(true)} /> : <div className="letter-fallback">{letter.letter}</div>}
      {letter.movement_note && <div className="movement-badge"><RotateCcw size={15} /> movement</div>}
    </div>
  );
}

function ProgressRing({ value }) {
  const safe = clamp(Math.round(value || 0), 0, 100);
  return <div className="progress-ring" style={{ '--progress': `${safe * 3.6}deg` }}><div><strong>{safe}%</strong><span>course</span></div></div>;
}

function BottomNav({ tab, setTab }) {
  const items = [
    ['home', Home, 'Home'],
    ['learn', GraduationCap, 'Learn'],
    ['dictionary', LibraryBig, 'Dictionary'],
    ['profile', CircleUserRound, 'Profile'],
  ];
  return <nav className="bottom-nav" aria-label="Main navigation">{items.map(([key, Icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={22} strokeWidth={tab === key ? 2.5 : 2} /><span>{label}</span></button>)}</nav>;
}

function FullScreenLoading({ label }) {
  return <main className="center-screen"><LoaderCircle className="spin" size={30} /><strong>{label}</strong></main>;
}

function RetryScreen({ message, onRetry }) {
  return <main className="center-screen"><div className="error-card"><strong>Couldn’t open ASLingo</strong><span>{message}</span><button onClick={onRetry}>Try again</button></div></main>;
}

export default App;
