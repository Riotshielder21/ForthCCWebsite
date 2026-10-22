import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRawEmail } from './mail.js';

const decode = (raw) => Buffer.from(raw, 'base64url').toString('utf8');
const bodyOf = (message) => Buffer.from(message.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('encodes a non-ASCII subject and body', () => {
  const message = decode(buildRawEmail({ fromName: 'Forth Canoe Club', from: 'a@b.co', to: 'x@y.com', subject: 'Receipt £5', body: 'Total £5\nThanks' }));
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.match(message, /Content-Transfer-Encoding: base64/);
  assert.equal(bodyOf(message), 'Total £5\r\nThanks');
});

test('keeps plain ASCII subjects readable and strips header injection', () => {
  const message = decode(buildRawEmail({ fromName: 'FCC', from: 'a@b.co', to: 'x@y.com', subject: 'Hi\r\nBcc: z@z.com', body: 'x' }));
  assert.match(message, /Subject: Hi Bcc: z@z.com\r\n/);
  assert.doesNotMatch(message, /\r\nBcc:/);
});

test('rejects recipients that are not one plain address', () => {
  for (const to of ['x@y.com\r\nBcc: z@z.com', 'a@b.com, c@d.com', 'no-at-sign', '']) {
    assert.throws(() => buildRawEmail({ fromName: 'FCC', from: 'a@b.co', to, subject: 's', body: 'b' }), /Invalid recipient/);
  }
});
