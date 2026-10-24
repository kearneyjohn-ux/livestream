// Browsing a Twitch channel's replays. Twitch's API needs a sign-in, so the owner connects
// their Twitch account once (Twitch's "implicit grant": no server needed, the sign-in comes
// back in the page's #fragment). The app is identified by a Client ID from an app registered
// at dev.twitch.tv; a Client ID isn't secret.
//
// No DOM here beyond what's passed in, so it runs in Node for the tests.

// Fill in once the Twitch app is registered; until then it can be pasted into the Replays screen.
export const TWITCH_CLIENT_ID = '';

const CLIENT_KEY = 'gopro-split-twitch-client';
const TOKEN_KEY = 'gopro-split-twitch-token';
const RETURN_KEY = 'gopro-split-twitch-return';
const STATE_KEY = 'gopro-split-twitch-state';

// Tests point these at a stand-in.
const apiBase = () => globalThis.TWITCH_API || 'https://api.twitch.tv/helix';
const authBase = () => globalThis.TWITCH_AUTH || 'https://id.twitch.tv/oauth2/authorize';

export class SignInNeeded extends Error {}

export function getClientId(storage) {
  return storage.getItem(CLIENT_KEY) || TWITCH_CLIENT_ID;
}

export function setClientId(storage, id) {
  storage.setItem(CLIENT_KEY, String(id).trim());
}

export function getToken(storage) {
  return storage.getItem(TOKEN_KEY) || '';
}

export function forgetToken(storage) {
  storage.setItem(TOKEN_KEY, '');
}

// Twitch sends the sign-in back to this page's folder, which must be registered exactly as the
// app's OAuth Redirect URL, e.g. https://kearneyjohn-ux.github.io/livestream/
export function redirectUri(href) {
  return new URL('./', href).href;
}

export function authorizeUrl(clientId, redirect, state) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'token', scope: '', state });
  return `${authBase()}?${q}`;
}

// Leaves for Twitch's sign-in page, remembering the current screen setup to come back to.
export function startSignIn(storage, session, loc) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  session.setItem(STATE_KEY, state);
  session.setItem(RETURN_KEY, loc.hash);
  return authorizeUrl(getClientId(storage), redirectUri(loc.href), state);
}

// Run before anything reads the address bar: if Twitch just sent the sign-in back, keep the
// token and put the screen setup back in the address bar. Returns a message to show, or ''.
export function finishSignIn(storage, session, loc, history) {
  const q = new URLSearchParams(loc.hash.replace(/^#/, ''));
  if (!q.has('access_token') && !q.has('error')) return '';
  const expected = session.getItem(STATE_KEY);
  const back = session.getItem(RETURN_KEY) || '';
  session.setItem(STATE_KEY, '');
  history.replaceState(null, '', back || loc.pathname + loc.search);
  if (q.has('error')) return `Twitch didn't connect: ${q.get('error_description') || q.get('error')}`;
  if (!expected || q.get('state') !== expected) return "Twitch didn't connect: the sign-in didn't match. Try again.";
  storage.setItem(TOKEN_KEY, q.get('access_token'));
  return 'Twitch connected';
}

async function helix(storage, path) {
  const token = getToken(storage);
  if (!token) throw new SignInNeeded();
  const res = await fetch(`${apiBase()}/${path}`, { headers: { 'Client-Id': getClientId(storage), Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    forgetToken(storage);
    throw new SignInNeeded();
  }
  if (!res.ok) throw new Error(`Twitch answered ${res.status}`);
  return (await res.json()).data || [];
}

// The channel's most recent videos (past broadcasts first, as Twitch lists them).
export async function fetchReplays(storage, login) {
  const [user] = await helix(storage, `users?login=${encodeURIComponent(login)}`);
  if (!user) return [];
  const videos = await helix(storage, `videos?user_id=${user.id}&first=20`);
  return videos.map((v) => ({
    id: v.id,
    title: v.title || 'Untitled',
    created: v.created_at,
    duration: formatDuration(v.duration),
    thumb: thumbUrl(v.thumbnail_url, 320, 180),
    type: v.type,
  }));
}

// Twitch durations look like "1h2m33s".
export function formatDuration(text) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(text || ''));
  if (!m || !text) return '';
  const [h, min, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  if (h) return `${h}h ${String(min).padStart(2, '0')}m`;
  if (min) return `${min}m`;
  return `${s}s`;
}

// Thumbnails come as a template; a video still being processed has a placeholder or none.
export function thumbUrl(template, w, h) {
  if (!template || template.includes('404_processing')) return '';
  return template.replace('%{width}', w).replace('%{height}', h);
}
