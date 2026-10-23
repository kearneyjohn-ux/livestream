import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, embedUrl, isBlockedHttp, encodeState, decodeState, shortInput, watchLink } from '../js/sources.js';

test('YouTube links in every common shape', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&feature=share`,
    `youtube.com/live/${id}?si=abc`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    id,
  ]) {
    assert.deepEqual(parseSource(link), { kind: 'youtube', videoId: id }, link);
  }
});

test('YouTube channel links play whatever the channel has live', () => {
  const ch = 'UCabcdefghijklmnopqrstuv';
  assert.deepEqual(parseSource(`https://www.youtube.com/channel/${ch}`), { kind: 'youtube', channelId: ch });
  assert.deepEqual(parseSource(`https://www.youtube.com/embed/live_stream?channel=${ch}`), { kind: 'youtube', channelId: ch });
  assert.match(embedUrl({ kind: 'youtube', channelId: ch }, 'x'), /live_stream\?channel=UCabc.*mute=1/);
});

test('YouTube links that cannot be embedded explain what to paste instead', () => {
  assert.throws(() => parseSource('https://www.youtube.com/@westlime'), /Copy link/);
  assert.throws(() => parseSource('https://youtu.be/short'), /video ID/);
});

test('Twitch channels need the page host for the embed', () => {
  assert.deepEqual(parseSource('https://www.twitch.tv/TruckCam_1'), { kind: 'twitch', channel: 'truckcam_1' });
  assert.equal(
    embedUrl({ kind: 'twitch', channel: 'truckcam_1' }, 'me.github.io'),
    'https://player.twitch.tv/?channel=truckcam_1&parent=me.github.io&muted=true&autoplay=true',
  );
  assert.throws(() => parseSource('https://twitch.tv/'), /channel link/);
});

test('.m3u8 links are HLS', () => {
  assert.deepEqual(parseSource('https://cam.example.com:8888/truck1/index.m3u8'), {
    kind: 'hls',
    url: 'https://cam.example.com:8888/truck1/index.m3u8',
  });
  assert.equal(parseSource('https://x.example/live/a.m3u8?token=1').kind, 'hls');
});

test('Other links are WebRTC, with /whep added for MediaMTX-style addresses', () => {
  assert.deepEqual(parseSource('https://cam.example.com:8889/truck1'), {
    kind: 'webrtc',
    url: 'https://cam.example.com:8889/truck1/whep',
  });
  assert.equal(parseSource('cam.example.com:8889/truck2/').url, 'https://cam.example.com:8889/truck2/whep');
  assert.equal(parseSource('https://cam.example.com:8889/truck1/whep').url, 'https://cam.example.com:8889/truck1/whep');
  const cf = 'https://customer-abc.cloudflarestream.com/0123abcd/webRTC/play';
  assert.equal(parseSource(cf).url, cf);
});

test('Camera-side addresses and junk are refused with a reason', () => {
  assert.throws(() => parseSource('rtmp://a.rtmp.youtube.com/live2/key'), /RTMP is where the camera sends/);
  assert.throws(() => parseSource('https://exa mple'), /doesn't look like a link/);
  assert.throws(() => parseSource('ftp://x/y'), /http/);
  assert.equal(parseSource('   '), null);
  assert.equal(parseSource(undefined), null);
});

test('http streams are blocked on an https page, except from this computer', () => {
  const http = parseSource('http://203.0.113.5:8889/truck1');
  assert.equal(isBlockedHttp(http, 'https:'), true);
  assert.equal(isBlockedHttp(http, 'http:'), false);
  assert.equal(isBlockedHttp(parseSource('http://localhost:8889/truck1'), 'https:'), false);
  assert.equal(isBlockedHttp(parseSource('https://youtu.be/dQw4w9WgXcQ'), 'https:'), false);
});

test('Screen setup round-trips through the share link', () => {
  const state = {
    title: 'KDR 2026 · Truck 12',
    layout: 'col',
    view: false,
    panes: [
      { input: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=1', label: 'Bonnet & roof' },
      { input: 'https://cam.example.com:8889/truck2', label: '' },
    ],
  };
  const hash = encodeState(state);
  assert.deepEqual(decodeState(`#${hash}`), state);
  assert.equal(encodeState({ layout: 'auto', panes: [{ input: 'a' }, {}] }), 'a=a');
  assert.equal(decodeState(''), null);
  assert.equal(decodeState('#layout=row'), null);
  assert.equal(decodeState('#a=x&layout=bogus').layout, 'auto');
});

test('Watch links are short, titled and open in watch-only mode', () => {
  const state = {
    title: 'KDR 2026',
    layout: 'auto',
    view: false,
    panes: [
      { input: 'https://www.youtube.com/live/dQw4w9WgXcQ?si=Xy12abcdEFGH', label: 'Bonnet' },
      { input: 'https://www.twitch.tv/TruckCam', label: 'Roof' },
    ],
  };
  const link = watchLink(state, 'https://me.github.io/livestream/#a=old');
  assert.equal(link, 'https://me.github.io/livestream/#a=dQw4w9WgXcQ&an=Bonnet&b=twitch.tv%2Ftruckcam&bn=Roof&t=KDR+2026&view=1');
  const opened = decodeState(new URL(link).hash);
  assert.equal(opened.view, true);
  assert.equal(opened.title, 'KDR 2026');
  assert.deepEqual(parseSource(opened.panes[0].input), parseSource(state.panes[0].input));
  assert.deepEqual(parseSource(opened.panes[1].input), parseSource(state.panes[1].input));
  // Links the app can't shorten go through unchanged.
  assert.equal(shortInput('https://cam.example.com:8889/truck1'), 'https://cam.example.com:8889/truck1');
  assert.equal(shortInput('not a link at all'), 'not a link at all');
});
