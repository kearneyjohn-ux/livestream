import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewerCount, viewerLabel } from '../js/viewers.js';

test('Viewer counts are read from the plain answer, and anything else means none', () => {
  assert.equal(parseViewerCount('12'), 12);
  assert.equal(parseViewerCount(' 0\n'), 0);
  assert.equal(parseViewerCount('westlimemotorsport467 is offline'), null);
  assert.equal(parseViewerCount('User not found: nobody'), null);
  assert.equal(parseViewerCount(''), null);
  assert.equal(parseViewerCount(undefined), null);
});

test('Viewer counts read nicely', () => {
  assert.equal(viewerLabel(1), '1 watching');
  assert.equal(viewerLabel(987), '987 watching');
  assert.equal(viewerLabel(1234), '1.2k watching');
  assert.equal(viewerLabel(2000), '2k watching');
  assert.equal(viewerLabel(15400), '15k watching');
});
