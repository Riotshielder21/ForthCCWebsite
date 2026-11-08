import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUB_REPLY_TO, emailReplyTo, TREASURER_REPLY_TO } from './emailReplyTo.js';

test('customer receipt and payment-failure messages reply to the treasurer', () => {
  for (const kind of ['order-receipt', 'payment-failed', 'invoice-failed', 'subscription-stopped']) {
    assert.equal(emailReplyTo({ kind }, 'volunteer@example.test'), TREASURER_REPLY_TO, kind);
  }
});

test('cancellation requests and membership renewals reply to the secretary', () => {
  for (const kind of ['cancel-request', 'renewal']) {
    assert.equal(emailReplyTo({ kind }, 'volunteer@example.test'), CLUB_REPLY_TO, kind);
  }
});

test('all staff alerts reply to the secretary, including payment-related alerts', () => {
  for (const attentionKind of ['cancel-request', 'discount-reused', 'invoice-failed', 'order-unrecorded', 'payment-failed',
    'receipt-email', 'subscription-ended', 'subscription-setup', 'other']) {
    assert.equal(emailReplyTo({ kind: 'staff-alert', attentionKind }, 'volunteer@example.test'), CLUB_REPLY_TO, attentionKind);
  }
  assert.equal(emailReplyTo({ kind: 'staff-alert' }), CLUB_REPLY_TO);
});

test('volunteer messages and codes reply to the configured volunteer coordinator', () => {
  for (const kind of ['volunteer-induction', 'volunteer-benefits', 'volunteer-renewal', 'volunteer-boathouse-code']) {
    assert.equal(emailReplyTo({ kind }, 'volunteer@example.test'), 'volunteer@example.test', kind);
  }
  assert.equal(emailReplyTo({ kind: 'email-code', purpose: 'volunteer' }, 'volunteer@example.test'), 'volunteer@example.test');
});

test('volunteer mail falls back to the club address when no coordinator is configured', () => {
  assert.equal(emailReplyTo({ kind: 'volunteer-benefits' }), CLUB_REPLY_TO);
});

test('unrelated emails retain the normal club reply address', () => {
  assert.equal(emailReplyTo({ kind: 'event-roster' }, 'volunteer@example.test'), CLUB_REPLY_TO);
  assert.equal(emailReplyTo({ kind: 'email-code', purpose: 'details' }, 'volunteer@example.test'), CLUB_REPLY_TO);
});
