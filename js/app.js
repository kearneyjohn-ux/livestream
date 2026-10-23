import { parseSource, isBlockedHttp, encodeState, decodeState, watchLink, watchHash, emptyPane, normalizePane, LAYOUTS, CORNERS, ROTATIONS, KIND_NAMES } from './sources.js';
import { createPlayer } from './players.js';
import { loadCars, saveCars, findCar, upsertCar, removeCar, carLabel, crewText } from './roster.js';
import { createChannel, channelParam, parseChannelParam, sealMessage, openMessage, publish, fetchCached, subscribe } from './live.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'gopro-split';
const LAYOUT_NAMES = { auto: 'Auto', row: 'Side by side', col: 'Stacked', pip: 'Picture in picture' };

// localStorage can be missing or throw (private browsing, blocked storage).
const storage = (() => {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null, setItem() {} };
  }
})();

const state = loadState();
const panes = [];
let cars = loadCars(storage);

// A live watch link names the channel its owner sends changes on.
const liveParam = new URLSearchParams(location.hash.slice(1)).get('live');
const viewerChannel = state.view ? parseChannelParam(liveParam) : null;

// ---------- State: URL hash first (a shared link), then this browser's last setup ----------

function loadState() {
  const fromHash = decodeState(location.hash);
  if (fromHash) return fromHash;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.panes?.length === 2) {
      const layout = LAYOUTS.includes(saved.layout) ? saved.layout : 'auto';
      const corner = CORNERS.includes(saved.corner) ? saved.corner : 'br';
      return { title: saved.title || '', layout, corner, view: false, panes: saved.panes.map(normalizePane) };
    }
  } catch {}
  return { title: '', layout: 'auto', corner: 'br', view: false, panes: [emptyPane(), emptyPane()] };
}

function saveState() {
  // A live watch link keeps its live channel in the address bar.
  const hash = state.view ? watchHash(state) + (viewerChannel ? `&live=${liveParam}` : '') : encodeState(state);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  // Someone watching a link shouldn't lose their own camera setup to it.
  if (state.view) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
  queueLiveSend();
}

// A watch link shows just the cameras and the title, locked as they were set up.
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
  el.querySelector('.pane-off').addEventListener('click', () => setOff(pane, true));
  el.querySelector('.pane-corner').addEventListener('click', () => {
    state.corner = CORNERS[(CORNERS.indexOf(state.corner) + 1) % CORNERS.length];
    applyLayout();
    saveState();
  });
  el.querySelector('.pane-rotate').addEventListener('click', () => {
    const p = paneState(pane);
    p.rotate = ROTATIONS[(ROTATIONS.indexOf(p.rotate) + 1) % ROTATIONS.length];
    showExtras(pane);
    saveState();
  });
  el.querySelector('.cars-link').addEventListener('click', () => openCars());
  el.querySelector('.help-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('help').showModal();
  });
  pane.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSetup(pane);
  });
  el.style.order = index;
  $('restore').before(el);
  return pane;
}

function defaultName(i) {
  return `Camera ${i + 1}`;
}

function paneState(pane) {
  return state.panes[pane.index];
}

// The car number, class and crew caption, and which way up the picture goes.
function showExtras(pane) {
  const { car, driver, nav, cls, rotate } = paneState(pane);
  const card = pane.el.querySelector('.car-card');
  card.hidden = !(car || driver || nav || cls);
  const num = card.querySelector('.car-num');
  num.querySelector('.num').textContent = car;
  num.querySelector('.car-class').textContent = cls;
  num.hidden = !(car || cls);
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
  // A camera that's turned off doesn't play at all, so it uses no data.
  if (paneState(pane).off) {
    hideSetup(pane);
    return;
  }
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
  const { input, label, car, rotate } = paneState(pane);
  const form = pane.form;
  form.elements.input.value = input;
  form.elements.label.value = label;
  fillCarSelect(pane, findCar(cars, car)?.car ?? (car ? KEEP_CAR : ''));
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
  const old = paneState(pane);
  const chosen = f.car.value === KEEP_CAR ? old : findCar(cars, f.car.value);
  state.panes[pane.index] = normalizePane({
    ...old,
    input,
    label,
    car: chosen?.car || '',
    driver: chosen?.driver || '',
    nav: chosen?.nav || '',
    cls: chosen?.cls || '',
    rotate: Number(f.rotate.value),
    off: false,
  });
  saveState();
  render(pane);
  toast(`${label || defaultName(pane.index)}: ${KIND_NAMES[source.kind]} stream`);
}

// ---------- Cars: a list kept on this device, picked for each camera ----------

// A camera can show a car that isn't in this device's list (from a link, or since removed).
const KEEP_CAR = '__keep';

function fillCarSelect(pane, selected) {
  const select = pane.form.elements.car;
  const p = paneState(pane);
  const options = [new Option('No car', ''), ...cars.map((c) => new Option(carLabel(c), c.car))];
  if (p.car && !findCar(cars, p.car)) options.push(new Option(`${carLabel(p)} (not in the list)`, KEEP_CAR));
  select.replaceChildren(...options);
  select.value = selected;
}

let editingCar = '';

function openCars() {
  resetCarForm();
  renderCarList();
  $('carsDlg').showModal();
}

function renderCarList() {
  const list = $('carList');
  list.replaceChildren();
  for (const c of cars) {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'car-chip';
    num.textContent = c.car;
    const info = document.createElement('span');
    info.className = 'car-info';
    const crew = document.createElement('b');
    crew.textContent = crewText(c) || 'No crew names';
    const cls = document.createElement('small');
    cls.textContent = c.cls;
    info.append(crew, cls);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-sm';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => editCar(c));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-sm btn-ghost';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      if (!confirm(`Remove car ${carLabel(c)}?`)) return;
      cars = removeCar(cars, c.car);
      carsChanged(c.car, null);
    });
    li.append(num, info, edit, remove);
    list.append(li);
  }
  if (!cars.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No cars yet. Add one below.';
    list.append(li);
  }
  // Offer the classes already in use while typing one.
  const classes = [...new Set(cars.map((c) => c.cls).filter(Boolean))];
  $('classList').replaceChildren(...classes.map((cls) => new Option(cls)));
}

function editCar(c) {
  editingCar = c.car;
  const f = $('carForm').elements;
  for (const key of ['car', 'cls', 'driver', 'nav']) f[key].value = c[key];
  $('carFormTitle').textContent = `Edit car ${c.car}`;
  $('carSave').textContent = 'Save changes';
  $('carCancel').hidden = false;
  $('carError').hidden = true;
  f.car.focus();
}

function resetCarForm() {
  editingCar = '';
  $('carForm').reset();
  $('carFormTitle').textContent = 'Add a car';
  $('carSave').textContent = 'Add car';
  $('carCancel').hidden = true;
  $('carError').hidden = true;
}

$('carCancel').addEventListener('click', resetCarForm);

$('carForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('carForm').elements;
  const input = { car: f.car.value, cls: f.cls.value, driver: f.driver.value, nav: f.nav.value };
  const result = upsertCar(cars, input, editingCar);
  if (result.error) {
    $('carError').textContent = result.error;
    $('carError').hidden = false;
    return;
  }
  cars = result.cars;
  const saved = findCar(cars, input.car.trim());
  const verb = editingCar ? 'Saved' : 'Added';
  carsChanged(editingCar, saved);
  toast(`${verb} car ${saved.car}`);
});

// After a car is edited (or removed, `car` null): save the list, update any camera showing it,
// and refresh open car pickers.
function carsChanged(oldNumber, car) {
  saveCars(storage, cars);
  for (const pane of panes) {
    const select = pane.form.elements.car;
    const wasPicked = oldNumber && select.value.toLowerCase() === oldNumber.toLowerCase();
    const p = paneState(pane);
    if (oldNumber && p.car.toLowerCase() === oldNumber.toLowerCase()) {
      Object.assign(p, { car: car?.car || '', driver: car?.driver || '', nav: car?.nav || '', cls: car?.cls || '' });
      showExtras(pane);
    }
    if (!pane.form.hidden) fillCarSelect(pane, wasPicked ? car?.car || '' : select.value);
  }
  saveState();
  resetCarForm();
  renderCarList();
}

// ---------- Turning a camera off (e.g. its feed dropped) and back on ----------

function setOff(pane, off) {
  paneState(pane).off = off;
  render(pane);
  applyLayout();
  saveState();
}

function updateRestore() {
  const box = $('restore');
  box.replaceChildren();
  const off = panes.filter((p) => paneState(p).off);
  for (const pane of off) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-go';
    btn.textContent = `Turn on ${paneState(pane).label || defaultName(pane.index)}`;
    btn.addEventListener('click', () => setOff(pane, false));
    box.append(btn);
  }
  box.hidden = !off.length;
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
  const split = $('split');
  split.dataset.layout = state.layout;
  split.dataset.corner = state.corner;
  // With one camera off the other fills the screen; in picture in picture the second
  // camera showing is the small window.
  const showing = panes.filter((p) => !paneState(p).off);
  split.dataset.showing = showing.length;
  for (const p of panes) {
    p.el.hidden = paneState(p).off;
    p.el.classList.toggle('inset', state.layout === 'pip' && showing.length === 2 && p === showing[1]);
  }
  updateRestore();
  $('layoutBtn').querySelector('.lbl').textContent = `Layout: ${LAYOUT_NAMES[state.layout]}`;
  $('layoutBtn').setAttribute('aria-label', `Layout: ${LAYOUT_NAMES[state.layout]}`);
}

$('layoutBtn').addEventListener('click', () => {
  state.layout = LAYOUTS[(LAYOUTS.indexOf(state.layout) + 1) % LAYOUTS.length];
  applyLayout();
  saveState();
});

// Swap the on-screen order rather than moving the elements: moving a YouTube or Twitch
// player reloads it, and neither feed should drop.
function swapPanes() {
  state.panes.reverse();
  panes.reverse();
  panes.forEach((p, i) => {
    p.index = i;
    p.el.style.order = i;
    if (!p.form.hidden) showSetup(p);
    else if (!paneState(p).label) p.el.querySelector('.pane-name').textContent = defaultName(i);
  });
}

$('swapBtn').addEventListener('click', () => {
  swapPanes();
  applyLayout();
  saveState();
});

// ---------- Live links: the owner sends each change, viewers apply it ----------

const LIVE_KEY = 'gopro-split-live';
const LIVE_ON_KEY = 'gopro-split-live-on';
// ntfy.sh keeps messages for 12 hours, so the owner's screen resends now and then to keep
// the latest setup there for anyone opening the link later.
const RESEND_MS = 4 * 60 * 60 * 1000;

let liveChannel = null;
try {
  liveChannel = JSON.parse(storage.getItem(LIVE_KEY));
} catch {}
let liveOn = storage.getItem(LIVE_ON_KEY) !== '0';
let liveSeq = 0;
let liveTimer = null;
let liveStatus = '';

async function ensureChannel() {
  if (liveChannel) return liveChannel;
  liveChannel = await createChannel();
  try {
    storage.setItem(LIVE_KEY, JSON.stringify(liveChannel));
  } catch {}
  return liveChannel;
}

function setLiveStatus(text) {
  liveStatus = text;
  $('liveStatus').textContent = liveOn ? text : 'Off: the link shows the cameras as they are now, and later changes won\'t reach it.';
}

function queueLiveSend(delay = 800) {
  if (state.view || !liveOn || !liveChannel) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(sendLive, delay);
}

async function sendLive() {
  const ch = liveChannel;
  if (!ch || !liveOn || state.view) return;
  // Newer than anything sent before, even if this device's clock goes backwards.
  liveSeq = Math.max(Date.now(), liveSeq + 1);
  try {
    await publish(ch, await sealMessage(ch, liveSeq, encodeState({ ...state, view: false })));
    setLiveStatus(`On: everyone watching gets your changes within a few seconds. Last sent ${new Date().toLocaleTimeString()}.`);
  } catch {
    setLiveStatus("Couldn't reach the live service. Trying again; viewers keep the last update until then.");
    queueLiveSend(15000);
  }
}

// Viewer: apply the owner's latest setup without restarting feeds that haven't changed.
let viewerSeq = 0;

function applyRemote(next) {
  const old = state.panes;
  if (old[0].input !== old[1].input && next.panes[0].input === old[1].input && next.panes[1].input === old[0].input) {
    swapPanes();
  }
  Object.assign(state, { title: next.title, layout: next.layout, corner: next.corner });
  panes.forEach((pane, i) => {
    const before = state.panes[i];
    const after = next.panes[i];
    state.panes[i] = after;
    if (before.input !== after.input || before.off !== after.off) {
      render(pane);
    } else {
      pane.el.querySelector('.pane-name').textContent = after.label || defaultName(i);
      showExtras(pane);
    }
  });
  applyMode();
  applyLayout();
  saveState();
}

async function receive(payloads) {
  let newest = null;
  for (const payload of payloads) {
    const msg = await openMessage(viewerChannel, payload);
    if (msg && msg.seq > viewerSeq && (!newest || msg.seq > newest.seq)) newest = msg;
  }
  // Checked again: another update may have been applied while these were being opened.
  if (!newest || newest.seq <= viewerSeq) return;
  const next = decodeState(`#${newest.setup}`);
  if (!next) return;
  const first = viewerSeq === 0;
  viewerSeq = newest.seq;
  applyRemote({ ...next, view: true });
  if (!first) toast('Updated');
}

function setBadge(level) {
  $('liveBadge').hidden = false;
  $('liveBadge').dataset.level = level;
  $('liveBadgeText').textContent = level === 'ok' ? 'Live' : 'Reconnecting…';
}

async function catchUp() {
  try {
    await receive(await fetchCached(viewerChannel));
  } catch {}
}

function startViewer() {
  setBadge('wait');
  catchUp();
  subscribe(viewerChannel, {
    onPayload: (payload) => receive([payload]),
    onStatus: setBadge,
    onReconnect: catchUp,
  });
}

// ---------- Sending a watch link ----------

function updateShare() {
  const ready = state.panes.some((p) => p.input);
  const live = liveOn && liveChannel ? `&live=${channelParam(liveChannel)}` : '';
  const url = ready ? watchLink(state, location.href) + live : '';
  $('shareUrl').value = url;
  $('shareOpen').href = url || '#';
  $('shareWarn').hidden = ready;
  for (const id of ['shareCopy', 'shareSend', 'shareOpen']) $(id).classList.toggle('disabled', !ready);
  return url;
}

$('shareBtn').addEventListener('click', async () => {
  $('shareTitle').value = state.title;
  $('shareSend').hidden = !navigator.share;
  $('shareLive').checked = liveOn;
  $('shareNewLive').hidden = !liveOn;
  setLiveStatus(liveStatus || 'Setting up…');
  updateShare();
  $('shareDlg').showModal();
  if (liveOn) {
    await ensureChannel();
    updateShare();
    sendLive();
  }
});

$('shareLive').addEventListener('change', async () => {
  liveOn = $('shareLive').checked;
  try {
    storage.setItem(LIVE_ON_KEY, liveOn ? '1' : '0');
  } catch {}
  $('shareNewLive').hidden = !liveOn;
  setLiveStatus(liveOn ? 'Setting up…' : '');
  if (liveOn) {
    await ensureChannel();
    sendLive();
  }
  updateShare();
});

$('shareNewLive').addEventListener('click', async () => {
  if (!confirm('Make a new live link? Anyone with the current link keeps what they see now but stops getting your changes.')) return;
  liveChannel = null;
  await ensureChannel();
  liveSeq = 0;
  updateShare();
  sendLive();
  toast('New live link ready. Send it to everyone watching.');
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
if (viewerChannel) startViewer();
if (!state.view) setInterval(() => queueLiveSend(0), RESEND_MS);
