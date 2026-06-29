'use strict';

// ColdVoice account layer. Rules (per product spec):
//   - Sign in / sign up require a network connection. When offline, the form is
//     blocked, BUT an existing session keeps the user signed in and the app keeps
//     working fully offline.
//   - If Supabase credentials are configured (env or a local coldvoice.config.json
//     next to the app), real Supabase email/password auth is used. Otherwise a
//     local-only account is created so the flow still works end-to-end.
// The session is persisted in the local settings table, so it survives restarts
// and remains valid offline.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const db = require('./db');
const net = require('./net');
const { log } = require('./log');

const SESSION_KEY = 'auth.session';

function readConfig() {
  const candidates = [
    process.env.SUPABASE_URL && {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY || '',
    },
  ].filter(Boolean);
  const files = [
    path.join(process.resourcesPath || '', 'coldvoice.config.json'),
    path.join(app.getPath('userData'), 'coldvoice.config.json'),
  ];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (json.supabaseUrl) candidates.push({ url: json.supabaseUrl, anonKey: json.supabaseAnonKey || '' });
      }
    } catch (e) {
      log('auth: config read failed:', e && e.message);
    }
  }
  return candidates[0] || null;
}

function loadSession() {
  try {
    const raw = db.getSetting(SESSION_KEY, null);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) db.setSetting(SESSION_KEY, JSON.stringify(session));
  else db.setSetting(SESSION_KEY, '');
}

function status() {
  const session = loadSession();
  return {
    signedIn: !!(session && session.email),
    email: session ? session.email : null,
    local: session ? !!session.local : false,
    online: net.isOnline(),
  };
}

async function supabaseSignIn(cfg, mode, email, password) {
  const base = cfg.url.replace(/\/+$/, '');
  const endpoint = mode === 'signup'
    ? `${base}/auth/v1/signup`
    : `${base}/auth/v1/token?grant_type=password`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.msg || data.error || `Sign in failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    email: (data.user && data.user.email) || email,
    accessToken: data.access_token || null,
    refreshToken: data.refresh_token || null,
    local: false,
    signedInAt: Date.now(),
  };
}

// mode: 'login' | 'signup'
async function signIn(mode, email, password) {
  email = String(email || '').trim();
  password = String(password || '');
  if (!email || !password) throw new Error('Enter your email and password.');
  // Hard rule: no sign in / sign up while offline.
  if (!net.isOnline()) {
    throw new Error('You are offline. Sign in needs a connection — your existing session still works offline.');
  }
  const cfg = readConfig();
  let session;
  if (cfg) {
    session = await supabaseSignIn(cfg, mode, email, password);
  } else {
    // No backend configured: create a local-only account so the flow works.
    session = { email, local: true, signedInAt: Date.now() };
  }
  saveSession(session);
  log(`auth: signed in (${session.local ? 'local' : 'supabase'}) ${email}`);
  return status();
}

function signOut() {
  saveSession(null);
  log('auth: signed out');
  return status();
}

module.exports = { status, signIn, signOut };
