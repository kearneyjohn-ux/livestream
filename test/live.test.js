import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChannel, channelParam, parseChannelParam, sealMessage, openMessage, parseLines } from '../js/live.js';

// What a viewer gets from the watch link: no private key.
const viewerOf = (ch) => parseChannelParam(channelParam(ch));

test('A watch link carries the channel but not the key to send on it', async () => {
  const ch = await createChannel();
  const param = channelParam(ch);
  assert.match(param, /^gps-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(param.length < 160, `short enough for a link (${param.length})`);
  const viewer = viewerOf(ch);
  assert.deepEqual(viewer, { topic: ch.topic, key: ch.key, pub: ch.pub });
  assert.equal(parseChannelParam('nope'), null);
  assert.equal(parseChannelParam(''), null);
  assert.equal(parseChannelParam('bad topic!.k.p'), null);
});

test("Viewers open the owner's messages, accents and all", async () => {
  const ch = await createChannel();
  const setup = 'a=dQw4w9WgXcQ&ad=Se%C3%A1n+%C3%93+Briain&layout=pip';
  const payload = await sealMessage(ch, 1700000000123, setup);
  assert.ok(!payload.includes('dQw4w9WgXcQ'), 'the relay only sees ciphertext');
  assert.deepEqual(await openMessage(viewerOf(ch), payload), { seq: 1700000000123, setup });
});

test('Nobody without the private key can send, and tampering is caught', async () => {
  const owner = await createChannel();
  const viewer = viewerOf(owner);

  // A viewer (who has the link's encryption key) signs with a key of their own.
  const forger = await createChannel();
  const forged = await sealMessage({ ...forger, topic: owner.topic, key: owner.key }, 9e15, 'a=evil');
  assert.equal(await openMessage(viewer, forged), null);

  // Flip one character of a genuine message.
  const genuine = await sealMessage(owner, 1, 'a=x');
  const [iv, ct, sig] = genuine.split('.');
  const flipped = ct[0] === 'A' ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
  assert.equal(await openMessage(viewer, `${iv}.${flipped}.${sig}`), null);

  // A different channel's link can't read it.
  assert.equal(await openMessage(viewerOf(forger), genuine), null);
  assert.equal(await openMessage(viewer, 'junk'), null);
  assert.equal(await openMessage(viewer, ''), null);
});

test("ntfy's line-by-line JSON is read, skipping everything but messages", () => {
  const text = [
    '{"id":"a","time":1,"event":"open","topic":"t"}',
    '{"id":"b","time":2,"event":"message","topic":"t","message":"one"}',
    'not json',
    '',
    '{"id":"c","time":3,"event":"keepalive","topic":"t"}',
    '{"id":"d","time":4,"event":"message","topic":"t","message":"two"}',
  ].join('\n');
  assert.deepEqual(parseLines(text), ['one', 'two']);
});
