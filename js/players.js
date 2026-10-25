// Players for each kind of stream. Each one fills a stage element, reports its state through
// onStatus(text, level) where level is 'ok' | 'wait' | 'bad' | 'tap' (the browser wants a tap
// before it will play), and keeps retrying until stop(). Players whose sound the app can
// switch have isMuted()/setMuted(); resume() asks a player to start playing again.
// Feeds over Starlink drop out now and then (obstructions, satellite handovers), so every
// player treats a lost or frozen stream as "reconnect in a moment", not as an error.

import { embedUrl } from './sources.js?v=dev';

const RETRY_MS = 3000;
const FROZEN_MS = 12000;

// options.fullscreen: false switches off a player's own full-screen button, for a feed the
// app has turned round: a player's own full screen shows the picture the way the camera sends
// it, i.e. upside down for a camera mounted that way.
export function createPlayer(source, stage, onStatus, options = {}) {
  if (source.kind === 'twitch') return twitchPlayer(source, stage, onStatus, options);
  if (source.kind === 'youtube') return youtubePlayer(source, stage, onStatus);
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

// ---------- YouTube: driven through YouTube's player API so it starts by itself ----------
//
// Like Twitch: the plain embed often sits on a play button on iPhones and iPads. Through the
// API the app mutes and plays it when ready, starts a live feed again if it's left paused or
// ends, and says plainly when YouTube won't play a stream here.

let youtubeApi = null;

function loadYouTubeApi() {
  youtubeApi ||= new Promise((resolve, reject) => {
    if (globalThis.YT?.Player) return resolve(globalThis.YT);
    const previous = globalThis.onYouTubeIframeAPIReady;
    globalThis.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(globalThis.YT);
    };
    const script = document.createElement('script');
    script.src = globalThis.YOUTUBE_API_JS || 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('YouTube player script did not load'));
    setTimeout(() => reject(new Error('YouTube player script timed out')), 15000);
    document.head.append(script);
  }).catch((err) => {
    youtubeApi = null;
    throw err;
  });
  return youtubeApi;
}

// YouTube's error codes: 100 = gone or private; 101, 150 and 153 = the owner doesn't allow it
// to be played on other sites.
const YT_BLOCKED = [101, 150, 153];

function youtubePlayer(source, stage, onStatus) {
  const box = document.createElement('div');
  box.className = 'twitch-box';
  stage.append(box);
  let player = null;
  let fallback = null;
  let stopped = false;
  let muted = true;
  let playing = false;
  let stuck = 0;
  let timer = null;
  let retry = null;
  const setOffline = (off) => {
    if (off) stage.dataset.offline = '';
    else delete stage.dataset.offline;
  };
  const call = (fn, ...args) => {
    try {
      return player?.[fn]?.(...args);
    } catch {
      return undefined;
    }
  };

  const build = (YT) => {
    if (stopped) return;
    box.replaceChildren(document.createElement('div'));
    playing = false;
    stuck = 0;
    player = new YT.Player(box.firstChild, {
      width: '100%',
      height: '100%',
      // A channel link plays whatever that channel has live.
      videoId: source.videoId || 'live_stream',
      playerVars: {
        autoplay: 1,
        mute: 1,
        playsinline: 1,
        rel: 0,
        // YouTube's own title bar and buttons would sit under the app's bar on each feed;
        // the app has its own sound and full-screen buttons.
        controls: 0,
        iv_load_policy: 3,
        ...(source.videoId ? {} : { channel: source.channelId }),
      },
      events: {
        onReady: () => {
          if (muted) call('mute');
          call('playVideo');
        },
        onStateChange: (e) => {
          const S = YT.PlayerState || { ENDED: 0, PLAYING: 1, BUFFERING: 3 };
          if (e.data === S.PLAYING) {
            playing = true;
            stuck = 0;
            setOffline(false);
            onStatus('Live', 'ok');
          } else if (e.data === S.BUFFERING) {
            onStatus('Buffering…', 'wait');
          } else if (e.data === S.ENDED) {
            playing = false;
            setOffline(true);
            onStatus('Stream ended: waiting for it to come back…', 'wait');
            reload(30000);
          }
        },
        onError: (e) => {
          playing = false;
          setOffline(true);
          if (YT_BLOCKED.includes(e.data)) {
            onStatus("YouTube doesn't allow this stream to be played in other apps. Use another link.", 'bad');
          } else {
            onStatus('Not live yet, or the link is wrong: trying again…', 'wait');
            reload(30000);
          }
        },
      },
    });
  };

  // Start a fresh player later, e.g. a channel that ended its stream and may start a new one.
  const reload = (ms) => {
    clearTimeout(retry);
    retry = setTimeout(() => loadYouTubeApi().then(build).catch(() => {}), ms);
  };

  onStatus('Connecting…', 'wait');
  loadYouTubeApi()
    .then((YT) => {
      build(YT);
      // A feed that isn't playing is nudged; if the browser won't let it start, ask for a tap.
      timer = setInterval(() => {
        const state = call('getPlayerState');
        if (playing && state === 1) return;
        if (state === 2 || state === -1 || state === 5) {
          call('playVideo');
          if (++stuck >= 2 && !playing) onStatus('Tap to start', 'tap');
        }
      }, 6000);
    })
    .catch(() => {
      if (stopped) return;
      box.remove();
      fallback = iframePlayer(source, stage, onStatus);
    });

  return {
    isMuted: () => call('isMuted') ?? muted,
    setMuted(m) {
      muted = m;
      call(m ? 'mute' : 'unMute');
      if (!m) call('playVideo');
    },
    resume: () => call('playVideo'),
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(retry);
      setOffline(false);
      call('destroy');
      fallback?.stop();
      box.remove();
    },
  };
}

// ---------- Twitch: driven through Twitch's player API so it starts by itself ----------
//
// Twitch's embedded player won't autoplay on phones and tablets, and after a stream drops and
// comes back it sits on a play button. Through its API the app tells it to play (muted, which
// browsers allow without a tap) when it's ready, whenever the channel comes back online, and
// whenever a live feed has been left paused.

let twitchApi = null;

function loadTwitchApi() {
  twitchApi ||= new Promise((resolve, reject) => {
    if (globalThis.Twitch?.Player) return resolve(globalThis.Twitch);
    const script = document.createElement('script');
    script.src = globalThis.TWITCH_PLAYER_JS || 'https://player.twitch.tv/js/embed/v1.js';
    script.onload = () => (globalThis.Twitch?.Player ? resolve(globalThis.Twitch) : reject(new Error('no player')));
    script.onerror = () => reject(new Error('Twitch player script did not load'));
    setTimeout(() => reject(new Error('Twitch player script timed out')), 15000);
    document.head.append(script);
  }).catch((err) => {
    twitchApi = null; // try again next time
    throw err;
  });
  return twitchApi;
}

function twitchPlayer(source, stage, onStatus, options = {}) {
  const live = !source.video;
  const box = document.createElement('div');
  box.className = 'twitch-box';
  stage.append(box);
  let player = null;
  let fallback = null;
  let stopped = false;
  let muted = true;
  let online = true;
  let ready = false;
  let timer = null;
  // While the channel is offline the app shows its own card over Twitch's offline screen.
  // The player keeps running underneath so it notices when the camera comes back.
  const setOffline = (off) => {
    if (off) stage.dataset.offline = '';
    else delete stage.dataset.offline;
  };
  const play = () => {
    try {
      player?.play();
    } catch {}
  };

  onStatus('Connecting…', 'wait');
  loadTwitchApi()
    .then((Twitch) => {
      if (stopped) return;
      const P = Twitch.Player;
      player = new P(box, {
        width: '100%',
        height: '100%',
        parent: [location.hostname || 'localhost'],
        allowfullscreen: options.fullscreen !== false,
        autoplay: true,
        muted: true,
        ...(live ? { channel: source.channel } : { video: `v${source.video}` }),
      });
      const on = (name, fallbackName, fn) => player.addEventListener(P[name] || fallbackName, fn);
      on('READY', 'ready', () => {
        ready = true;
        player.setMuted(muted);
        play();
      });
      on('PLAYING', 'playing', () => {
        online = true;
        setOffline(false);
        onStatus(live ? 'Live' : 'Replay', 'ok');
      });
      on('ONLINE', 'online', () => {
        online = true;
        setOffline(false);
        onStatus('Coming back…', 'wait');
        play();
      });
      on('OFFLINE', 'offline', () => {
        online = false;
        setOffline(true);
        onStatus('Offline: waiting for the camera to go live…', 'wait');
      });
      on('ENDED', 'ended', () => {
        if (live) setOffline(true);
        onStatus(live ? 'Stream ended: waiting…' : 'Replay finished', live ? 'wait' : '');
      });
      // An offline channel reports "blocked" too; that's not something a tap can fix.
      on('PLAYBACK_BLOCKED', 'playbackBlocked', () => online && onStatus('Tap to start', 'tap'));
      // A live feed left paused (a dropout, or the browser pausing it) is started again.
      if (live) {
        timer = setInterval(() => {
          try {
            if (ready && online && player.isPaused() && !player.getEnded()) play();
          } catch {}
        }, 8000);
      }
    })
    .catch(() => {
      // Without the API, fall back to the plain embed, which shows its own play button.
      if (stopped) return;
      box.remove();
      fallback = iframePlayer(source, stage, onStatus);
    });

  return {
    isMuted: () => {
      try {
        return player ? player.getMuted() : muted;
      } catch {
        return muted;
      }
    },
    setMuted(m) {
      muted = m;
      try {
        player?.setMuted(m);
        if (!m) play();
      } catch {}
    },
    resume: play,
    stop() {
      stopped = true;
      clearInterval(timer);
      setOffline(false);
      fallback?.stop();
      box.remove();
    },
  };
}

// The sound and resume controls for players built on a <video>.
function videoControls(video) {
  return {
    isMuted: () => video.muted,
    setMuted(m) {
      video.muted = m;
      if (!m) video.play().catch(() => {});
    },
    resume: () => video.play().catch(() => {}),
  };
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
    ...videoControls(video),
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
    ...videoControls(video),
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
