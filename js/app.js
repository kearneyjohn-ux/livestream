import { parseSource, isBlockedHttp, encodeState, decodeState, watchLink, emptyPane, normalizePane, LAYOUTS, ROTATIONS, KIND_NAMES } from './sources.js';
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
    if (saved?.panes?.length === 2) {
      const layout = LAYOUTS.includes(saved.layout) ? saved.layout : 'auto';
      return { title: saved.title || '', layout, view: false, panes: saved.panes.map(normalizePane) };
    }
  } catch {}
  return { title: '', layout: 'auto', view: false, panes: [emptyPane(), emptyPane()] };
}

function saveState() {
  const hash = encodeState(state);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  // Someone watching a link shouldn't lose their own camera setup to it.
  if (state.view) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
}

// A watch link (view=1) shows just the cameras and the title.
function applyMode() {
  document.body.classList.toggle('viewing', state.view);
  $('brandName').textContent = state.title || 'GoPro Split Screen';
  document.title = state.title || 'GoPro Split Screen';
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
  el.querySelector('.pane-rotate').addEventListener('click', () => {
    const p = paneState(pane);
    p.rotate = ROTATIONS[(ROTATIONS.indexOf(p.rotate) + 1) % ROTATIONS.length];
    showExtras(pane);
    saveState();
  });
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

// The car number and crew caption, and which way up the picture goes.
function showExtras(pane) {
  const { car, driver, nav, rotate } = paneState(pane);
  const card = pane.el.querySelector('.car-card');
  card.hidden = !(car || driver || nav);
  const num = card.querySelector('.car-num');
  num.textContent = car;
  num.hidden = !car;
  for (const [role, name] of [['driver', driver], ['nav', nav]]) {
    const row = card.querySelector(`[data-role="${role}"]`);
    row.querySelector('b').textContent = name;
    row.hidden = !name;
  }
  card.querySelector('.crew').hidden = !(driver || nav);
  pane.el.dataset.rotate = rotate;
  pane.el.style.setProperty('--rot', `${rotate}deg`);
}

function render(pane) {
  const { input, label } = paneState(pane);
  pane.el.querySelector('.pane-name').textContent = label || defaultName(pane.index);
  showExtras(pane);
  stopPlayer(pane);
  let source = null;
  let problem = null;
  try {
    source = parseSource(input);
  } catch (err) {
    problem = err.message;
  }
  if (!source && state.view) {
    hideSetup(pane);
    setStatus(pane, 'No camera on this side', '');
    return;
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
  const { input, label, car, driver, nav, rotate } = paneState(pane);
  const form = pane.form;
  form.elements.input.value = input;
  form.elements.label.value = label;
  form.elements.car.value = car;
  form.elements.driver.value = driver;
  form.elements.nav.value = nav;
  form.elements.rotate.value = String(rotate);
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
  const f = form.elements;
  const input = f.input.value.trim();
  const label = f.label.value.trim();
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
  state.panes[pane.index] = normalizePane({
    input,
    label,
    car: f.car.value.trim(),
    driver: f.driver.value.trim(),
    nav: f.nav.value.trim(),
    rotate: f.rotate.value,
  });
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
  $('layoutBtn').querySelector('.lbl').textContent = `Layout: ${LAYOUT_NAMES[state.layout]}`;
  $('layoutBtn').setAttribute('aria-label', `Layout: ${LAYOUT_NAMES[state.layout]}`);
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

// ---------- Sending a watch link ----------

function updateShare() {
  const ready = state.panes.some((p) => p.input);
  const url = ready ? watchLink(state, location.href) : '';
  $('shareUrl').value = url;
  $('shareOpen').href = url || '#';
  $('shareWarn').hidden = ready;
  for (const id of ['shareCopy', 'shareSend', 'shareOpen']) $(id).classList.toggle('disabled', !ready);
  return url;
}

$('shareBtn').addEventListener('click', () => {
  $('shareTitle').value = state.title;
  $('shareSend').hidden = !navigator.share;
  updateShare();
  $('shareDlg').showModal();
});

$('shareTitle').addEventListener('input', () => {
  state.title = $('shareTitle').value.trim();
  applyMode();
  saveState();
  updateShare();
});

$('shareCopy').addEventListener('click', async () => {
  const url = updateShare();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('Watch link copied. Paste it into a text or email.');
  } catch {
    $('shareUrl').select();
    toast('Select the link above and copy it.');
  }
});

$('shareSend').addEventListener('click', async () => {
  const url = updateShare();
  if (!url) return;
  try {
    await navigator.share({ title: state.title || 'Live cameras', text: `Watch ${state.title || 'the cameras'} live:`, url });
  } catch {}
});

$('shareOpen').addEventListener('click', (e) => {
  if (!updateShare()) e.preventDefault();
});

$('shareUrl').addEventListener('focus', () => $('shareUrl').select());

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
// Tapping outside a dialog closes it.
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
}

// Someone pasted a different shared link into the address bar.
addEventListener('hashchange', () => {
  const next = decodeState(location.hash);
  if (!next || encodeState(next) === encodeState(state)) return;
  Object.assign(state, next);
  applyMode();
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
applyMode();
applyLayout();
panes.forEach(render);
saveState();
wake();
