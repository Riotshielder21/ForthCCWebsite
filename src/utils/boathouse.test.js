import test from 'node:test';
import assert from 'node:assert/strict';
import { boathouseAccessFromSettings, validateBoathouseCode, BOATHOUSE_LIMITS } from './boathouse.js';

const codes = { gateCode: '4821', alarmCode: 'A-1234', lockboxCode: '7788', gateNote: '', alarmNote: '', lockboxNote: '' };

test('boathouse codes are trimmed and saved with independent optional notes', () => {
  assert.deepEqual(validateBoathouseCode({
    gateCode: ' 4821 ', alarmCode: ' A-1234 ', lockboxCode: ' 7788 ',
    gateNote: ' Side gate ', alarmNote: '', lockboxNote: ' Key safe '
  }).value, { ...codes, gateNote: 'Side gate', lockboxNote: 'Key safe' });
  assert.equal(validateBoathouseCode({ ...codes, alarmNote: 'Line one\nLine two' }).value.alarmNote, 'Line one\nLine two');
});

test('legacy single boathouse code settings migrate to the gate code', () => {
  assert.deepEqual(boathouseAccessFromSettings({ code: '4821', note: 'Old gate note', version: 3 }), {
    gateCode: '4821', gateNote: 'Old gate note', alarmCode: '', alarmNote: '', lockboxCode: '', lockboxNote: ''
  });
  assert.deepEqual(boathouseAccessFromSettings({
    code: 'legacy', gateCode: 'new gate', alarmCode: 'alarm', lockboxCode: 'box'
  }), { gateCode: 'new gate', gateNote: '', alarmCode: 'alarm', alarmNote: '', lockboxCode: 'box', lockboxNote: '' });
});

test('all three boathouse codes must be present, short and printable', () => {
  assert.ok(validateBoathouseCode({}).error);
  assert.match(validateBoathouseCode({ ...codes, alarmCode: '' }).error, /alarm code/);
  assert.match(validateBoathouseCode({ ...codes, lockboxCode: 1234 }).error, /lockbox code/);
  assert.ok(validateBoathouseCode({ ...codes, gateCode: 'x'.repeat(BOATHOUSE_LIMITS.code + 1) }).error);
  assert.ok(validateBoathouseCode({ ...codes, alarmCode: '12\n34' }).error);
  assert.ok(validateBoathouseCode({ ...codes, lockboxNote: 'x'.repeat(BOATHOUSE_LIMITS.note + 1) }).error);
  assert.ok(validateBoathouseCode({ ...codes, gateNote: 'bell\u0007' }).error);
});
