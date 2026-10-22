import { eventScheduleLabel } from './catalogue.js';
import { itemLabel } from './inventory.js';

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

const receiptItems = (items, order) => items.map((item) => ({
  name: itemLabel(item) || 'Item',
  price: Number(item.price || 0),
  billing: order.billingMode === 'monthly' && item.type === 'subscription' ? 'per month' : '',
  schedule: item.eventSchedule ? eventScheduleLabel(item.eventSchedule) : ''
}));

/** Shared person-to-purchase grouping for the website receipt and confirmation email. */
export const buildReceiptSummary = (orderRef, order) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const assignedLineIds = new Set();
  const people = (Array.isArray(order.people) ? order.people : []).map((person) => {
    const personItems = items.filter((item) => (person.lineIds || []).includes(item.lineId));
    personItems.forEach((item) => assignedLineIds.add(item.lineId));
    const toReceiptItems = (selected) => receiptItems(selected, order);
    return {
      name: `${person.firstName || ''} ${person.lastName || ''}`.trim() || 'Member',
      email: person.email || person.guardian?.email || order.email || '',
      memberships: toReceiptItems(personItems.filter((item) => item.category === 'MEMBERSHIP')),
      addOns: toReceiptItems(personItems.filter((item) => item.category !== 'MEMBERSHIP' && item.category !== 'EVENTS' && item.type !== 'voucher')),
      events: toReceiptItems(personItems.filter((item) => item.category === 'EVENTS'))
    };
  });
  const otherItems = receiptItems(items.filter((item) => !assignedLineIds.has(item.lineId)), order);
  const vouchers = (Array.isArray(order.vouchers) ? order.vouchers : []).map((voucher) => ({
    code: String(voucher.code || ''), name: String(voucher.name || 'Voucher'), value: Number(voucher.value || 0),
    expiresAt: voucher.expiresAt?.toDate?.().toISOString() || (voucher.expiresAt ? new Date(voucher.expiresAt).toISOString() : '')
  }));
  return { orderRef, payerEmail: order.email || '', total: Number(order.total || 0), people, otherItems, vouchers };
};

const itemLines = (label, items) => items.length
  ? [`${label}:`, ...items.map((item) => `- ${item.name}: ${money(item.price)}${item.billing ? ` ${item.billing}` : ''}${item.schedule ? ` — ${item.schedule}` : ''}`)]
  : [];

export const receiptEmailCopy = (receipt) => [
  'Forth Canoe Club purchase receipt',
  '',
  `Order reference: ${receipt.orderRef}`,
  `Paid by: ${receipt.payerEmail}`,
  `Total paid: ${money(receipt.total)}`,
  '',
  ...receipt.people.flatMap((person) => [
    `${person.name}`,
    `Email: ${person.email}`,
    ...itemLines('Membership', person.memberships),
    ...itemLines('Add-ons', person.addOns),
    ...itemLines('Events', person.events),
    ''
  ]),
  ...itemLines('Other items', receipt.otherItems),
  ...(receipt.vouchers.length ? ['', 'Vouchers:', ...receipt.vouchers.flatMap((voucher) => [
    `- ${voucher.name}: ${voucher.code}`,
    `  Value: ${money(voucher.value)}${voucher.expiresAt ? `; valid until ${new Date(voucher.expiresAt).toLocaleDateString('en-GB')}` : ''}`,
    '  Valid on all items except membership. One use only; any unused value is forfeited.'
  ])] : []),
  '',
  'Thank you for your purchase from Forth Canoe Club.'
].join('\n');