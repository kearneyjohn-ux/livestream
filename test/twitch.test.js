import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeUrl, redirectUri, startSignIn, finishSignIn, getToken, formatDuration, thumbUrl, setClientId } from '../js/twitch.js';

function memory() {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)) };
}

function fakeHistory() {
  return { url: null, replaceState(_s, _t, url) { this.url = url; } };
}

test('Twitch sends the sign-in back to the app folder', () => {
  assert.equal(redirectUri('https://kearneyjohn-ux.github.io/livestream/#a=x'), 'https://kearneyjohn-ux.github.io/livestream/');
  assert.equal(redirectUri('https://kearneyjohn-ux.github.io/livestream/index.html?x=1'), 'https://kearneyjohn-ux.github.io/livestream/');
  const url = new URL(authorizeUrl('abc123', 'https://kearneyjohn-ux.github.io/livestream/', 'st'));
  assert.equal(url.origin + url.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('client_id'), 'abc123');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://kearneyjohn-ux.github.io/livestream/');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('Signing in keeps the token and puts the screen setup back', () => {
  const storage = memory();
  const session = memory();
  setClientId(storage, ' abc123 ');
  const out = startSignIn(storage, session, { hash: '#a=twitch.tv%2Fwestlimemotorsport467&ac=467', href: 'https://x.github.io/livestream/#a=…' });
  const state = new URL(out).searchParams.get('state');
  assert.equal(new URL(out).searchParams.get('client_id'), 'abc123');

  const history = fakeHistory();
  const msg = finishSignIn(storage, session, { hash: `#access_token=tok123&scope=&state=${state}&token_type=bearer`, pathname: '/livestream/', search: '' }, history);
  assert.equal(msg, 'Twitch connected');
  assert.equal(getToken(storage), 'tok123');
  assert.equal(history.url, '#a=twitch.tv%2Fwestlimemotorsport467&ac=467');

  // The same answer can't be used twice, and a forged one is refused.
  const again = finishSignIn(storage, session, { hash: `#access_token=evil&state=${state}`, pathname: '/livestream/', search: '' }, fakeHistory());
  assert.match(again, /didn't match/);
  assert.equal(getToken(storage), 'tok123');
});

test('A refused sign-in says why, and ordinary pages are left alone', () => {
  const storage = memory();
  const session = memory();
  const msg = finishSignIn(storage, session, { hash: '#error=access_denied&error_description=The+user+denied+you+access', pathname: '/livestream/', search: '' }, fakeHistory());
  assert.match(msg, /denied/);
  assert.equal(getToken(storage), '');
  assert.equal(finishSignIn(storage, session, { hash: '#a=x', pathname: '/', search: '' }, fakeHistory()), '');
});

test('Replay details read nicely', () => {
  assert.equal(formatDuration('1h2m33s'), '1h 02m');
  assert.equal(formatDuration('45m10s'), '45m');
  assert.equal(formatDuration('38s'), '38s');
  assert.equal(formatDuration(''), '');
  assert.equal(thumbUrl('https://static-cdn.jtvnw.net/cf_vods/x/thumb/thumb0-%{width}x%{height}.jpg', 320, 180), 'https://static-cdn.jtvnw.net/cf_vods/x/thumb/thumb0-320x180.jpg');
  assert.equal(thumbUrl('https://vod-secure.twitch.tv/_404/404_processing_%{width}x%{height}.png', 320, 180), '');
  assert.equal(thumbUrl('', 320, 180), '');
});
