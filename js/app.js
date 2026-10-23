import { parseSource, isBlockedHttp, encodeState, decodeState, LAYOUTS, KIND_NAMES } from './sources.js';
import { createPlayer } from './players.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'gopro-split';
const LAYOUT_NAMES = { auto: 'Auto', row: 'Side by side', col: 'Stacked' };

const state = loadState();
const panes = [];

// ---------- State: URL hash first (a shared link), then this browser's last setup ----------

function loadState() {
  const fromHash = decodeState(location.hash);
  if (fromHash) return fromHash;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.panes?.length === 2) return { layout: LAYOUTS.includes(saved.layout) ? saved.layout : 'auto', panes: saved.panes };
  } catch {}
  return { layout: 'auto', panes: [{ input: '', label: '' }, { input: '', label: '' }] };
}

function saveState() {
  const hash = encodeState(state);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
}

// ---------- Panes ----------

function buildPane(index) {
  const el = $('paneTpl').content.firstElementChild.cloneNode(true);
  const pane = {
    index,
    el,
    stage: el.querySelector('.stage'),
    form: el.querySelector('.setup'),
    player: null,
  };
  el.querySelector('.pane-change').addEventListener('click', () => showSetup(pane));
  el.querySelector('.setup-cancel').addEventListener('click', () => hideSetup(pane));
  el.querySelector('.pane-mute').addEventListener('click', () => toggleSound(pane));
  el.querySelector('.help-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('help').showModal();
  });
  pane.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSetup(pane);
  });
  $('split').append(el);
  return pane;
}

function defaultName(i) {
  return `Camera ${i + 1}`;
}

function paneState(pane) {
  return state.panes[pane.index];
}

function render(pane) {
  const { input, label } = paneState(pane);
  pane.el.querySelector('.pane-name').textContent = label || defaultName(pane.index);
  stopPlayer(pane);
  let source = null;
  let problem = null;
  try {
    source = parseSource(input);
  } catch (err) {
    problem = err.message;
  }
  if (!source) {
    showSetup(pane);
    const error = pane.form.querySelector('.setup-error');
    error.textContent = problem;
    error.hidden = !problem;
    return;
  }
  hideSetup(pane);
  if (isBlockedHttp(source, location.protocol)) {
    setStatus(pane, 'This link is http://, which an https page can\'t play. Use the server\'s https address.', 'bad');
    return;
  }
  pane.player = createPlayer(source, pane.stage, (text, level) => setStatus(pane, text, level));
  const mute = pane.el.querySelector('.pane-mute');
  mute.hidden = !pane.player.video;
  updateMuteButton(pane);
  updateWakeLock();
}

function stopPlayer(pane) {
  pane.player?.stop();
  pane.player = null;
  pane.el.querySelector('.pane-mute').hidden = true;
  setStatus(pane, '', '');
}

function setStatus(pane, text, level) {
  pane.el.querySelector('.pane-status').textContent = text;
  pane.el.dataset.level = level;
}

function showSetup(pane) {
  const { input, label } = paneState(pane);
  const form = pane.form;
  form.elements.input.value = input;
  form.elements.label.value = label;
  form.querySelector('.setup-title').textContent = label || defaultName(pane.index);
  form.querySelector('.setup-error').hidden = true;
  // Cancel only makes sense when there's a stream to go back to.
  form.querySelector('.setup-cancel').hidden = !pane.player;
  form.hidden = false;
  pane.el.classList.add('editing');
}

function hideSetup(pane) {
  pane.form.hidden = true;
  pane.el.classList.remove('editing');
}

function submitSetup(pane) {
  const form = pane.form;
  const input = form.elements.input.value.trim();
  const label = form.elements.label.value.trim();
  const error = form.querySelector('.setup-error');
  let source;
  try {
    source = parseSource(input);
    if (!source) throw new Error('Paste the link to this camera\'s live stream.');
    if (isBlockedHttp(source, location.protocol)) {
      throw new Error('Browsers block http:// streams on an https page. Use the stream server\'s https address.');
    }
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    return;
  }
  state.panes[pane.index] = { input, label };
  saveState();
  render(pane);
  toast(`${label || defaultName(pane.index)}: ${KIND_NAMES[source.kind]} stream`);
}

// ---------- Sound: one camera at a time, so two engines don't drown each other out ----------

function toggleSound(pane) {
  const video = pane.player?.video;
  if (!video) return;
  const turnOn = video.muted;
  for (const p of panes) {
    if (p.player?.video) p.player.video.muted = true;
  }
  video.muted = !turnOn;
  if (turnOn) video.play().catch(() => {});
  panes.forEach(updateMuteButton);
}

function updateMuteButton(pane) {
  const video = pane.player?.video;
  const btn = pane.el.querySelector('.pane-mute');
  if (!video) return;
  btn.textContent = video.muted ? 'Sound off' : 'Sound on';
  btn.setAttribute('aria-pressed', String(!video.muted));
}

// ---------- Top bar ----------

function applyLayout() {
  $('split').dataset.layout = state.layout;
  $('layoutBtn').innerHTML = `<span class="long">Layout: </span>${LAYOUT_NAMES[state.layout]}`;
}

$('layoutBtn').addEventListener('click', () => {
  state.layout = LAYOUTS[(LAYOUTS.indexOf(state.layout) + 1) % LAYOUTS.length];
  applyLayout();
  saveState();
});

$('swapBtn').addEventListener('click', () => {
  // Swap the elements rather than restarting the players, so neither feed drops.
  state.panes.reverse();
  panes.reverse();
  panes.forEach((p, i) => {
    p.index = i;
    $('split').append(p.el);
    if (!p.form.hidden) showSetup(p);
    else if (!paneState(p).label) p.el.querySelector('.pane-name').textContent = defaultName(i);
  });
  saveState();
});

$('shareBtn').addEventListener('click', async () => {
  saveState();
  const url = location.href;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'GoPro Split Screen', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied. Anyone with it sees both cameras.');
  } catch (err) {
    if (err?.name !== 'AbortError') prompt('Copy this link:', url);
  }
});

const root = document.documentElement;
const canFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
$('fullBtn').hidden = !canFullscreen;
$('fullBtn').addEventListener('click', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    canFullscreen.call(root);
  }
});

$('helpBtn').addEventListener('click', () => $('help').showModal());
$('help').addEventListener('click', (e) => {
  if (e.target === $('help')) $('help').close();
});

// Someone pasted a different shared link into the address bar.
addEventListener('hashchange', () => {
  const next = decodeState(location.hash);
  if (!next || encodeState(next) === encodeState(state)) return;
  Object.assign(state, next);
  applyLayout();
  panes.forEach(render);
});

// ---------- Keep the screen on while watching ----------

let wakeLock = null;
async function updateWakeLock() {
  const watching = panes.some((p) => p.player);
  try {
    if (watching && !wakeLock && document.visibilityState === 'visible' && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {}
}
document.addEventListener('visibilitychange', updateWakeLock);

// ---------- Hide the camera bars while nothing is touched ----------

let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
}
for (const type of ['pointermove', 'pointerdown', 'keydown']) addEventListener(type, wake, { passive: true });

let toastTimer;
function toast(msg, ms = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// ---------- Start ----------

panes.push(buildPane(0), buildPane(1));
applyLayout();
panes.forEach(render);
saveState();
wake();
