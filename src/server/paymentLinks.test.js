import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPaymentLink, resolvePaymentLink } from './paymentLinks.js';

test('compact payment keys resolve by purpose and keep tokens out of storage', async () => {
  const records = new Map();
  const db = { collection: () => ({ doc: (id) => ({
    create: async (value) => { records.set(id, value); },
    get: async () => ({ data: () => records.get(id) })
  }) }) };
  const token = 'a'.repeat(64);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  for (const kind of ['order', 'subscription']) {
    const key = await createPaymentLink(db, kind, 'example', tokenHash);
    assert.equal(key.length, 22);
    assert.deepEqual(await resolvePaymentLink(db, key, kind), { id: 'example', tokenHash });
    assert.equal(await resolvePaymentLink(db, key, kind === 'order' ? 'subscription' : 'order'), null);
    assert.ok(!JSON.stringify([...records]).includes(key));
    assert.ok(!JSON.stringify([...records]).includes(token));
  }
  assert.deepEqual(await resolvePaymentLink(db, `sub_legacy.${token}`, 'subscription'), { id: 'sub_legacy', tokenHash });
  assert.equal(await resolvePaymentLink(db, 'z'.repeat(22), 'subscription'), null);
  assert.equal(await resolvePaymentLink(db, '../invalid', 'order'), null);
});
