import test from 'node:test';
import assert from 'node:assert/strict';
import { LIST_TYPES, validateListSubmission, sheetCell, matchesVolunteer, volunteerCodeDecision, boathouseCodeDecision } from './lists.js';

const valid = { name: 'Ann Paddler', email: 'Ann@Example.com', category: 'Equipment Needed', items: ['What equipment do you need?: 2 paddles'], notes: '' };

test('every list type on the volunteering page is accepted, by category or listType', () => {
  for (const listType of LIST_TYPES) {
    assert.equal(validateListSubmission({ ...valid, category: listType }).value.listType, listType);
    assert.equal(validateListSubmission({ ...valid, category: undefined, listType }).value.listType, listType);
  }
});

test('list submissions are trimmed and the email lower-cased', () => {
  const { value } = validateListSubmission({ ...valid, name: '  Ann  ', items: [' a ', '', '  '], notes: ' n ' });
  assert.deepEqual(value, { name: 'Ann', email: 'ann@example.com', listType: 'Equipment Needed', items: ['a'], notes: 'n' });
});

test('invalid list submissions are rejected', () => {
  const cases = [
    { name: '' }, { name: 'x'.repeat(121) }, { email: 'not-an-email' }, { email: 'a@b' }, { category: 'Admin' }, { category: '' },
    { items: [] }, { items: 'one' }, { items: ['   '] }, { items: Array(21).fill('x') }, { items: ['x'.repeat(501)] }, { notes: 'x'.repeat(2001) }
  ];
  for (const change of cases) assert.ok(validateListSubmission({ ...valid, ...change }).error, JSON.stringify(change).slice(0, 60));
});

test('spreadsheet cells that look like formulas are escaped', () => {
  assert.equal(sheetCell('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(sheetCell('+44 7700'), '\'+44 7700');
  assert.equal(sheetCell('-1'), '\'-1');
  assert.equal(sheetCell('@SUM(A1)'), '\'@SUM(A1)');
  assert.equal(sheetCell('Paddles'), 'Paddles');
  assert.equal(sheetCell(null), '');
});

test('a volunteer only matches a member when the name and a contact email both match', () => {
  const member = { firstName: 'Ann', lastName: 'Paddler', contactEmails: ['ann@example.com', 'parent@example.com'] };
  assert.equal(matchesVolunteer(member, { name: ' ann  paddler ', email: 'ann@example.com' }), true);
  assert.equal(matchesVolunteer(member, { name: 'Ann Paddler', email: 'parent@example.com' }), true);
  assert.equal(matchesVolunteer(member, { name: 'Ann Paddler', email: 'someone@example.com' }), false);
  assert.equal(matchesVolunteer(member, { name: 'Bob Paddler', email: 'ann@example.com' }), false);
  assert.equal(matchesVolunteer({ contactEmails: ['ann@example.com'] }, { name: '', email: 'ann@example.com' }), false);
});

test('volunteer codes need an induction and an active membership, and are issued once', () => {
  assert.equal(volunteerCodeDecision({ inducted: false, memberActive: true }), 'awaiting-induction');
  assert.equal(volunteerCodeDecision({ inducted: true, memberActive: false }), 'awaiting-membership');
  assert.equal(volunteerCodeDecision({ inducted: false, memberActive: false }), 'awaiting-induction');
  assert.equal(volunteerCodeDecision({ inducted: true, memberActive: true }), 'issue');
  assert.equal(volunteerCodeDecision({ inducted: true, memberActive: true, codeIssued: true }), 'issued');
});

test('the boathouse code goes to inducted, active volunteers who are active members, once per code version', () => {
  const ready = { inducted: true, active: true, memberActive: true, codeVersion: 2, sentVersion: 1 };
  assert.equal(boathouseCodeDecision(ready), 'send');
  assert.equal(boathouseCodeDecision({ ...ready, sentVersion: 0 }), 'send');
  assert.equal(boathouseCodeDecision({ ...ready, sentVersion: 2 }), 'up-to-date');
  assert.equal(boathouseCodeDecision({ ...ready, codeVersion: 0 }), 'no-code');
  assert.equal(boathouseCodeDecision({ ...ready, inducted: false }), 'not-active');
  assert.equal(boathouseCodeDecision({ ...ready, active: false }), 'not-active');
  assert.equal(boathouseCodeDecision({ ...ready, memberActive: false }), 'not-active');
});
