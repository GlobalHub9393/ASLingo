import { neon } from './neon.js';

const STYLE_ID = 'aslingo-auth-recovery-style';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .forgot-password-link{
      width:100%;border:0;background:transparent;color:#2d72df;
      font-weight:750;padding:8px 10px 4px;text-align:center
    }
    .auth-recovery-overlay{
      position:fixed;z-index:9999;inset:0;background:#f6f7fb;
      padding:calc(24px + env(safe-area-inset-top)) 18px calc(28px + env(safe-area-inset-bottom));
      display:grid;place-items:center;overflow:auto
    }
    .auth-recovery-card{
      width:min(100%,480px);background:#fff;border:1px solid #e1e3e8;
      border-radius:28px;padding:24px;box-shadow:0 18px 55px rgba(20,28,45,.08)
    }
    .auth-recovery-card h1{
      font-size:32px;letter-spacing:-.9px;line-height:1.08;margin:7px 0 9px
    }
    .auth-recovery-card p{line-height:1.5}
    .auth-recovery-brand{
      width:58px;height:58px;border-radius:18px;background:#2477e8;color:#fff;
      font-weight:900;display:grid;place-items:center;font-size:19px;margin-bottom:14px
    }
    .auth-recovery-label{
      display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:750;
      color:#656b74;margin:16px 0
    }
    .auth-recovery-input{
      width:100%;border:0;outline:none;background:#f3f5f8;padding:14px;
      border-radius:13px;font-size:16px;color:#111
    }
    .auth-recovery-primary{
      width:100%;border:0;border-radius:15px;background:#2b75e8;color:#fff;
      font-weight:800;padding:14px 18px
    }
    .auth-recovery-primary:disabled{opacity:.5}
    .auth-recovery-secondary{
      width:100%;border:0;background:transparent;color:#2d72df;
      font-weight:750;padding:14px 10px 4px;margin-top:6px
    }
    .auth-recovery-message{
      background:#eef9f2;color:#216d43;border:1px solid #cdebd8;
      padding:12px 13px;border-radius:13px;line-height:1.4;margin:12px 0
    }
    .auth-recovery-error{
      background:#fff0f0;color:#a12a2a;border:1px solid #ffd1d1;
      padding:12px 13px;border-radius:13px;line-height:1.4;margin:12px 0
    }
    .auth-recovery-note{font-size:12px;color:#858b95;margin-top:12px}
  `;
  document.head.appendChild(style);
}

function unwrap(result) {
  if (!result) return result;
  if (result.error) {
    const err = result.error;
    throw new Error(err.message || err.error || String(err));
  }
  return result.data ?? result;
}

async function requestPasswordReset(email) {
  const redirectTo = `${location.origin}/?reset=1`;

  if (typeof neon.auth.requestPasswordReset === 'function') {
    return unwrap(await neon.auth.requestPasswordReset({ email, redirectTo }));
  }

  if (typeof neon.auth.forgetPassword === 'function') {
    return unwrap(await neon.auth.forgetPassword({ email, redirectTo }));
  }

  if (typeof neon.auth.resetPasswordForEmail === 'function') {
    return unwrap(await neon.auth.resetPasswordForEmail(email, { redirectTo }));
  }

  throw new Error('Password recovery is not available in this ASLingo build.');
}

async function finishPasswordReset(token, newPassword) {
  if (typeof neon.auth.resetPassword === 'function') {
    return unwrap(await neon.auth.resetPassword({ token, newPassword }));
  }

  throw new Error('This reset link cannot be completed by this ASLingo build.');
}

function removeOverlay() {
  document.querySelector('.auth-recovery-overlay')?.remove();
}

function baseCard(title, copy) {
  injectStyles();
  removeOverlay();

  const overlay = document.createElement('div');
  overlay.className = 'auth-recovery-overlay';
  overlay.innerHTML = `
    <section class="auth-recovery-card">
      <div class="auth-recovery-brand">ASL</div>
      <p class="eyebrow">ASLingo account recovery</p>
      <h1>${title}</h1>
      <p class="muted">${copy}</p>
      <div data-recovery-body></div>
    </section>
  `;
  document.body.appendChild(overlay);
  return { overlay, body: overlay.querySelector('[data-recovery-body]') };
}

function openForgotPassword() {
  const { body } = baseCard(
    'Forgot your password?',
    'Enter the email used for your ASLingo account. We’ll send a secure reset link if an account matches it.'
  );

  body.innerHTML = `
    <label class="auth-recovery-label">
      <span>Email</span>
      <input class="auth-recovery-input" type="email" autocomplete="email" placeholder="you@example.com" />
    </label>
    <div data-message></div>
    <button class="auth-recovery-primary" type="button">Send reset link</button>
    <button class="auth-recovery-secondary" type="button">Back to sign in</button>
    <p class="auth-recovery-note">For privacy, ASLingo won’t confirm whether a particular email has an account.</p>
  `;

  const input = body.querySelector('input');
  const message = body.querySelector('[data-message]');
  const send = body.querySelector('.auth-recovery-primary');
  const back = body.querySelector('.auth-recovery-secondary');

  back.addEventListener('click', removeOverlay);

  async function submit() {
    const email = input.value.trim();
    message.innerHTML = '';

    if (!email || !email.includes('@')) {
      message.innerHTML = '<div class="auth-recovery-error">Enter a valid email address.</div>';
      return;
    }

    send.disabled = true;
    send.textContent = 'Sending…';

    try {
      await requestPasswordReset(email);
      message.innerHTML = `
        <div class="auth-recovery-message">
          If that email belongs to an ASLingo account, a password-reset link has been sent. Check the inbox and spam folder.
        </div>
      `;
      send.textContent = 'Send again';
    } catch (error) {
      console.error('ASLingo password reset request failed', error);
      message.innerHTML = `<div class="auth-recovery-error">${escapeHtml(error?.message || 'Could not send the reset email.')}</div>`;
      send.textContent = 'Try again';
    } finally {
      send.disabled = false;
    }
  }

  send.addEventListener('click', submit);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') submit();
  });

  setTimeout(() => input.focus(), 50);
}

function openNewPassword(token, queryError = '') {
  const invalid = queryError && queryError.toLowerCase() !== 'undefined';

  const { body } = baseCard(
    invalid ? 'Reset link expired.' : 'Choose a new password.',
    invalid
      ? 'That password-reset link is invalid or expired. Request a fresh link from the sign-in screen.'
      : 'Use at least 8 characters. After it saves, you can sign in with the new password.'
  );

  if (invalid || !token) {
    body.innerHTML = `
      <div class="auth-recovery-error">${escapeHtml(queryError || 'This reset link is missing its security token.')}</div>
      <button class="auth-recovery-primary" type="button">Back to sign in</button>
    `;
    body.querySelector('button').addEventListener('click', () => {
      history.replaceState({}, '', location.pathname);
      removeOverlay();
    });
    return;
  }

  body.innerHTML = `
    <label class="auth-recovery-label">
      <span>New password</span>
      <input class="auth-recovery-input" data-password type="password" autocomplete="new-password" />
    </label>
    <label class="auth-recovery-label">
      <span>Confirm new password</span>
      <input class="auth-recovery-input" data-confirm type="password" autocomplete="new-password" />
    </label>
    <div data-message></div>
    <button class="auth-recovery-primary" type="button">Save new password</button>
  `;

  const password = body.querySelector('[data-password]');
  const confirm = body.querySelector('[data-confirm]');
  const message = body.querySelector('[data-message]');
  const save = body.querySelector('button');

  async function submit() {
    message.innerHTML = '';

    if (password.value.length < 8) {
      message.innerHTML = '<div class="auth-recovery-error">Use at least 8 characters.</div>';
      return;
    }
    if (password.value !== confirm.value) {
      message.innerHTML = '<div class="auth-recovery-error">The two passwords do not match.</div>';
      return;
    }

    save.disabled = true;
    save.textContent = 'Saving…';

    try {
      await finishPasswordReset(token, password.value);
      message.innerHTML = '<div class="auth-recovery-message">Password changed. You can sign in now.</div>';
      save.textContent = 'Return to sign in';
      save.disabled = false;
      save.onclick = () => {
        history.replaceState({}, '', location.pathname);
        location.reload();
      };
    } catch (error) {
      console.error('ASLingo password reset completion failed', error);
      message.innerHTML = `<div class="auth-recovery-error">${escapeHtml(error?.message || 'Could not reset the password. The link may have expired.')}</div>`;
      save.textContent = 'Try again';
      save.disabled = false;
    }
  }

  save.addEventListener('click', submit);
  confirm.addEventListener('keydown', event => {
    if (event.key === 'Enter') submit();
  });

  setTimeout(() => password.focus(), 50);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function attachForgotPasswordLink() {
  const card = document.querySelector('.auth-card');
  if (!card || card.querySelector('.forgot-password-link')) return;

  const heading = card.querySelector('h1');
  if (!heading || !/welcome back/i.test(heading.textContent || '')) return;

  const form = card.querySelector('.auth-form');
  if (!form) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'forgot-password-link';
  button.textContent = 'Forgot password?';
  button.addEventListener('click', openForgotPassword);

  form.insertAdjacentElement('afterend', button);
}

function checkResetLink() {
  const params = new URLSearchParams(location.search);
  const resetRequested = params.get('reset') === '1';
  const token = params.get('token');
  const error = params.get('error');

  if (resetRequested || token || error) {
    openNewPassword(token, error || '');
    return true;
  }
  return false;
}

injectStyles();

if (!checkResetLink()) {
  const observer = new MutationObserver(attachForgotPasswordLink);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  attachForgotPasswordLink();
}
