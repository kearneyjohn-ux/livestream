// How many people are watching a car's Twitch stream (Twitch counts everyone, including
// people watching in this app). Uses DecAPI, a free public service built on Twitch's API, so
// no sign-in is needed on any screen: it answers with a plain number, or a sentence such as
// "westlimemotorsport467 is offline".

const apiBase = () => globalThis.VIEWER_API || 'https://decapi.me/twitch/viewercount/';

// The number watching, or null when the channel is offline or the count isn't available.
export function parseViewerCount(text) {
  const t = String(text ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

export async function fetchViewerCount(channel) {
  try {
    const res = await fetch(`${apiBase()}${encodeURIComponent(channel)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseViewerCount(await res.text());
  } catch {
    return null;
  }
}

// "1 watching", "1.2k watching"
export function viewerLabel(n) {
  const short = n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
  return `${short} watching`;
}
