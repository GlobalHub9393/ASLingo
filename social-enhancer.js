import { neon } from './neon.js';

const localDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateKey(d);
};

async function currentUser() {
  try {
    const result = await neon.auth.getSession();
    const data = result?.data ?? result;
    return data?.user || null;
  } catch {
    return null;
  }
}

async function ensureSocialProfile(user) {
  const found = await neon.from('social_profiles').select('*').eq('user_id', user.id);
  if (found.error) throw found.error;
  if (found.data?.[0]) return found.data[0];

  const created = await neon.from('social_profiles').insert({
    user_id: user.id,
    display_name: user.name || user.email?.split('@')[0] || 'Learner',
  }).select();
  if (created.error) throw created.error;
  return created.data?.[0] || null;
}

async function markStudyDay() {
  const user = await currentUser();
  if (!user) return;

  try {
    const profile = await ensureSocialProfile(user);
    if (!profile) return;

    const today = localDateKey();
    if (profile.last_active_on === today) return;

    const continued = profile.last_active_on === yesterdayKey();
    const currentStreak = continued ? Number(profile.current_streak || 0) + 1 : 1;
    const longestStreak = Math.max(Number(profile.longest_streak || 0), currentStreak);

    await neon.from('social_profiles').update({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_active_on: today,
      total_study_days: Number(profile.total_study_days || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id);
  } catch {
    // Social beta must never interfere with the course.
  }
}

async function addProfileLink(page) {
  if (!page || page.querySelector('.friends-streaks-entry')) return;

  const button = document.createElement('button');
  button.className = 'menu-card friends-streaks-entry';
  button.type = 'button';
  button.innerHTML = '<div style="font-size:24px;width:26px;text-align:center">🔥</div><span><b>Friends & streaks</b><small>Friend codes, shared streaks, and social beta</small></span><div style="font-size:20px">›</div>';
  button.addEventListener('click', () => { location.href = '/friends.html'; });

  const danger = page.querySelector('.danger-button');
  if (danger) page.insertBefore(button, danger);
  else page.appendChild(button);

  const user = await currentUser();
  if (!user) return;
  try {
    const profile = await ensureSocialProfile(user);
    const small = button.querySelector('small');
    if (profile && small) {
      small.textContent = `🔥 ${Number(profile.current_streak || 0)} day streak · Friends & social beta`;
    }
  } catch {
    // Feature may not be enabled in the database yet.
  }
}

function scan() {
  const profileHead = document.querySelector('.profile-head');
  if (profileHead) addProfileLink(profileHead.closest('.tab-page')).catch(() => null);

  document.querySelectorAll('.result-card').forEach(card => {
    if (card.dataset.socialActivityMarked === '1') return;
    const text = (card.textContent || '').toLowerCase();
    if (text.includes('lesson complete') || text.includes('cumulative review')) {
      card.dataset.socialActivityMarked = '1';
      markStudyDay();
    }
  });
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList:true, subtree:true });
scan();
