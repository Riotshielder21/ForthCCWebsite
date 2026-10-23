import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBoathouseCode, BOATHOUSE_LIMITS } from './boathouse.js';

test('a boathouse code is trimmed and saved with an optional note', () => {
  assert.deepEqual(validateBoathouseCode({ code: ' 4821 ', note: ' Side door padlock ' }).value, { code: '4821', note: 'Side door padlock' });
  assert.deepEqual(validateBoathouseCode({ code: 'C-1234#' }).value, { code: 'C-1234#', note: '' });
  assert.deepEqual(validateBoathouseCode({ code: '1234', note: 'Line one\nLine two' }).value.note, 'Line one\nLine two');
});

test('a boathouse code must be present, short and printable', () => {
  assert.ok(validateBoathouseCode({}).error);
  assert.ok(validateBoathouseCode({ code: '   ' }).error);
  assert.ok(validateBoathouseCode({ code: 1234 }).error);
  assert.ok(validateBoathouseCode({ code: 'x'.repeat(BOATHOUSE_LIMITS.code + 1) }).error);
  assert.ok(validateBoathouseCode({ code: '12\n34' }).error);
  assert.ok(validateBoathouseCode({ code: '1234', note: 'x'.repeat(BOATHOUSE_LIMITS.note + 1) }).error);
  assert.ok(validateBoathouseCode({ code: '1234', note: 'bell\u0007' }).error);
});
