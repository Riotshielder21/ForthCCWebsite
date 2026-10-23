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

test('HTML emails use two alternative UTF-8 parts, not two displayed copies', () => {
  const message = decode(buildRawEmail({
    fromName: 'FCC', from: 'a@b.co', to: 'x@y.com', subject: 'Receipt - FCC-123',
    body: 'Total £5\nPlain receipt', html: '<p>Total £5</p><p>Formatted receipt</p>'
  }));
  assert.match(message, /Subject: Receipt - FCC-123\r\n/);
  const boundary = message.match(/Content-Type: multipart\/alternative; boundary="([^"]+)"/)[1];
  const parts = message.split(`--${boundary}`);
  assert.equal(parts.length, 4);
  assert.match(parts[1], /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(parts[2], /Content-Type: text\/html; charset=UTF-8/);
  assert.equal(bodyOf(parts[1]), 'Total £5\r\nPlain receipt');
  assert.equal(bodyOf(parts[2]), '<p>Total £5</p><p>Formatted receipt</p>');
  assert.equal(parts[3], '--');
  for (const part of parts.slice(1, 3)) {
    assert.match(part, /Content-Transfer-Encoding: base64/);
    assert.ok(part.split('\r\n\r\n')[1].trim().split('\r\n').every((line) => line.length <= 76));
  }
});
