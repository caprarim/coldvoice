'use strict';

const config = window.COLDVOICE_CONFIG || {};
const statusEl = document.querySelector('[data-auth-status]');
const form = document.querySelector('[data-auth-form]');

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `auth-status ${type || ''}`.trim();
}

function supabaseClient() {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) return null;
  return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
}

if (form) {
  const mode = form.getAttribute('data-auth-form');
  const client = supabaseClient();

  if (!client) {
    setStatus('Supabase credentials are not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel to activate auth.', 'warn');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');

    if (!client) {
      setStatus('Auth is wired, but Supabase env vars are missing.', 'warn');
      return;
    }

    setStatus(mode === 'signup' ? 'Creating account...' : 'Logging in...', '');
    const result = mode === 'signup'
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });

    if (result.error) {
      setStatus(result.error.message, 'error');
      return;
    }

    setStatus(mode === 'signup' ? 'Account created. Check your email if confirmation is enabled.' : 'Logged in.', 'ok');
  });
}
