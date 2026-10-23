import { eventScheduleLabel } from './catalogue.js';
import { itemLabel } from './inventory.js';

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

export const receiptItemNames = (item, people = []) => {
  if (!item.lineId) return [];
  return [...new Set(people
    .filter((person) => Array.isArray(person.lineIds) && person.lineIds.includes(item.lineId))
    .map((person) => `${person.firstName || ''} ${person.lastName || ''}`.trim())
    .filter(Boolean))];
};

const joinParts = (...parts) => parts.map((part) => String(part || '').trim()).filter(Boolean).join(', ');
const formatDob = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
};
const contactLine = (contact = {}) => {
  const name = [contact.name, contact.relationship && `(${contact.relationship})`].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  return joinParts(name, contact.phone);
};

/**
 * Submitted person details an admin may add to confirmation emails. Emails only: the secure receipt link never
 * receives these, because anyone holding the link can open it.
 */
export const RECEIPT_PERSON_FIELDS = [
  { key: 'dob', label: 'Date of birth', value: (person) => formatDob(person.dob) },
  { key: 'phone', label: 'Phone', value: (person) => person.phone },
  { key: 'address', label: 'Address', value: (person) => joinParts(person.address, person.postcode) },
  { key: 'affiliationNumber', label: 'Paddle Scotland number', value: (person) => person.affiliationNumber },
  { key: 'membershipId', label: 'Club membership ID', value: (person) => person.membershipId },
  { key: 'swimming', label: 'Swimming ability', value: (person) => person.swimming },
  { key: 'guardian', label: 'Parent or guardian', value: (person) => contactLine(person.guardian) },
  { key: 'emergencyContact', label: 'Emergency contact', value: (person) => contactLine(person.emergencyContact) },
  { key: 'medical', label: 'Medical information', value: (person) => person.medical, sensitive: true },
  { key: 'photoConsent', label: 'Photo consent', value: (person) => typeof person.photoConsent === 'boolean' ? (person.photoConsent ? 'Yes' : 'No') : '' }
];

const FIELD_KEYS = new Set(RECEIPT_PERSON_FIELDS.map((field) => field.key));

/** Keeps known field keys in the allow-list order, so stored settings cannot inject arbitrary person properties. */
export const normalizeReceiptPersonFields = (keys) => {
  const wanted = new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && FIELD_KEYS.has(key)) : []);
  return RECEIPT_PERSON_FIELDS.map((field) => field.key).filter((key) => wanted.has(key));
};

const personDetails = (person, keys) => RECEIPT_PERSON_FIELDS
  .filter((field) => keys.includes(field.key))
  .map((field) => ({ label: field.label, value: String(field.value(person) ?? '').trim() }))
  .filter((detail) => detail.value);


const receiptItems = (items, order) => items.map((item) => ({
  name: itemLabel(item) || 'Item',
  personNames: receiptItemNames(item, Array.isArray(order.people) ? order.people : []),
  price: Number(item.price || 0),
  billing: (typeof item.monthly === 'boolean' ? item.monthly : order.billingMode === 'monthly' && item.type === 'subscription') ? 'per month' : '',
  schedule: item.eventSchedule ? eventScheduleLabel(item.eventSchedule) : '',
  ...(item.category === 'EVENTS' && item.imageUrl ? { imageUrl: item.imageUrl } : {})
}));

/** Shared person-to-purchase grouping for the website receipt and confirmation email. */
export const buildReceiptSummary = (orderRef, order, { personFields = [] } = {}) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const detailKeys = normalizeReceiptPersonFields(personFields);
  const assignedLineIds = new Set();
  const people = (Array.isArray(order.people) ? order.people : []).map((person) => {
    const personItems = items.filter((item) => (person.lineIds || []).includes(item.lineId));
    personItems.forEach((item) => assignedLineIds.add(item.lineId));
    const toReceiptItems = (selected) => receiptItems(selected, order);
    return {
      name: `${person.firstName || ''} ${person.lastName || ''}`.trim() || 'Member',
      email: person.email || person.guardian?.email || order.email || '',
      ...(detailKeys.length ? { details: personDetails(person, detailKeys) } : {}),
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
  ...(receipt.payerEmail ? [`Paid by: ${receipt.payerEmail}`] : []),
  `Total paid: ${money(receipt.total)}`,
  '',
  ...receipt.people.flatMap((person) => [
    `${person.name}`,
    ...(person.email ? [`Email: ${person.email}`] : []),
    ...(person.details || []).map((detail) => `${detail.label}: ${detail.value}`),
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

/** Link receipts expose purchase data and assigned names, never the full submitted person or legacy receipt. */
export const buildLinkedReceipt = (orderRef, order) => {
  const people = (Array.isArray(order.people) ? order.people : []).map((person) => ({
    firstName: person.firstName, lastName: person.lastName, lineIds: person.lineIds
  }));
  const itemFields = ['id', 'lineId', 'name', 'category', 'type', 'price', 'size', 'monthly', 'eventSchedule', 'imageUrl'];
  const items = (Array.isArray(order.items) ? order.items : []).map((item) => ({
    ...Object.fromEntries(itemFields.filter((field) => item[field] !== undefined).map((field) => [field, item[field]])),
    personNames: receiptItemNames(item, people)
  }));
  const total = order.total || '0';
  return {
    orderRef, items, total,
    copy: receiptEmailCopy(buildReceiptSummary(orderRef, { items, people, total, billingMode: order.billingMode }))
  };
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const emailImageUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
};

const htmlItems = (label, items) => items.length ? `
  <h3 style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#64748b;margin:28px 0 8px">${escapeHtml(label)}</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${items.map((item) => {
      const imageUrl = emailImageUrl(item.imageUrl);
      return `<tr>
        <td style="padding:14px 16px 14px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px">
          <strong>${escapeHtml(item.name)}</strong>
          ${item.personNames?.length ? `<br><span style="font-size:12px;color:#0b3153">For: ${escapeHtml(item.personNames.join(', '))}</span>` : ''}
          ${item.schedule ? `<br><span style="color:#64748b">${escapeHtml(item.schedule)}</span>` : ''}
          ${imageUrl ? `<br><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" width="240" style="display:block;width:100%;max-width:240px;height:auto;margin-top:10px;border:0">` : ''}
        </td>
        <td style="padding:14px 0;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;white-space:nowrap;font-size:14px">
          <strong>${escapeHtml(money(item.price))}</strong>${item.billing ? `<br><span style="font-size:11px;color:#64748b">${escapeHtml(item.billing)}</span>` : ''}
        </td>
      </tr>`;
    }).join('')}
  </table>` : '';

/** Inline styles and table layout work in email clients without the website stylesheet. */
export const receiptEmailHtml = (receipt, retrievalUrl) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forth Canoe Club receipt</title></head>
<body style="margin:0;padding:28px 12px;background:#f8fafc;color:#002147;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px">
      <tr><td style="text-align:center;padding:0 12px 28px">
        <span aria-hidden="true" style="display:inline-block;border:4px solid #10b981;border-radius:50%;width:48px;height:48px;line-height:48px;font-size:30px;font-weight:bold;color:#10b981">&#10003;</span>
        <h1 style="font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:-1px;margin:16px 0 8px">Your purchase</h1>
        <p style="margin:0;color:#64748b">Thank you for your purchase from Forth Canoe Club.</p>
      </td></tr>
      <tr><td style="padding:28px 24px;background:#ffffff;border:1px solid #f1f5f9;border-radius:16px">
        <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#64748b">Order reference</p>
        <p style="margin:0 0 24px;padding-bottom:24px;border-bottom:1px solid #f1f5f9"><strong>${escapeHtml(receipt.orderRef)}</strong>
        ${receipt.payerEmail ? `<br><span style="color:#64748b">Paid by: ${escapeHtml(receipt.payerEmail)}</span>` : ''}</p>
        ${receipt.people.map((person) => `
          <h2 style="font-size:18px;margin:28px 0 4px">${escapeHtml(person.name)}</h2>
          ${person.email ? `<p style="margin:0;color:#64748b">Email: ${escapeHtml(person.email)}</p>` : ''}
          ${person.details?.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 0;font-size:13px">
            ${person.details.map((detail) => `<tr><td style="padding:2px 16px 2px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(detail.label)}</td>
              <td style="padding:2px 0;vertical-align:top;white-space:pre-line">${escapeHtml(detail.value)}</td></tr>`).join('')}
          </table>` : ''}
          ${htmlItems('Membership', person.memberships)}
          ${htmlItems('Bookings', person.events)}
          ${htmlItems('Additional items', person.addOns)}
        `).join('')}
        ${htmlItems('Other items', receipt.otherItems)}
        ${receipt.vouchers.length ? `<h2 style="font-size:20px;margin:28px 0 8px">Vouchers</h2>
          ${receipt.vouchers.map((voucher) => `<p><strong>${escapeHtml(voucher.name)}</strong><br>
            Code: <strong>${escapeHtml(voucher.code)}</strong><br>
            Value: ${escapeHtml(money(voucher.value))}${voucher.expiresAt ? `<br>Valid until ${escapeHtml(new Date(voucher.expiresAt).toLocaleDateString('en-GB'))}` : ''}<br>
            Valid on all items except membership. One use only; any unused value is forfeited.</p>`).join('')}` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #e2e8f0">
          <tr><td style="padding-top:20px;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#64748b">Total paid</td>
          <td style="padding-top:20px;text-align:right;font-size:28px;font-weight:900;white-space:nowrap">${escapeHtml(money(receipt.total))}</td></tr>
        </table>
        <p style="margin:28px 0 0;text-align:center"><a href="${escapeHtml(retrievalUrl)}" style="display:inline-block;padding:14px 24px;background:#002147;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700">View your receipt</a></p>
      </td></tr>
      <tr><td style="padding:20px 12px 0;text-align:center;font-size:12px;color:#64748b">
        <p>Keep this email. Its secure link lets you retrieve your receipt and subscription information without creating an account. Anyone with the link can see the purchased items and their assigned names.</p>
        <p>For help, contact <a href="mailto:secretary@forthcanoeclub.co.uk" style="color:#002147">secretary@forthcanoeclub.co.uk</a>.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;