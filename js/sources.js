// Works out what kind of stream a pasted link is, and how to play it. No DOM, so it runs in
// Node for the tests.

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

export const KIND_NAMES = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  hls: 'HLS',
  webrtc: 'WebRTC',
};

// Parse a pasted link into a source:
//   { kind: 'youtube', videoId } or { kind: 'youtube', channelId }
//   { kind: 'twitch', channel }
//   { kind: 'hls', url }
//   { kind: 'webrtc', url }   (a WHEP endpoint)
// Returns null for an empty link and throws an Error with a message for the user otherwise.
export function parseSource(input) {
  let text = String(input ?? '').trim();
  if (!text) return null;
  if (YT_ID.test(text) && !text.includes('.')) return { kind: 'youtube', videoId: text };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That doesn't look like a link. Paste the stream's full address.");
  }
  if (url.protocol === 'rtmp:' || url.protocol === 'rtmps:' || url.protocol === 'srt:' || url.protocol === 'rtsp:') {
    throw new Error(
      `${url.protocol.slice(0, -1).toUpperCase()} is where the camera sends its stream, not something a browser can play. ` +
        "Paste the server's playback link instead (YouTube watch link, .m3u8 or WebRTC).",
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Paste an http:// or https:// link.');

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return youtubeVideo(parts[0]);
  if (YT_HOSTS.includes(host)) {
    const v = url.searchParams.get('v');
    if (v) return youtubeVideo(v);
    if (['live', 'embed', 'shorts', 'v'].includes(parts[0]) && parts[1] && parts[1] !== 'live_stream') return youtubeVideo(parts[1]);
    const channel = parts[0] === 'channel' ? parts[1] : url.searchParams.get('channel');
    if (channel && YT_CHANNEL.test(channel)) return { kind: 'youtube', channelId: channel };
    throw new Error(
      "Use the live stream's own link (on YouTube: Share → Copy link), or a channel link like youtube.com/channel/UC…",
    );
  }

  if (host === 'twitch.tv' || host === 'www.twitch.tv' || host === 'm.twitch.tv') {
    const channel = parts[0];
    if (!channel || !/^[A-Za-z0-9_]{2,25}$/.test(channel)) throw new Error('Use a Twitch channel link like twitch.tv/yourchannel.');
    return { kind: 'twitch', channel: channel.toLowerCase() };
  }

  if (/\.m3u8$/i.test(url.pathname)) return { kind: 'hls', url: url.href };

  // Anything else is taken as a WebRTC (WHEP) stream, e.g. MediaMTX (https://server:8889/truck1)
  // or Cloudflare Stream (…/webRTC/play).
  if (!/\/whep$/i.test(url.pathname) && !/\/webrtc\/play$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/whep`;
  }
  return { kind: 'webrtc', url: url.href };
}

function youtubeVideo(id) {
  if (!id || !YT_ID.test(id)) throw new Error("That YouTube link doesn't contain a video ID.");
  return { kind: 'youtube', videoId: id };
}

// The URL to put in an <iframe> for sources played by someone else's player, else null.
// `pageHost` is this page's hostname, which Twitch needs to allow the embed.
export function embedUrl(source, pageHost) {
  if (source.kind === 'youtube') {
    const q = 'autoplay=1&mute=1&playsinline=1&rel=0';
    return source.videoId
      ? `https://www.youtube.com/embed/${source.videoId}?${q}`
      : `https://www.youtube.com/embed/live_stream?channel=${source.channelId}&${q}`;
  }
  if (source.kind === 'twitch') {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(source.channel)}&parent=${encodeURIComponent(pageHost)}&muted=true&autoplay=true`;
  }
  return null;
}

// Browsers refuse to load http:// streams into an https:// page, apart from this computer itself.
export function isBlockedHttp(source, pageProtocol) {
  if (pageProtocol !== 'https:' || !source.url) return false;
  const url = new URL(source.url);
  return url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

// The shortest link that plays the same stream, to keep watch links short enough to text.
export function shortInput(input) {
  let source;
  try {
    source = parseSource(input);
  } catch {
    return input;
  }
  if (source?.videoId) return source.videoId;
  if (source?.kind === 'twitch') return `twitch.tv/${source.channel}`;
  return input;
}

// Screen setup <-> URL hash, so a link can be bookmarked or sent to the crew. Per camera
// (a = left/top, b = right/bottom): link, n = camera name, c = car number, d = driver,
// v = navigator, r = rotation in degrees.
// #a=<link>&an=Bonnet&ac=12&ad=…&av=…&ar=180&b=…&t=<title>&layout=row&view=1
// `view=1` is a watch link: it only shows the cameras, with nothing to set up or change.
const KEYS = ['a', 'b'];
const FIELDS = { label: 'n', car: 'c', driver: 'd', nav: 'v' };
export const LAYOUTS = ['auto', 'row', 'col'];
export const ROTATIONS = [0, 90, 180, 270];

export function emptyPane() {
  return { input: '', label: '', car: '', driver: '', nav: '', rotate: 0 };
}

// Fills in anything missing from a saved or linked camera, and drops anything invalid.
export function normalizePane(p) {
  const pane = emptyPane();
  for (const key of ['input', ...Object.keys(FIELDS)]) pane[key] = typeof p?.[key] === 'string' ? p[key] : '';
  const r = Number(p?.rotate);
  pane.rotate = ROTATIONS.includes(r) ? r : 0;
  return pane;
}

export function encodeState(state) {
  const q = new URLSearchParams();
  state.panes.forEach((p, i) => {
    const k = KEYS[i];
    if (p.input) q.set(k, state.view ? shortInput(p.input) : p.input);
    for (const [field, suffix] of Object.entries(FIELDS)) if (p[field]) q.set(k + suffix, p[field]);
    if (p.rotate) q.set(`${k}r`, String(p.rotate));
  });
  if (state.title) q.set('t', state.title);
  if (state.layout && state.layout !== 'auto') q.set('layout', state.layout);
  if (state.view) q.set('view', '1');
  return q.toString();
}

export function decodeState(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!KEYS.some((k) => q.has(k) || q.has(`${k}n`))) return null;
  const layout = q.get('layout');
  return {
    title: q.get('t') || '',
    layout: LAYOUTS.includes(layout) ? layout : 'auto',
    view: q.get('view') === '1',
    panes: KEYS.map((k) => {
      const p = { input: q.get(k) || '', rotate: q.get(`${k}r`) };
      for (const [field, suffix] of Object.entries(FIELDS)) p[field] = q.get(k + suffix) || '';
      return normalizePane(p);
    }),
  };
}

// A link that opens just the cameras, for people who only watch.
export function watchLink(state, pageUrl) {
  const url = new URL(pageUrl);
  url.hash = encodeState({ ...state, view: true });
  return url.href;
}
