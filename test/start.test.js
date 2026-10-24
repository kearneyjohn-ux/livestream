import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUpcoming, startLines, toWaInput, fromWaInput, parseStart } from '../js/start.js';

const start = '2026-10-25T06:46:00+08:00';

test('Start times show in Perth and Sydney time with the right zone names', () => {
  const now = new Date('2026-10-25T06:00:00+08:00');
  assert.deepEqual(startLines(start, now), ['6:46 am AWST (Perth)', '9:46 am AEDT (Sydney)']);
  // In winter Sydney is on standard time, two hours ahead.
  const winter = '2026-06-14T07:03:00+08:00';
  assert.deepEqual(startLines(winter, new Date('2026-06-14T05:00:00+08:00')), ['7:03 am AWST (Perth)', '9:03 am AEST (Sydney)']);
  // Another day gets the date.
  assert.match(startLines(start, new Date('2026-10-24T12:00:00+08:00'))[0], /^Sun 25 Oct 6:46 am AWST \(Perth\)$/);
  assert.deepEqual(startLines(''), []);
});

test('A start time counts until it passes', () => {
  assert.equal(isUpcoming(start, new Date('2026-10-25T06:45:59+08:00')), true);
  assert.equal(isUpcoming(start, new Date('2026-10-25T06:46:00+08:00')), false);
  assert.equal(isUpcoming('', new Date()), false);
  assert.equal(isUpcoming('nonsense', new Date()), false);
});

test('Start times are entered in WA time', () => {
  assert.equal(toWaInput(start), '2026-10-25T06:46');
  assert.equal(fromWaInput('2026-10-25T06:46'), start);
  assert.equal(parseStart(fromWaInput('2026-10-25T07:03')).toISOString(), '2026-10-24T23:03:00.000Z');
  assert.equal(fromWaInput(''), '');
  assert.equal(toWaInput(''), '');
});
