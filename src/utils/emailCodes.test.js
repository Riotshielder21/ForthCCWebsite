import test from 'node:test';
import assert from 'node:assert/strict';
import { canSendCode, checkCode, codeEmail, generateCode, hashCode, nextCodeRecord, MAX_CODE_ATTEMPTS, CODE_TTL_MS, RESEND_AFTER_MS, MAX_CODES_PER_HOUR } from './emailCodes.js';

test('codes are six digits and only the salted hash is stored', () => {
  for (let index = 0; index < 50; index += 1) assert.match(generateCode(), /^\d{6}$/);
  const record = nextCodeRecord(null, { codeHash: hashCode('012345', 'salt'), salt: 'salt', now: 1000 });
  assert.equal(record.expiresAt, 1000 + CODE_TTL_MS);
  assert.equal(JSON.stringify(record).includes('012345'), false);
});

test('a code is accepted once valid and refused when wrong, expired or locked', () => {
  const record = nextCodeRecord(null, { codeHash: hashCode('123456', 'pepper'), salt: 'pepper', now: 0 });
  assert.equal(checkCode(record, '123456', 1), 'ok');
  assert.equal(checkCode(record, '654321', 1), 'wrong');
  assert.equal(checkCode(record, 'abc', 1), 'wrong');
  assert.equal(checkCode(record, '123456', CODE_TTL_MS), 'expired');
  assert.equal(checkCode({ ...record, attempts: MAX_CODE_ATTEMPTS }, '123456', 1), 'locked');
  assert.equal(checkCode(null, '123456', 1), 'missing');
});

test('codes are throttled per minute and per hour', () => {
  assert.equal(canSendCode(null, 0), true);
  let record = nextCodeRecord(null, { codeHash: 'a', salt: 'b', now: 0 });
  assert.equal(canSendCode(record, RESEND_AFTER_MS - 1), false);
  let now = 0;
  for (let sent = 1; sent < MAX_CODES_PER_HOUR; sent += 1) {
    now += RESEND_AFTER_MS;
    assert.equal(canSendCode(record, now), true);
    record = nextCodeRecord(record, { codeHash: 'a', salt: 'b', now });
  }
  assert.equal(canSendCode(record, now + RESEND_AFTER_MS), false, 'hourly limit reached');
  assert.equal(canSendCode(record, 60 * 60 * 1000), true, 'limit resets after an hour');
  assert.equal(nextCodeRecord(record, { codeHash: 'a', salt: 'b', now: 60 * 60 * 1000 }).sendCount, 1);
});

test('code emails state the purpose and expiry', () => {
  assert.match(codeEmail('111111', 'volunteer').body, /club-night check-in.*111111[\s\S]*10 minutes/);
  assert.match(codeEmail('222222', 'details').subject, /222222/);
});
