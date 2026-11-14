import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCatalogueItem } from './catalogueSave.js';

test('Save all saves new and existing event details and normalized private viewers', async () => {
  const product = { id: 'P00001', category: 'EVENTS' };
  const writes = [];
  const viewers = await saveCatalogueItem(product, ' Helper@Example.test;\nhelper@example.test,second@example.test ', {
    saveProduct: async (value) => writes.push(['product', value]),
    saveViewers: async (id, values) => writes.push(['viewers', id, values])
  });
  assert.deepEqual(viewers, ['helper@example.test', 'second@example.test']);
  assert.deepEqual(writes, [['product', product], ['viewers', product.id, viewers]]);
});

test('clearing viewers saves an empty list', async () => {
  let saved;
  await saveCatalogueItem({ id: 'P00002', category: 'EVENTS' }, '', {
    saveProduct: async () => {},
    saveViewers: async (_id, values) => { saved = values; }
  });
  assert.deepEqual(saved, []);
});

test('invalid viewers prevent every write', async () => {
  let writes = 0;
  await assert.rejects(saveCatalogueItem({ category: 'EVENTS' }, 'invalid', {
    saveProduct: async () => { writes += 1; },
    saveViewers: async () => { writes += 1; }
  }), /not a valid email address/);
  assert.equal(writes, 0);
});

test('non-events save without writing viewer access', async () => {
  let writes = 0;
  assert.equal(await saveCatalogueItem({ category: 'SERVICES' }, 'irrelevant', {
    saveProduct: async () => { writes += 1; },
    saveViewers: async () => assert.fail('Non-events must not update viewers')
  }), null);
  assert.equal(writes, 1);
});

test('failed product saves do not grant access', async () => {
  await assert.rejects(saveCatalogueItem({ category: 'EVENTS' }, 'helper@example.test', {
    saveProduct: async () => { throw new Error('Product unavailable'); },
    saveViewers: async () => assert.fail('Must not grant access after a failed save')
  }), /Product unavailable/);
});

test('failed viewer saves explicitly report the partial save and can be retried', async () => {
  const product = { id: 'P00003', category: 'EVENTS' };
  let writes = 0;
  const saveProduct = async () => { writes += 1; };
  await assert.rejects(saveCatalogueItem(product, 'helper@example.test', {
    saveProduct, saveViewers: async () => { throw new Error('API unavailable'); }
  }), /Item details saved, but attendee-list viewers were not saved: API unavailable.*Save all to retry/);
  await saveCatalogueItem(product, 'helper@example.test', { saveProduct, saveViewers: async () => {} });
  assert.equal(writes, 2);
});
