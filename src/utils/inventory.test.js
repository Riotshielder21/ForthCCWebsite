import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanStockFields, itemLabel, productLimits, remainingStock, isSoldOut, stockKey, stockProblem, wantedQuantities, withHold } from './inventory.js';

const shirt = { id: 'tee', name: 'Club T-shirt', category: 'MERCHANDISE', variants: [{ size: 'S', stock: 2 }, { size: 'M', stock: 1 }, { size: ' ', stock: 5 }, { size: 'XL', stock: -1 }] };
const course = { id: 'course', name: 'Intro course', category: 'EVENTS', capacity: 3 };
const line = (product, size) => ({ ...product, ...(size ? { size } : {}) });

test('only valid sizes count and unlimited products have no limits', () => {
  assert.deepEqual(productLimits(shirt), { S: 2, M: 1 });
  assert.deepEqual(productLimits(course), { all: 3 });
  assert.equal(productLimits({ category: 'EVENTS', capacity: 0 }), null);
  assert.equal(productLimits({ category: 'EVENTS' }), null);
  assert.equal(productLimits({ category: 'SERVICES', capacity: 5 }), null);
});

test('paid holds and live reservations use stock, expired reservations do not', () => {
  const now = 1_000_000;
  const holds = {
    paid: { until: null, lines: { S: 1 } },
    live: { until: now + 1000, lines: { S: 1, M: 1 } },
    stale: { until: now - 1, lines: { M: 1 } }
  };
  assert.deepEqual(remainingStock(shirt, holds, now), { S: 0, M: 0 });
  assert.deepEqual(remainingStock(shirt, { stale: holds.stale }, now), { S: 2, M: 1 });
  assert.equal(remainingStock({ category: 'SERVICES' }, holds, now), null);
});

test('a product is sold out only when every size is gone', () => {
  assert.equal(isSoldOut({ S: 0, M: 1 }), false);
  assert.equal(isSoldOut({ S: 0, M: 0 }), true);
  assert.equal(isSoldOut(null), false);
});

test('wanted quantities are checked per size and per event', () => {
  const wanted = wantedQuantities([line(shirt, 'S'), line(shirt, 'S'), line(shirt, 'M')]);
  assert.deepEqual(wanted, { S: 2, M: 1 });
  assert.equal(stockProblem(shirt, {}, wanted), null);
  assert.match(stockProblem(shirt, { x: { until: null, lines: { S: 1 } } }, wanted), /Only 1 of Club T-shirt \(S\) left/);
  assert.match(stockProblem(shirt, { x: { until: null, lines: { M: 1 } } }, wanted), /Club T-shirt \(M\) is sold out/);
  assert.match(stockProblem(shirt, {}, { XXL: 1 }), /choose an available size/);
  assert.match(stockProblem(course, { x: { until: null, lines: { all: 3 } } }, { all: 1 }), /Intro course is sold out/);
  assert.equal(stockProblem({ category: 'SERVICES', name: 'Hire' }, {}, { all: 50 }), null);
});

test('removing a hold returns its stock and a new hold drops expired ones', () => {
  const now = 5_000;
  const holds = withHold({ old: { until: now - 1, lines: { S: 1 } }, paid: { until: null, lines: { S: 1 } } }, 'order-1', { S: 1 }, now);
  assert.deepEqual(Object.keys(holds).sort(), ['order-1', 'paid']);
  const { 'order-1': released, ...rest } = holds;
  assert.ok(released);
  assert.deepEqual(remainingStock(shirt, rest, now), { S: 1, M: 1 });
});

test('size shows in item names and chooses the stock pool', () => {
  assert.equal(itemLabel({ name: 'Club T-shirt', size: 'M' }), 'Club T-shirt (M)');
  assert.equal(itemLabel({ name: 'Intro course' }), 'Intro course');
  assert.equal(stockKey(line(shirt, 'M')), 'M');
  assert.equal(stockKey(course), 'all');
});

test('saved stock fields are validated and tidied', () => {
  assert.deepEqual(cleanStockFields({ category: 'MERCHANDISE', variants: [{ size: ' S ', stock: '4' }, { size: '', stock: '' }, { size: 'M', stock: 0 }] }),
    { variants: [{ size: 'S', stock: 4 }, { size: 'M', stock: 0 }], capacity: null });
  assert.throws(() => cleanStockFields({ category: 'MERCHANDISE', variants: [] }), /at least one size/);
  assert.throws(() => cleanStockFields({ category: 'MERCHANDISE', variants: [{ size: 'S', stock: 1 }, { size: 'S', stock: 2 }] }), /listed twice/);
  assert.throws(() => cleanStockFields({ category: 'MERCHANDISE', variants: [{ size: 'S', stock: 1.5 }] }), /whole-number/);
  assert.throws(() => cleanStockFields({ category: 'MERCHANDISE', variants: [{ size: '', stock: 3 }] }), /whole-number/);
  assert.deepEqual(cleanStockFields({ category: 'EVENTS', capacity: '12' }), { capacity: 12 });
  assert.deepEqual(cleanStockFields({ category: 'EVENTS', capacity: '' }), { capacity: null });
  assert.throws(() => cleanStockFields({ category: 'EVENTS', capacity: '0' }), /at least 1/);
  assert.deepEqual(cleanStockFields({ category: 'SERVICES' }), { capacity: null });
});
