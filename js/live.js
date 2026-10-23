// Live watch links: the owner's screen sends every change through a public message relay
// (ntfy.sh, no account needed) and everyone watching the link applies it within seconds.
//
// The relay only ever sees opaque text:
// - Each setup is encrypted (AES-GCM) with a key that's only in the watch link's #fragment,
//   which browsers never send to any server.
// - Each message is signed (ECDSA P-256) with a private key that never leaves the owner's
//   device. Viewers check it against the public key in the link, so nobody else, viewers
//   included, can push changes to the screens.
// - Each message carries a sequence number; screens ignore anything not newer than what
//   they're showing, so an old message replayed later can't roll them back.
//
// No DOM here: the message format and crypto run in Node for the tests.

export const DEFAULT_RELAY = 'https://ntfy.sh';

// Tests (and anyone self-hosting ntfy) can point the app at another relay.
export function relayUrl() {
  return globalThis.LIVESTREAM_RELAY || DEFAULT_RELAY;
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// A new channel for the owner: a random topic, a shared encryption key, and a signing key pair.
// The whole object (private key included) is kept on the owner's device only.
export async function createChannel() {
  const topic = `gps-${toB64(crypto.getRandomValues(new Uint8Array(18)))}`;
  const key = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const pub = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { topic, key, pub, priv };
}

// What goes in the watch link: everything a viewer needs, and nothing that lets them send.
export function channelParam(ch) {
  return `${ch.topic}.${ch.key}.${ch.pub}`;
}

export function parseChannelParam(param) {
  const [topic, key, pub] = String(param || '').split('.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic || '') || !key || !pub) return null;
  return { topic, key, pub };
}

async function aesKey(ch) {
  return crypto.subtle.importKey('raw', fromB64(ch.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Owner: turn a setup (the text from encodeState) into a signed, encrypted message.
export async function sealMessage(ch, seq, setup) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ seq, setup }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(ch), plain));
  const priv = await crypto.subtle.importKey('jwk', ch.priv, ECDSA, false, ['sign']);
  const sig = await crypto.subtle.sign(SIGN, priv, concat(iv, ct));
  return `${toB64(iv)}.${toB64(ct)}.${toB64(sig)}`;
}

// Viewer: check and open a message. Returns { seq, setup }, or null for anything that isn't
// a genuine message from the owner of this channel.
export async function openMessage(ch, payload) {
  try {
    const [iv, ct, sig] = String(payload).split('.').map(fromB64);
    if (!iv || !ct || !sig) return null;
    const pub = await crypto.subtle.importKey('raw', fromB64(ch.pub), ECDSA, false, ['verify']);
    if (!(await crypto.subtle.verify(SIGN, pub, sig, concat(iv, ct)))) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(ch), ct);
    const msg = JSON.parse(new TextDecoder().decode(plain));
    if (typeof msg?.seq !== 'number' || typeof msg?.setup !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// ---------- Talking to the relay (ntfy's HTTP API) ----------

export async function publish(ch, payload) {
  const res = await fetch(`${relayUrl()}/${ch.topic}`, { method: 'POST', body: payload });
  if (!res.ok) throw new Error(`the live service answered ${res.status}`);
}

// Every message the relay still holds for this channel (ntfy keeps them for 12 hours).
export async function fetchCached(ch) {
  const res = await fetch(`${relayUrl()}/${ch.topic}/json?poll=1&since=all`);
  if (!res.ok) throw new Error(`the live service answered ${res.status}`);
  return parseLines(await res.text());
}

export function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m.event === 'message' && typeof m.message === 'string') out.push(m.message);
    } catch {}
  }
  return out;
}

// Calls onPayload for each new message and onStatus('ok' | 'wait') as the connection comes
// and goes. EventSource reconnects by itself; after each reconnect `onReconnect` lets the
// caller catch up on anything missed. Returns a function that stops listening.
export function subscribe(ch, { onPayload, onStatus, onReconnect }) {
  const es = new EventSource(`${relayUrl()}/${ch.topic}/sse`);
  let wasDown = false;
  es.addEventListener('open', () => {
    onStatus('ok');
    if (wasDown) onReconnect();
    wasDown = false;
  });
  es.addEventListener('error', () => {
    wasDown = true;
    onStatus('wait');
  });
  // ntfy sends messages as unnamed events with the message in a JSON body.
  es.addEventListener('message', (e) => {
    for (const payload of parseLines(e.data)) onPayload(payload);
  });
  return () => es.close();
}
