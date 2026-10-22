import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeLabel, summariseVoucherCodes, voucherRows, voucherScope } from './vouchers.js';

const now = 1_000_000;
const code = (fields) => ({ orderRef: 'FCC-1', label: 'Gift voucher', discountValue: 60, used: false, expiresAt: now + 1, ...fields });

test('generated voucher codes are totalled per shop item; custom codes are left out', () => {
  const summaries = summariseVoucherCodes([
    code({ sourceProductId: 'vouchers' }),
    code({ sourceProductId: 'vouchers', used: true }),
    code({ sourceProductId: 'vouchers', expiresAt: now - 1 }),
    code({ sourceProductId: 'vouchers', discountValue: 25.5 }),
    code({}),
    { code: 'SUMMER', label: 'Gift voucher', discountValue: 10 }
  ], now);
  assert.deepEqual(summaries, [
    { productId: 'vouchers', label: 'Gift voucher', issued: 4, active: 2, used: 1, expired: 1, unspent: 85.5 },
    { productId: '', label: 'Gift voucher', issued: 1, active: 1, used: 0, expired: 0, unspent: 60 }
  ]);
});

test('each voucher shop item gets one row; older codes join by name and unmatched codes keep their own row', () => {
  const products = [
    { id: 'vouchers', name: 'Gift voucher', category: 'VOUCHERS', basePrice: 60 },
    { id: 'course-voucher', name: 'Course voucher', category: 'VOUCHERS', basePrice: 75 },
    { id: 'boat-hire', name: 'Gift voucher', category: 'SERVICES', basePrice: 85 }
  ];
  const rows = voucherRows(products, [
    { productId: 'vouchers', label: 'Renamed later', issued: 2, active: 1, used: 1, expired: 0, unspent: 60 },
    { productId: '', label: 'Gift voucher', issued: 1, active: 1, used: 0, expired: 0, unspent: 60 },
    { productId: '', label: 'Old voucher', issued: 1, active: 0, used: 1, expired: 0, unspent: 0 },
    { productId: 'removed', label: 'Removed voucher', issued: 1, active: 0, used: 0, expired: 1, unspent: 0 }
  ]);
  assert.deepEqual(rows.map(({ key, name, issued, active, unspent }) => ({ key, name, issued, active, unspent })), [
    { key: 'vouchers', name: 'Gift voucher', issued: 3, active: 2, unspent: 120 },
    { key: 'course-voucher', name: 'Course voucher', issued: 0, active: 0, unspent: 0 },
    { key: ':Old voucher', name: 'Old voucher', issued: 1, active: 0, unspent: 0 },
    { key: 'removed:Removed voucher', name: 'Removed voucher', issued: 1, active: 0, unspent: 0 }
  ]);
  assert.equal(rows[2].product, null);
});

test('a voucher scope keeps only known categories (never membership) and valid product ids', () => {
  assert.deepEqual(voucherScope({}), { categories: [], productIds: [] });
  assert.deepEqual(voucherScope({ voucherScope: { categories: ['EVENTS', 'MEMBERSHIP', 'EVENTS', 'NOPE'], productIds: ['boat-hire', '', 7, 'boat-hire'] } }),
    { categories: ['EVENTS'], productIds: ['boat-hire'] });
  assert.equal(scopeLabel({ categories: ['EVENTS'], productIds: ['boat-hire'] }, () => 'Kit hire'), 'all events, Kit hire');
  assert.equal(scopeLabel({}), 'Everything except membership');
});
