import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, CircleUserRound,
  Clock3, GraduationCap, Heart, Home, LibraryBig, LoaderCircle, LogOut,
  Play, RotateCcw, Search, Sparkles, Star, X
} from 'lucide-react';
import { neon } from './neon.js';

const cx = (...v) => v.filter(Boolean).join(' ');
const shuffle = a => [...a].sort(() => Math.random() - 0.5);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[-_/]/g, ' ')
  .replace(/[^a-z0-9 ]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function errorText(error, fallback='Something went wrong.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error?.message || error.error || fallback;
}

function signName(sign) {
  return sign?.display || sign?.translations?.[0] || sign?.gloss || 'Sign';
}

function resolveCatalogSign(key, catalog) {
  const target = normalize(key);
  if (!target || !catalog?.length) return null;
  let best = null;
  let bestScore = -1;

  for (const sign of catalog) {
    const display = normalize(sign.display);
    const gloss = normalize(sign.gloss);
    const translations = (sign.translations || []).map(normalize);
    let score = -1;
    if (translations.includes(target)) score = 120;
    else if (display === target) score = 115;
    else if (gloss === target) score = 110;
    else if (translations.some(t => t.startsWith(target + ' ') || target.startsWith(t + ' '))) score = 85;
    else if (display.includes(target) || target.includes(display)) score = 75;
    else if (translations.some(t => t.includes(target) || target.includes(t))) score = 70;
    else if (gloss.includes(target) || target.includes(gloss)) score = 60;
    if (score > bestScore) { bestScore = score; best = sign; }
  }
  return bestScore >= 60 ? best : null;
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

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) return setError('Enter your email.');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (mode === 'signup' && !name.trim()) return setError('Enter your name.');
    setBusy(true);
    try {
      const result = mode === 'signup'
        ? await neon.auth.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await neon.auth.signIn.email({ email: email.trim(), password });
      if (result?.error) throw result.error;
    } catch (err) {
      setError(errorText(err, 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">ASL</div>
        <p className="eyebrow">ASLingo</p>
        <h1>{mode === 'signup' ? 'Start learning.' : 'Welcome back.'}</h1>
        <p className="muted">Unlimited ASL lessons, practice, and a searchable visual dictionary.</p>

        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && <label><span>Name</span><input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" /></label>}
          <label><span>Email</span><input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" /></label>
          <label><span>Password</span><input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete={mode==='signup'?'new-password':'current-password'} /></label>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary-button" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18}/>}
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <button className="text-button" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError('')}}>
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
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
  const [lessonItems, setLessonItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [blueprints, setBlueprints] = useState([]);
  const [categories, setCategories] = useState([]);
  const [profile, setProfile] = useState(null);
  const [letterProgress, setLetterProgress] = useState([]);
  const [lessonProgress, setLessonProgress] = useState([]);
  const [dictionaryState, setDictionaryState] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);
  const [activeSign, setActiveSign] = useState(null);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const catalogPromise = useRef(null);

  useEffect(() => { loadCore(); }, [user.id]);

  async function loadCore() {
    setLoading(true);
    setLoadError('');
    try {
      const [lettersRes, itemsRes, unitsRes, lessonsRes, blueRes, catsRes, profileRes, lpRes, lessonPRes, dictRes] = await Promise.all([
        neon.from('alphabet_letters').select('*').order('sort_order'),
        neon.from('lesson_items').select('*').order('sort_order'),
        neon.from('course_units').select('*').order('sort_order'),
        neon.from('lessons').select('*').order('sort_order'),
        neon.from('lesson_blueprints').select('*'),
        neon.from('categories').select('*').order('sort_order'),
        neon.from('user_profiles').select('*').eq('user_id', user.id),
        neon.from('user_letter_progress').select('*').eq('user_id', user.id),
        neon.from('lesson_progress').select('*').eq('user_id', user.id),
        neon.from('user_dictionary_state').select('*').eq('user_id', user.id),
      ]);
      const all = [lettersRes,itemsRes,unitsRes,lessonsRes,blueRes,catsRes,profileRes,lpRes,lessonPRes,dictRes];
      const first = all.find(r=>r.error)?.error;
      if (first) throw first;
      setLetters(lettersRes.data || []);
      setLessonItems(itemsRes.data || []);
      setUnits(unitsRes.data || []);
      setLessons(lessonsRes.data || []);
      setBlueprints(blueRes.data || []);
      setCategories(catsRes.data || []);
      setProfile(profileRes.data?.[0] || null);
      setLetterProgress(lpRes.data || []);
      setLessonProgress(lessonPRes.data || []);
      setDictionaryState(dictRes.data || []);
    } catch (err) {
      setLoadError(errorText(err, 'Could not load ASLingo.'));
    } finally { setLoading(false); }
  }

  async function ensureCatalog() {
    if (catalog) return catalog;
    if (catalogPromise.current) return catalogPromise.current;
    setCatalogError('');
    catalogPromise.current = fetch('/api/signs')
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Dictionary unavailable.');
        setCatalog(data.signs || []);
        return data.signs || [];
      })
      .catch(err => { setCatalogError(err.message); throw err; })
      .finally(()=>{ catalogPromise.current = null; });
    return catalogPromise.current;
  }

  async function finishPlacement(result) {
    const score = result.score;
    const level = score >= 85 ? 'Alphabet Strong' : score >= 60 ? 'Alphabet Developing' : 'Beginner';
    const now = new Date().toISOString();
    const profileRow = {
      user_id: user.id,
      display_name: user.name || user.email?.split('@')[0] || 'Learner',
      placement_level: level,
      onboarding_complete: true,
      updated_at: now,
    };
    const progressRows = result.answers.map(a=>({
      user_id:user.id, letter:a.letter, times_seen:1, times_correct:a.correct?1:0,
      mastery_score:a.correct?30:0, status:'learning', last_seen:now
    }));
    const [p, l] = await Promise.all([
      neon.from('user_profiles').upsert(profileRow,{onConflict:'user_id'}).select(),
      neon.from('user_letter_progress').upsert(progressRows,{onConflict:'user_id,letter'}).select()
    ]);
    if (p.error) throw p.error;
    if (l.error) throw l.error;
    setProfile(p.data?.[0] || profileRow);
    setLetterProgress(l.data || progressRows);
  }

  async function saveLetterAnswers(answers) {
    const grouped = new Map();
    answers.forEach(a=>{
      const x=grouped.get(a.letter)||{seen:0,correct:0};
      x.seen++; if(a.correct)x.correct++; grouped.set(a.letter,x);
    });
    const old = new Map(letterProgress.map(r=>[r.letter,r]));
    const now = new Date().toISOString();
    const rows=[...grouped].map(([letter,c])=>{
      const prev=old.get(letter);
      const seen=Number(prev?.times_seen||0)+c.seen;
      const correct=Number(prev?.times_correct||0)+c.correct;
      const mastery=Math.round(correct/Math.max(seen,1)*100);
      return {user_id:user.id,letter,times_seen:seen,times_correct:correct,mastery_score:mastery,
        status:seen>=4&&mastery>=80?'mastered':'learning',last_seen:now};
    });
    if (!rows.length) return;
    const res=await neon.from('user_letter_progress').upsert(rows,{onConflict:'user_id,letter'}).select();
    if(res.error) throw res.error;
    setLetterProgress(prev=>{
      const m=new Map(prev.map(r=>[r.letter,r]));
      (res.data||rows).forEach(r=>m.set(r.letter,r)); return [...m.values()];
    });
  }

  async function saveLessonProgress(lesson, score) {
    const row={user_id:user.id,lesson_slug:lesson.slug,completed:true,score,completed_at:new Date().toISOString()};
    const res=await neon.from('lesson_progress').upsert(row,{onConflict:'user_id,lesson_slug'}).select();
    if(res.error) throw res.error;
    const saved=res.data?.[0]||row;
    setLessonProgress(prev=>[...prev.filter(x=>x.lesson_slug!==lesson.slug),saved]);
  }

  async function finishAlphabetLesson(lesson, answers) {
    await saveLetterAnswers(answers);
    const score=Math.round(answers.filter(x=>x.correct).length/Math.max(answers.length,1)*100);
    await saveLessonProgress(lesson, score);
    return score;
  }

  async function finishCourseLesson(lesson, score, quizAnswers) {
    await saveLessonProgress(lesson, score);
    const grouped=new Map();
    quizAnswers.forEach(a=>{
      if(!a.sign?.id)return;
      const g=grouped.get(a.sign.id)||{sign:a.sign,seen:0,correct:0}; g.seen++; if(a.correct)g.correct++; grouped.set(a.sign.id,g);
    });
    if (!grouped.size) return;
    const existing=new Map(dictionaryState.map(r=>[r.signbank_id,r]));
    const now=new Date().toISOString();
    const rows=[...grouped.values()].map(g=>{
      const prev=existing.get(g.sign.id);
      const seen=Number(prev?.times_seen||0)+g.seen;
      const correct=Number(prev?.times_correct||0)+g.correct;
      const mastery=Math.round(correct/Math.max(seen,1)*100);
      return {
        user_id:user.id, signbank_id:g.sign.id, gloss:signName(g.sign),
        category_slug:g.sign.category||prev?.category_slug||'other',
        favorite:Boolean(prev?.favorite), status:seen>=5&&mastery>=80?'mastered':'learning',
        times_viewed:Number(prev?.times_viewed||0), last_viewed:prev?.last_viewed||now,
        times_seen:seen,times_correct:correct,mastery_score:mastery,updated_at:now
      };
    });
    const res=await neon.from('user_dictionary_state').upsert(rows,{onConflict:'user_id,signbank_id'}).select();
    if(!res.error) setDictionaryState(prev=>{
      const m=new Map(prev.map(r=>[r.signbank_id,r])); (res.data||rows).forEach(r=>m.set(r.signbank_id,r)); return [...m.values()];
    });
  }

  async function recordSignView(sign) {
    if(!sign?.id)return;
    const prev=dictionaryState.find(r=>r.signbank_id===sign.id);
    const row={
      user_id:user.id,signbank_id:sign.id,gloss:signName(sign),category_slug:sign.category||'other',
      favorite:Boolean(prev?.favorite),status:prev?.status||'new',
      times_viewed:Number(prev?.times_viewed||0)+1,last_viewed:new Date().toISOString(),
      times_seen:Number(prev?.times_seen||0),times_correct:Number(prev?.times_correct||0),
      mastery_score:Number(prev?.mastery_score||0),updated_at:new Date().toISOString()
    };
    setDictionaryState(p=>[...p.filter(x=>x.signbank_id!==sign.id),row]);
    const res=await neon.from('user_dictionary_state').upsert(row,{onConflict:'user_id,signbank_id'}).select();
    if(!res.error&&res.data?.[0])setDictionaryState(p=>[...p.filter(x=>x.signbank_id!==sign.id),res.data[0]]);
  }

  async function toggleFavorite(sign) {
    const prev=dictionaryState.find(r=>r.signbank_id===sign.id);
    const row={
      user_id:user.id,signbank_id:sign.id,gloss:signName(sign),category_slug:sign.category||'other',
      favorite:!prev?.favorite,status:prev?.status||'new',times_viewed:Number(prev?.times_viewed||0),
      last_viewed:prev?.last_viewed||new Date().toISOString(),times_seen:Number(prev?.times_seen||0),
      times_correct:Number(prev?.times_correct||0),mastery_score:Number(prev?.mastery_score||0),updated_at:new Date().toISOString()
    };
    const res=await neon.from('user_dictionary_state').upsert(row,{onConflict:'user_id,signbank_id'}).select();
    if(res.error)throw res.error;
    setDictionaryState(p=>[...p.filter(x=>x.signbank_id!==sign.id),res.data?.[0]||row]);
  }

  function itemsForAlphabet(lesson) {
    const keys=lessonItems.filter(i=>i.lesson_slug===lesson.slug).map(i=>i.ref_key);
    return letters.filter(l=>keys.includes(l.letter));
  }

  const blueprintMap=useMemo(()=>new Map(blueprints.map(b=>[b.lesson_slug,b])),[blueprints]);
  const completedSet=useMemo(()=>new Set(lessonProgress.filter(r=>r.completed).map(r=>r.lesson_slug)),[lessonProgress]);
  const nextLesson=lessons.find(l=>!completedSet.has(l.slug)) || lessons.at(-1);
  const masteredLetters=letterProgress.filter(r=>r.status==='mastered').length;

  if(loading)return <FullScreenLoading label="Loading your course…"/>;
  if(loadError)return <RetryScreen message={loadError} onRetry={loadCore}/>;
  if(!profile?.onboarding_complete)return <PlacementQuiz letters={letters} name={user.name} onComplete={finishPlacement}/>;

  return (
    <div className="app-shell">
      <div className="app-content">
        {tab==='home'&&<HomeTab user={user} units={units} lessons={lessons} completedSet={completedSet}
          nextLesson={nextLesson} masteredLetters={masteredLetters} dictionaryState={dictionaryState}
          onContinue={()=>nextLesson&&setActiveLesson(nextLesson)} onPractice={()=>setPracticeOpen(true)}
          onDictionary={()=>setTab('dictionary')} onLearn={()=>setTab('learn')} />}
        {tab==='learn'&&<LearnTab units={units} lessons={lessons} progress={lessonProgress}
          blueprintMap={blueprintMap} onStart={setActiveLesson}/>}
        {tab==='dictionary'&&<DictionaryTab categories={categories} catalog={catalog} catalogError={catalogError}
          ensureCatalog={ensureCatalog} dictionaryState={dictionaryState} onOpen={s=>{setActiveSign(s);recordSignView(s).catch(()=>null)}}/>}
        {tab==='profile'&&<ProfileTab user={user} profile={profile} units={units} lessons={lessons}
          lessonProgress={lessonProgress} dictionaryState={dictionaryState} masteredLetters={masteredLetters}/>}
      </div>
      <BottomNav tab={tab} setTab={setTab}/>

      {activeLesson && (activeLesson.lesson_type==='alphabet'
        ? <AlphabetLessonPlayer lesson={activeLesson} letters={itemsForAlphabet(activeLesson)} allLetters={letters}
            onClose={()=>setActiveLesson(null)} onFinish={finishAlphabetLesson}/>
        : <CourseLessonPlayer lesson={activeLesson} blueprint={blueprintMap.get(activeLesson.slug)}
            ensureCatalog={ensureCatalog} onClose={()=>setActiveLesson(null)} onFinish={finishCourseLesson}/>)}

      {practiceOpen&&<AlphabetPractice letters={letters} progress={letterProgress}
        onClose={()=>setPracticeOpen(false)} onFinish={saveLetterAnswers}/>}
      {activeSign&&<SignDetail sign={activeSign}
        favorite={Boolean(dictionaryState.find(r=>r.signbank_id===activeSign.id)?.favorite)}
        onFavorite={()=>toggleFavorite(activeSign)} onClose={()=>setActiveSign(null)}/>}
    </div>
  );
}

function PlacementQuiz({letters,name,onComplete}) {
  const [started,setStarted]=useState(false);
  const [questions]=useState(()=>shuffle(letters).slice(0,Math.min(12,letters.length)));
  const [index,setIndex]=useState(0); const [answers,setAnswers]=useState([]); const [selected,setSelected]=useState(null); const [busy,setBusy]=useState(false);
  if(!started)return <main className="onboarding-shell"><section className="onboarding-card">
    <div className="placement-icon"><Sparkles size={28}/></div><p className="eyebrow">Quick placement</p>
    <h1>Let’s see what you know{name?`, ${name.split(' ')[0]}`:''}.</h1>
    <p className="muted">12 alphabet questions. You can still jump anywhere in the course later.</p>
    <button className="primary-button" onClick={()=>setStarted(true)}>Start skill check</button>
  </section></main>;
  const q=questions[index];
  if(!q)return <FullScreenLoading label="Finishing…"/>;
  const opts=useMemo(()=>shuffle([q,...shuffle(letters.filter(l=>l.letter!==q.letter)).slice(0,3)]),[q.letter]);
  async function next(){
    if(!selected)return;
    const a={letter:q.letter,correct:selected===q.letter}; const all=[...answers,a];
    if(index===questions.length-1){setBusy(true);const score=Math.round(all.filter(x=>x.correct).length/all.length*100);await onComplete({score,answers:all});return;}
    setAnswers(all);setIndex(i=>i+1);setSelected(null);
  }
  return <main className="quiz-shell"><section className="quiz-card">
    <div className="progress-line"><span style={{width:`${(index/questions.length)*100}%`}}/></div>
    <p className="eyebrow">Question {index+1} of {questions.length}</p><h2>Which letter is this?</h2>
    <LetterVisual letter={q}/>
    <div className="choice-grid">{opts.map(o=><button key={o.letter} className={cx('choice',selected===o.letter&&'selected')} onClick={()=>setSelected(o.letter)}>{o.letter}</button>)}</div>
    <button className="primary-button" disabled={!selected||busy} onClick={next}>{busy?'Saving…':'Continue'}</button>
  </section></main>;
}

function HomeTab({user,units,lessons,completedSet,nextLesson,masteredLetters,dictionaryState,onContinue,onPractice,onDictionary,onLearn}) {
  const completed=completedSet.size;
  const total=lessons.length;
  const pct=Math.round(completed/Math.max(total,1)*100);
  const currentUnit=units.find(u=>u.slug===nextLesson?.unit_slug);
  return <section className="tab-page">
    <header className="page-header"><div><p className="eyebrow">ASLingo</p><h1>Hi, {user.name?.split(' ')[0]||'there'}.</h1></div><div className="level-pill">{pct}%</div></header>
    <div className="hero-card">
      <p className="card-kicker">{currentUnit?.title||'Alphabet'}</p>
      <h2>{nextLesson?.title||'Keep learning'}</h2>
      <p>{nextLesson?.objective||nextLesson?.description||'Continue where you left off.'}</p>
      <div className="hero-progress"><span style={{width:`${pct}%`}}/></div>
      <button className="primary-button dark" onClick={onContinue}><Play size={18}/> Continue lesson</button>
    </div>
    <div className="stat-grid">
      <div className="stat-card"><strong>{completed}</strong><span>Lessons done</span></div>
      <div className="stat-card"><strong>{masteredLetters}/26</strong><span>Letters mastered</span></div>
      <div className="stat-card"><strong>{dictionaryState.filter(r=>r.favorite).length}</strong><span>Saved signs</span></div>
    </div>
    <h3 className="section-title">Jump back in</h3>
    <button className="menu-card" onClick={onLearn}><GraduationCap/><span><b>Full course</b><small>{units.length} units · {total} lessons</small></span><ChevronRight/></button>
    <button className="menu-card" onClick={onPractice}><RotateCcw/><span><b>Alphabet practice</b><small>Review weak letters</small></span><ChevronRight/></button>
    <button className="menu-card" onClick={onDictionary}><LibraryBig/><span><b>Dictionary</b><small>Search the full Signbank catalog</small></span><ChevronRight/></button>
  </section>;
}

function LearnTab({units,lessons,progress,blueprintMap,onStart}) {
  const completed=new Set(progress.filter(r=>r.completed).map(r=>r.lesson_slug));
  const levels=[...new Set(units.map(u=>u.level_number))].sort((a,b)=>a-b);
  return <section className="tab-page">
    <header className="simple-header"><p className="eyebrow">Learn</p><h1>Your course</h1><p className="muted">Nothing is hard-locked. Review old material or jump ahead whenever you want.</p></header>
    {levels.map(level=><div className="level-section" key={level}>
      <div className="level-heading"><span>Level {level===0?'0':level}</span><b>{level===0?'Alphabet & Fingerspelling':levelName(level)}</b></div>
      {units.filter(u=>u.level_number===level).map(unit=>{
        const unitLessons=lessons.filter(l=>l.unit_slug===unit.slug);
        const done=unitLessons.filter(l=>completed.has(l.slug)).length;
        return <UnitCard key={unit.slug} unit={unit} lessons={unitLessons} done={done} completed={completed} blueprintMap={blueprintMap} onStart={onStart}/>;
      })}
    </div>)}
  </section>;
}

function levelName(level){
  return ({1:'Foundations',2:'Everyday Life',3:'Grammar & Description',4:'Functional ASL',5:'Intermediate Conversation',6:'Fluency Builder'})[level]||'Course';
}

function UnitCard({unit,lessons,done,completed,blueprintMap,onStart}) {
  const [open,setOpen]=useState(unit.level_number===0||done<lessons.length);
  return <div className="unit-card">
    <button className="unit-top" onClick={()=>setOpen(x=>!x)}>
      <div><p className="unit-meta">{unit.short_title||`Level ${unit.level_number}`}</p><h3>{unit.title}</h3><small>{done}/{lessons.length} complete</small></div>
      <ChevronDown className={cx('chev',open&&'open')}/>
    </button>
    <div className="unit-progress"><span style={{width:`${done/Math.max(lessons.length,1)*100}%`}}/></div>
    {open&&<div className="lesson-list">{lessons.map((lesson,i)=>{
      const isDone=completed.has(lesson.slug); const bp=blueprintMap.get(lesson.slug);
      return <button className="lesson-row" key={lesson.slug} onClick={()=>onStart(lesson)}>
        <div className={cx('lesson-number',isDone&&'done')}>{isDone?<Check size={17}/>:i+1}</div>
        <span><b>{lesson.title}</b><small>{lesson.estimated_minutes||8} min · {bp?.sign_keys?.length||0} signs</small></span>
        <ChevronRight size={19}/>
      </button>
    })}</div>}
  </div>;
}

function CourseLessonPlayer({lesson,blueprint,ensureCatalog,onClose,onFinish}) {
  const [catalog,setCatalog]=useState(null); const [resolved,setResolved]=useState([]); const [unresolved,setUnresolved]=useState([]);
  const [phase,setPhase]=useState('loading'); const [index,setIndex]=useState(0); const [notesIndex,setNotesIndex]=useState(0);
  const [questions,setQuestions]=useState([]); const [qIndex,setQIndex]=useState(0); const [selected,setSelected]=useState(null);
  const [answers,setAnswers]=useState([]); const [busy,setBusy]=useState(false); const [score,setScore]=useState(null); const [error,setError]=useState('');

  useEffect(()=>{(async()=>{
    try{
      const cat=await ensureCatalog(); setCatalog(cat);
      const keys=blueprint?.sign_keys||[];
      const mapped=keys.map(key=>({key,sign:resolveCatalogSign(key,cat)}));
      setResolved(mapped.filter(x=>x.sign)); setUnresolved(mapped.filter(x=>!x.sign).map(x=>x.key));
      setPhase(mapped.some(x=>x.sign)?'learn':'notes');
    }catch(e){setError(errorText(e,'Could not load sign videos.'));setPhase('notes')}
  })()},[lesson.slug]);

  const notes=[
    blueprint?.grammar_focus&&{type:'Grammar focus',body:blueprint.grammar_focus},
    blueprint?.culture_note&&{type:'Culture / usage',body:blueprint.culture_note},
  ].filter(Boolean);

  function startQuiz(){
    const usable=shuffle(resolved).slice(0,Math.min(6,resolved.length));
    const qs=usable.map(target=>{
      const distract=shuffle(resolved.filter(x=>x.sign.id!==target.sign.id)).slice(0,3);
      return {target,choices:shuffle([target,...distract])};
    }).filter(q=>q.choices.length>=2);
    setQuestions(qs); setPhase(qs.length?'quiz':'production');
  }

  function afterLearn(){
    if(notes.length){setNotesIndex(0);setPhase('notes')}else startQuiz();
  }

  function answerChoice(choice){
    if(selected)return;
    setSelected(choice.sign.id);
    const q=questions[qIndex]; const correct=choice.sign.id===q.target.sign.id;
    setAnswers(a=>[...a,{sign:q.target.sign,correct}]);
  }

  function nextQuestion(){
    if(qIndex===questions.length-1){
      const all=answers; // selected answer already pushed synchronously through state scheduling; derive below
      setPhase('production'); return;
    }
    setQIndex(i=>i+1);setSelected(null);
  }

  async function finish(){
    setBusy(true);
    const finalAnswers=answers;
    const s=finalAnswers.length?Math.round(finalAnswers.filter(a=>a.correct).length/finalAnswers.length*100):100;
    try{await onFinish(lesson,s,finalAnswers);setScore(s);setPhase('done')}catch(e){setError(errorText(e,'Could not save progress.'))}
    finally{setBusy(false)}
  }

  return <div className="modal-screen">
    <div className="modal-bar"><button onClick={onClose}><X/></button><div><b>{lesson.title}</b><small>{lesson.objective}</small></div><span/></div>
    <div className="lesson-stage">
      {error&&<div className="error-banner">{error}</div>}
      {phase==='loading'&&<FullScreenLoading label="Preparing lesson…"/>}
      {phase==='learn'&&resolved[index]&&<div className="learning-card">
        <p className="eyebrow">Learn {index+1} of {resolved.length}</p>
        <h1>{resolved[index].key}</h1>
        <SignVideo sign={resolved[index].sign}/>
        <div className="translation-line">Signbank gloss: <b>{resolved[index].sign.gloss}</b></div>
        <button className="primary-button" onClick={()=>{
          if(index===resolved.length-1)afterLearn();else setIndex(i=>i+1);
        }}>{index===resolved.length-1?'Continue':'Next sign'} <ChevronRight size={18}/></button>
        {unresolved.length>0&&<p className="tiny-note">{unresolved.length} course term{unresolved.length===1?'':'s'} could not be matched to a usable dictionary entry and will be skipped for now.</p>}
      </div>}
      {phase==='notes'&&<div className="note-card">
        {notes.length?<><p className="eyebrow">{notes[notesIndex]?.type}</p><h2>Use the language, not English word-for-word.</h2><p>{notes[notesIndex]?.body}</p>
          <button className="primary-button" onClick={()=>{if(notesIndex===notes.length-1)startQuiz();else setNotesIndex(i=>i+1)}}>Got it <ChevronRight size={18}/></button></>
          :<><h2>Ready for a quick check?</h2><button className="primary-button" onClick={startQuiz}>Start quiz</button></>}
      </div>}
      {phase==='quiz'&&questions[qIndex]&&<div className="quiz-card in-modal">
        <div className="progress-line"><span style={{width:`${qIndex/questions.length*100}%`}}/></div>
        <p className="eyebrow">Quick check {qIndex+1}/{questions.length}</p><h2>What does this sign mean?</h2>
        <SignVideo sign={questions[qIndex].target.sign} compact/>
        <div className="answer-list">{questions[qIndex].choices.map(c=>{
          const picked=selected===c.sign.id; const correct=c.sign.id===questions[qIndex].target.sign.id;
          return <button key={c.sign.id} disabled={Boolean(selected)} className={cx('answer-choice',selected&&correct&&'correct',picked&&!correct&&'wrong')} onClick={()=>answerChoice(c)}>
            {c.key}{selected&&correct&&<Check size={18}/>}
          </button>
        })}</div>
        {selected&&<button className="primary-button" onClick={nextQuestion}>{qIndex===questions.length-1?'Continue':'Next question'}</button>}
      </div>}
      {phase==='production'&&<div className="production-card">
        <div className="production-icon">🤟</div><p className="eyebrow">Sign it yourself</p><h2>Production challenge</h2>
        <p>{blueprint?.production_prompt||'Use the signs from this lesson in a short response.'}</p>
        <p className="muted">No camera grading yet. Sign the prompt naturally, then continue when you are satisfied with your attempt.</p>
        <button className="primary-button" disabled={busy} onClick={finish}>{busy?'Saving…':'I did it'}</button>
      </div>}
      {phase==='done'&&<div className="result-card"><div className="result-ring">{score}%</div><p className="eyebrow">Lesson complete</p><h1>{score>=80?'Nice work.':'Keep building it.'}</h1>
        <p>{score>=80?'You handled this set well.':'Review the missed signs in the dictionary or repeat this lesson whenever you want.'}</p>
        <button className="primary-button" onClick={onClose}>Back to course</button>
      </div>}
    </div>
  </div>;
}

function SignVideo({sign,compact=false}) {
  const [state,setState]=useState({loading:true,url:null,error:null});
  useEffect(()=>{let live=true;setState({loading:true,url:null,error:null});
    fetch(`/api/video?id=${encodeURIComponent(sign.id)}`).then(async r=>{const d=await r.json();if(!r.ok||!d.videoUrl)throw new Error(d.error||'Video unavailable');if(live)setState({loading:false,url:d.videoUrl,error:null})})
      .catch(e=>live&&setState({loading:false,url:null,error:e.message}));return()=>{live=false}},[sign.id]);
  if(state.loading)return <div className={cx('video-box',compact&&'compact')}><LoaderCircle className="spin"/></div>;
  if(state.error||!state.url)return <div className={cx('video-box','video-fallback',compact&&'compact')}><Play size={34}/><b>Video unavailable</b><small>{sign.gloss}</small></div>;
  return <div className={cx('video-box',compact&&'compact')}><video src={state.url} controls playsInline preload="metadata"/></div>;
}

function AlphabetLessonPlayer({lesson,letters,allLetters,onClose,onFinish}) {
  const [phase,setPhase]=useState('learn'); const [index,setIndex]=useState(0); const [questions,setQuestions]=useState([]);
  const [qIndex,setQIndex]=useState(0); const [selected,setSelected]=useState(null); const [answers,setAnswers]=useState([]); const [busy,setBusy]=useState(false); const [score,setScore]=useState(null);
  useEffect(()=>{if(!letters.length)return;setQuestions(shuffle(letters).map(t=>({target:t,choices:shuffle([t,...shuffle(allLetters.filter(x=>x.letter!==t.letter)).slice(0,3)])})))},[lesson.slug]);
  async function answer(letter){
    if(selected)return; setSelected(letter); const q=questions[qIndex]; setAnswers(a=>[...a,{letter:q.target.letter,correct:letter===q.target.letter}]);
  }
  async function next(){
    if(qIndex===questions.length-1){
      setBusy(true); const all=answers; const s=all.length?Math.round(all.filter(a=>a.correct).length/all.length*100):100;
      await onFinish(lesson,all);setScore(s);setPhase('done');setBusy(false);return;
    }
    setQIndex(i=>i+1);setSelected(null);
  }
  return <div className="modal-screen"><div className="modal-bar"><button onClick={onClose}><X/></button><div><b>{lesson.title}</b><small>Alphabet</small></div><span/></div><div className="lesson-stage">
    {phase==='learn'&&letters[index]&&<div className="learning-card"><p className="eyebrow">Letter {index+1}/{letters.length}</p><h1>{letters[index].letter}</h1><LetterVisual letter={letters[index]}/>
      {letters[index].movement_note&&<p className="tip-box">{letters[index].movement_note}</p>}
      <button className="primary-button" onClick={()=>{if(index===letters.length-1)setPhase('quiz');else setIndex(i=>i+1)}}>{index===letters.length-1?'Start quiz':'Next letter'}</button></div>}
    {phase==='quiz'&&questions[qIndex]&&<div className="quiz-card in-modal"><p className="eyebrow">Question {qIndex+1}/{questions.length}</p><h2>Which letter is this?</h2><LetterVisual letter={questions[qIndex].target}/>
      <div className="choice-grid">{questions[qIndex].choices.map(c=><button key={c.letter} className={cx('choice',selected===c.letter&&'selected')} disabled={Boolean(selected)} onClick={()=>answer(c.letter)}>{c.letter}</button>)}</div>
      {selected&&<button className="primary-button" disabled={busy} onClick={next}>{qIndex===questions.length-1?'Finish':'Next'}</button>}</div>}
    {phase==='done'&&<div className="result-card"><div className="result-ring">{score}%</div><h1>Lesson complete.</h1><button className="primary-button" onClick={onClose}>Back to course</button></div>}
  </div></div>;
}

function AlphabetPractice({letters,progress,onClose,onFinish}) {
  const ranked=[...letters].sort((a,b)=>{
    const pa=progress.find(x=>x.letter===a.letter),pb=progress.find(x=>x.letter===b.letter);
    return Number(pa?.mastery_score||0)-Number(pb?.mastery_score||0);
  });
  const qs=useMemo(()=>shuffle(ranked.slice(0,16)).slice(0,10).map(t=>({target:t,choices:shuffle([t,...shuffle(letters.filter(x=>x.letter!==t.letter)).slice(0,3)])})),[]);
  const [i,setI]=useState(0),[selected,setSelected]=useState(null),[answers,setAnswers]=useState([]),[busy,setBusy]=useState(false);
  const q=qs[i];
  async function next(){
    const all=[...answers,{letter:q.target.letter,correct:selected===q.target.letter}];
    if(i===qs.length-1){setBusy(true);await onFinish(all);setBusy(false);onClose();return}
    setAnswers(all);setI(x=>x+1);setSelected(null);
  }
  return <div className="modal-screen"><div className="modal-bar"><button onClick={onClose}><X/></button><div><b>Alphabet Practice</b><small>Weak letters first</small></div><span/></div><div className="lesson-stage"><div className="quiz-card in-modal">
    <p className="eyebrow">{i+1}/{qs.length}</p><h2>Which letter?</h2><LetterVisual letter={q.target}/><div className="choice-grid">{q.choices.map(c=><button key={c.letter} className={cx('choice',selected===c.letter&&'selected')} onClick={()=>setSelected(c.letter)}>{c.letter}</button>)}</div><button className="primary-button" disabled={!selected||busy} onClick={next}>{i===qs.length-1?'Finish':'Next'}</button>
  </div></div></div>;
}

function LetterVisual({letter}) {
  if(letter.image_url)return <div className="letter-visual"><img src={letter.image_url} alt={`ASL letter ${letter.letter}`}/></div>;
  return <div className="letter-visual placeholder"><span>{letter.letter}</span></div>;
}

function DictionaryTab({categories,catalog,catalogError,ensureCatalog,dictionaryState,onOpen}) {
  const [query,setQuery]=useState(''); const [category,setCategory]=useState('all'); const [loading,setLoading]=useState(!catalog);
  useEffect(()=>{if(!catalog)ensureCatalog().catch(()=>null).finally(()=>setLoading(false));else setLoading(false)},[]);
  const source=catalog||[];
  const filtered=useMemo(()=>{
    const q=normalize(query);
    return source.filter(s=>{
      if(category!=='all'&&s.category!==category)return false;
      if(!q)return true;
      const hay=normalize([s.display,s.gloss,...(s.translations||[])].join(' ')); return hay.includes(q);
    }).slice(0,120);
  },[source,query,category]);
  return <section className="tab-page"><header className="simple-header"><p className="eyebrow">Dictionary</p><h1>Find a sign</h1></header>
    <div className="search-box"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search English or gloss…"/>{query&&<button onClick={()=>setQuery('')}><X size={17}/></button>}</div>
    <div className="chip-scroll"><button className={cx('chip',category==='all'&&'active')} onClick={()=>setCategory('all')}>All</button>{categories.map(c=><button key={c.slug} className={cx('chip',category===c.slug&&'active')} onClick={()=>setCategory(c.slug)}>{c.name||c.title||c.slug}</button>)}</div>
    {loading&&<div className="center-pad"><LoaderCircle className="spin"/> Loading dictionary…</div>}
    {catalogError&&<div className="error-banner">{catalogError}</div>}
    {!loading&&<div className="sign-list">{filtered.map(s=>{
      const st=dictionaryState.find(r=>r.signbank_id===s.id);
      return <button className="sign-row" key={s.id} onClick={()=>onOpen(s)}><div className="sign-avatar">{(s.display||s.gloss||'?').slice(0,1)}</div><span><b>{s.display||s.gloss}</b><small>{s.gloss}{s.translations?.length?` · ${s.translations.slice(0,3).join(', ')}`:''}</small></span>{st?.favorite&&<Star size={17} fill="currentColor"/>}<ChevronRight size={18}/></button>
    })}</div>}
  </section>;
}

function SignDetail({sign,favorite,onFavorite,onClose}) {
  return <div className="modal-screen"><div className="modal-bar"><button onClick={onClose}><ArrowLeft/></button><div><b>{signName(sign)}</b><small>{sign.category}</small></div><button onClick={onFavorite}><Heart fill={favorite?'currentColor':'none'}/></button></div>
    <div className="lesson-stage"><div className="sign-detail-card"><p className="eyebrow">{sign.category?.replace('-',' ')}</p><h1>{signName(sign)}</h1><small>ID gloss: {sign.gloss}</small><SignVideo sign={sign}/>
      <h3>English translation equivalents</h3><div className="tag-wrap">{(sign.translations||[]).map(t=><span key={t}>{t}</span>)}</div>
      <a className="source-link" href={sign.sourceUrl} target="_blank" rel="noreferrer">Open original entry in ASL Signbank</a>
    </div></div></div>;
}

function ProfileTab({user,profile,units,lessons,lessonProgress,dictionaryState,masteredLetters}) {
  const done=lessonProgress.filter(r=>r.completed).length; const avg=lessonProgress.filter(r=>r.score!=null); const score=avg.length?Math.round(avg.reduce((a,b)=>a+Number(b.score),0)/avg.length):0;
  return <section className="tab-page"><header className="profile-head"><div className="profile-avatar">{(user.name||user.email||'A')[0].toUpperCase()}</div><div><p className="eyebrow">Profile</p><h1>{profile?.display_name||user.name||'Learner'}</h1><p className="muted">{user.email}</p></div></header>
    <div className="stat-grid"><div className="stat-card"><strong>{done}</strong><span>Lessons</span></div><div className="stat-card"><strong>{score}%</strong><span>Avg score</span></div><div className="stat-card"><strong>{masteredLetters}</strong><span>Letters</span></div></div>
    <div className="profile-card"><b>Placement</b><span>{profile?.placement_level||'Beginner'}</span></div>
    <div className="profile-card"><b>Course</b><span>{units.length} units · {lessons.length} lessons</span></div>
    <div className="profile-card"><b>Mastered dictionary signs</b><span>{dictionaryState.filter(r=>r.status==='mastered').length}</span></div>
    <button className="danger-button" onClick={()=>neon.auth.signOut()}><LogOut size={18}/> Sign out</button>
  </section>;
}

function BottomNav({tab,setTab}) {
  const items=[['home',Home,'Home'],['learn',GraduationCap,'Learn'],['dictionary',BookOpen,'Dictionary'],['profile',CircleUserRound,'Profile']];
  return <nav className="bottom-nav">{items.map(([id,Icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={22}/><span>{label}</span></button>)}</nav>;
}

function FullScreenLoading({label}) { return <div className="full-loading"><LoaderCircle className="spin" size={28}/><span>{label}</span></div>; }
function RetryScreen({message,onRetry}) { return <main className="auth-shell"><section className="auth-card"><h2>ASLingo hit a snag.</h2><div className="error-banner">{message}</div><button className="primary-button" onClick={onRetry}>Try again</button></section></main>; }

export default App;
