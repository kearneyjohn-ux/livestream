// Start times. Entered in WA time (AWST, UTC+8 all year: WA has no daylight saving) and shown
// in Perth and Sydney time, with the right zone names (Sydney is AEDT in summer, AEST in
// winter). Stored as ISO text with the offset, e.g. "2026-10-25T06:46:00+08:00".
// No DOM, so it runs in Node for the tests.

// The zone names are worked out here rather than taken from the browser, which may say
// "GMT+11" instead of "AEDT": Perth is always AWST; Sydney is AEDT at UTC+11, else AEST.
const ZONES = [
  ['Australia/Perth', 'Perth', () => 'AWST'],
  ['Australia/Sydney', 'Sydney', (offset) => (offset === 11 ? 'AEDT' : 'AEST')],
];

export function parseStart(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isUpcoming(iso, now = new Date()) {
  const date = parseStart(iso);
  return Boolean(date && date > now);
}

const dayKey = (date, timeZone) => new Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// Hours ahead of UTC in a time zone at a moment, e.g. 11 for Sydney in summer.
function offsetHours(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(date);
  const n = (type) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((local - Math.floor(date.getTime() / 60000) * 60000) / 3600000);
}

// "6:46 am AWST (Perth)", with the day in front when it isn't today in that city.
function inZone(date, timeZone, city, zoneName, now) {
  const offset = offsetHours(date, timeZone);
  const local = new Date(date.getTime() + offset * 3600000);
  const h = local.getUTCHours();
  const time = `${h % 12 || 12}:${String(local.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  const day = dayKey(date, timeZone) === dayKey(now, timeZone)
    ? ''
    : `${new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(date).replace(',', '')} `;
  return `${day}${time} ${zoneName(offset)} (${city})`;
}

// The start time in each zone, e.g. ["6:46 am AWST (Perth)", "9:46 am AEDT (Sydney)"].
export function startLines(iso, now = new Date()) {
  const date = parseStart(iso);
  if (!date) return [];
  return ZONES.map(([zone, city, zoneName]) => inZone(date, zone, city, zoneName, now));
}

// For a datetime-local input, in WA time: "2026-10-25T06:46".
export function toWaInput(iso) {
  const date = parseStart(iso);
  if (!date) return '';
  const wa = new Date(date.getTime() + 8 * 3600 * 1000);
  return wa.toISOString().slice(0, 16);
}

// From a datetime-local input, read as WA time.
export function fromWaInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return '';
  return `${value}:00+08:00`;
}

// Time left until a start, e.g. "1:23:45", "23:45", "0:09"; '' once it has passed.
export function countdown(iso, now = new Date()) {
  const date = parseStart(iso);
  if (!date || date <= now) return '';
  const total = Math.ceil((date - now) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
