import test from 'node:test';
import assert from 'node:assert/strict';
import { emailBlockId, normalEmailBlocked } from './emailSuppression.js';

test('GDPR blocks every normal email, including fallback invoice emails, but permits its confirmation', async () => {
  const records = new Map();
  const db = {
    collection: (collection) => ({ doc: (id) => `${collection}/${id}` }),
    getAll: async (...paths) => paths.map((path) => ({ exists: records.has(path), data: () => records.get(path) }))
  };
  const email = 'erased@example.test';
  assert.equal(await normalEmailBlocked(db, email, { kind: 'invoice-paid' }), false);
  records.set(`gdprEmailBlocks/${emailBlockId(email.toUpperCase())}`, { at: 1 });
  assert.equal(await normalEmailBlocked(db, email, { kind: 'invoice-paid' }), true);
  assert.equal(await normalEmailBlocked(db, email, { kind: 'email-code' }), true);
  assert.equal(await normalEmailBlocked(db, email, { kind: 'gdpr-erasure' }), false);
  records.set(`gdprEmailBlocks/${emailBlockId(email)}`, { at: 1, expiresAt: { toMillis: () => Date.now() - 1 } });
  assert.equal(await normalEmailBlocked(db, email, { kind: 'email-code' }), false, 'an erased person can rejoin once the block lapses');
  records.clear();
  records.set('subscriptions/sub_1', { gdprErasurePending: true });
  assert.equal(await normalEmailBlocked(db, email, { kind: 'subscription-stopped', subscriptionId: 'sub_1' }), true);
  records.set('subscriptions/sub_1', { payerErased: true });
  assert.equal(await normalEmailBlocked(db, email, { kind: 'invoice-paid', subscriptionId: 'sub_1' }), true);
  records.set('subscriptions/sub_1', { gdprErasurePending: false, payerErased: false });
  assert.equal(await normalEmailBlocked(db, email, { kind: 'invoice-paid', subscriptionId: 'sub_1' }), false, 'a remaining shared payer still receives mail');
});
