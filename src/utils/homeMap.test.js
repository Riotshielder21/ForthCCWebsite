import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageCopy } from '../constants/pageContent.js';

const retiredMapUrl = 'https://maps.app.goo.gl/sXk7kWQrv8EbgwY37';
const stableMapUrl = 'https://www.google.com/maps/search/?api=1&query=Forth+Canoe+Club%2C+Harrison+Park%2C+Polwarth%2C+Edinburgh+EH11+1ED';

test('homepage replaces the retired short map URL in defaults and saved content', () => {
  assert.equal(getPageCopy('home').start1Url, stableMapUrl);
  const copy = getPageCopy('home', {
    start1Url: retiredMapUrl,
    start1Text: `[This map](${retiredMapUrl}) marks the clubhouse.`
  });
  assert.equal(copy.start1Url, stableMapUrl);
  assert.equal(copy.start1Text, `[This map](${stableMapUrl}) marks the clubhouse.`);
});

test('membership copy uses Paddle Scotland in defaults and saved text', () => {
  assert.match(getPageCopy('membership').memberBody, /Paddle Scotland/);
  assert.doesNotMatch(getPageCopy('membership', { memberBody: 'Includes SCA membership.' }).memberBody, /\bSCA\b/);
});
