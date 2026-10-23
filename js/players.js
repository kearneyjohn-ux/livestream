// Players for each kind of stream. Each one fills a stage element, reports its state through
// onStatus(text, level) where level is 'ok' | 'wait' | 'bad', and keeps retrying until stop().
// Feeds over Starlink drop out now and then (obstructions, satellite handovers), so every
// player treats a lost or frozen stream as "reconnect in a moment", not as an error.

import { embedUrl } from './sources.js';

const RETRY_MS = 3000;
const FROZEN_MS = 12000;

export function createPlayer(source, stage, onStatus) {
  if (source.kind === 'youtube' || source.kind === 'twitch') return iframePlayer(source, stage, onStatus);
  if (source.kind === 'hls') return hlsPlayer(source, stage, onStatus);
  return webrtcPlayer(source, stage, onStatus);
}

function iframePlayer(source, stage, onStatus) {
  const frame = document.createElement('iframe');
  frame.src = embedUrl(source, location.hostname || 'localhost');
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  frame.title = 'Live stream';
  stage.append(frame);
  // The embedded player shows its own state and controls (including sound).
  onStatus(source.kind === 'youtube' ? 'YouTube' : 'Twitch', 'ok');
  return { hasOwnControls: true, stop: () => frame.remove() };
}

function makeVideo(stage) {
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  stage.append(video);
  return video;
}

// Calls `restart` when the picture stops moving for a while after it has started (a stalled
// connection often doesn't raise any error), and reports buffering/playing as it goes.
function watchVideo(video, onStatus, restart) {
  let playing = false;
  let lastTime = -1;
  let lastMove = Date.now();
  const onPlaying = () => {
    playing = true;
    onStatus('Live', 'ok');
  };
  const onWaiting = () => onStatus('Buffering…', 'wait');
  video.addEventListener('playing', onPlaying);
  video.addEventListener('waiting', onWaiting);
  const timer = setInterval(() => {
    if (!playing || video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      lastMove = Date.now();
    } else if (Date.now() - lastMove > FROZEN_MS) {
      restart('Picture froze, reconnecting…');
    }
  }, 1000);
  return {
    // After a restart, wait for the new stream to play before watching it again.
    reset: () => (playing = false),
    stop() {
      clearInterval(timer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
    },
  };
}

function hlsPlayer(source, stage, onStatus) {
  const video = makeVideo(stage);
  let hls = null;
  let retry = null;
  let stopped = false;

  const start = () => {
    retry = null;
    if (stopped) return;
    onStatus('Connecting…', 'wait');
    const Hls = globalThis.Hls;
    if (Hls?.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, liveDurationInfinity: true, manifestLoadingMaxRetry: 2 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else restart(data.response?.code === 404 ? 'Waiting for the camera to go live…' : 'Lost the stream, reconnecting…');
      });
      hls.loadSource(source.url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari on iPhone plays HLS itself.
      video.src = source.url;
    } else {
      onStatus("This browser can't play HLS", 'bad');
      return;
    }
    video.play().catch(() => {});
  };

  const teardown = () => {
    if (hls) hls.destroy();
    hls = null;
    video.removeAttribute('src');
    video.load();
  };

  const restart = (why) => {
    if (stopped || retry) return;
    watcher.reset();
    teardown();
    onStatus(why, 'wait');
    retry = setTimeout(start, RETRY_MS);
  };

  // hls.js reports its own errors; this catches Safari's built-in player.
  video.addEventListener('error', () => !hls && video.src && restart('Lost the stream, reconnecting…'));
  const watcher = watchVideo(video, onStatus, restart);
  start();

  return {
    video,
    stop() {
      stopped = true;
      clearTimeout(retry);
      watcher.stop();
      teardown();
      video.remove();
    },
  };
}

// WebRTC playback over WHEP: one HTTP POST with our offer, the server answers. This is what
// MediaMTX and Cloudflare Stream speak, and gives the least delay (about a second).
function webrtcPlayer(source, stage, onStatus) {
  const video = makeVideo(stage);
  let pc = null;
  let session = null;
  let retry = null;
  let stopped = false;
  let attempt = null;

  const start = async () => {
    retry = null;
    if (stopped) return;
    onStatus('Connecting…', 'wait');
    const ctl = new AbortController();
    attempt = ctl;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const conn = pc;
      conn.addTransceiver('video', { direction: 'recvonly' });
      conn.addTransceiver('audio', { direction: 'recvonly' });
      const stream = new MediaStream();
      conn.ontrack = (e) => {
        stream.addTrack(e.track);
        video.srcObject = stream;
        video.play().catch(() => {});
      };
      conn.onconnectionstatechange = () => {
        if (conn !== pc) return;
        if (conn.connectionState === 'failed' || conn.connectionState === 'closed') restart('Lost the stream, reconnecting…');
        else if (conn.connectionState === 'disconnected') {
          // Often comes back by itself after a short dropout; if not, start again.
          onStatus('Signal lost, waiting…', 'wait');
          setTimeout(() => conn === pc && conn.connectionState !== 'connected' && restart('Lost the stream, reconnecting…'), 8000);
        }
      };
      await conn.setLocalDescription(await conn.createOffer());
      await iceGathered(conn, 2500);
      const res = await fetch(source.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: conn.localDescription.sdp,
        signal: ctl.signal,
      });
      if (res.status === 404) return restart('Waiting for the camera to go live…');
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const loc = res.headers.get('Location');
      session = loc ? new URL(loc, source.url).href : null;
      await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    } catch (err) {
      if (stopped || ctl.signal.aborted) return;
      restart(err instanceof TypeError ? "Can't reach the stream server, retrying…" : `Couldn't connect (${err.message}), retrying…`);
    }
  };

  const teardown = () => {
    attempt?.abort();
    if (pc) pc.close();
    pc = null;
    // Tell the server we've gone so it frees the session straight away.
    if (session) fetch(session, { method: 'DELETE' }).catch(() => {});
    session = null;
    video.srcObject = null;
  };

  const restart = (why) => {
    if (stopped || retry) return;
    watcher.reset();
    teardown();
    onStatus(why, 'wait');
    retry = setTimeout(start, RETRY_MS);
  };

  const watcher = watchVideo(video, onStatus, restart);
  start();

  return {
    video,
    stop() {
      stopped = true;
      clearTimeout(retry);
      watcher.stop();
      teardown();
      video.remove();
    },
  };
}

function iceGathered(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, timeoutMs);
  });
}
