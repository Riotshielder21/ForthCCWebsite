import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReceiptSummary, buildLinkedReceipt, receiptItemNames, receiptEmailCopy, receiptEmailHtml, normalizeReceiptPersonFields, RECEIPT_PERSON_FIELDS, receiptPersonWithRecord } from './receipt.js';

const order = {
  email: 'payer@example.test', totalPence: 7500, billingMode: 'monthly',
  people: [
    { firstName: 'Alex', lastName: 'Member', email: 'alex@example.test', lineIds: ['membership', 'subscription', 'event'] },
    { firstName: 'Jamie', lastName: 'Junior', guardian: { email: 'guardian@example.test' }, lineIds: ['junior'] }
  ],
  items: [
    { lineId: 'membership', name: 'Adult membership', category: 'MEMBERSHIP', pricePence: 2500 },
    { lineId: 'subscription', name: 'Coaching', category: 'SUBSCRIPTIONS', type: 'subscription', pricePence: 2000 },
    { lineId: 'event', name: 'River trip', category: 'EVENTS', pricePence: 1000, imageUrl: 'https://example.test/trip.jpg',
      eventSchedule: { mode: 'single', startDate: '2026-11-01', startTime: '10:00', endTime: '12:00', timeZone: 'Europe/London' } },
    { lineId: 'junior', name: 'Junior membership', category: 'MEMBERSHIP', pricePence: 1500 },
    { lineId: 'shirt', name: 'Club shirt', category: 'MERCHANDISE', size: 'M', pricePence: 500 }
  ],
  vouchers: [{ name: 'Gift voucher', code: 'FCC-GIFT', value: 60, expiresAt: '2027-10-22T00:00:00Z' }]
};

test('plain and HTML receipts include the reference, people, purchases, schedules and vouchers', () => {
  const summary = buildReceiptSummary('FCC-123', order);
  assert.equal(summary.people[0].memberships[0].name, 'Adult membership');
  assert.deepEqual(summary.people[0].memberships[0].personNames, ['Alex Member']);
  assert.equal(summary.people[0].addOns[0].billing, 'per month');
  assert.equal(summary.people[0].events[0].imageUrl, 'https://example.test/trip.jpg');
  assert.equal(summary.people[1].email, 'guardian@example.test');
  assert.match(summary.otherItems[0].name, /Club shirt.*M/);
  const text = receiptEmailCopy(summary);
  const html = receiptEmailHtml(summary, 'https://example.test/order/FCC-123.token');
  for (const content of [text, html]) {
    for (const value of ['FCC-123', 'payer@example.test', '£75.00', 'Alex Member', 'Jamie Junior',
      'guardian@example.test', 'Adult membership', 'Coaching', 'per month', 'River trip', '1 Nov 2026',
      'Europe/London', 'Club shirt', 'FCC-GIFT', '£60.00', '22/10/2027', 'One use only']) {
      assert.ok(content.includes(value), `missing ${value}`);
    }
  }
  assert.match(html, /src="https:\/\/example.test\/trip.jpg"/);
  assert.match(html, /href="https:\/\/example.test\/order\/FCC-123.token"/);
  assert.match(html, /For: Alex Member/);
  assert.match(html, /color:#002147/);
  assert.ok(html.indexOf('Total paid') > html.indexOf('Club shirt'), 'total appears after the itemized purchases');
  assert.doesNotMatch(text, /<html|<table|<img/);
});

test('HTML escapes all customer, catalogue and voucher text and attribute values', () => {
  const unsafe = '<script>alert("x")</script> & \'';
  const summary = buildReceiptSummary(unsafe, {
    ...order, email: unsafe,
    people: [{ firstName: unsafe, email: unsafe, lineIds: ['event'] }],
    items: [{ lineId: 'event', name: unsafe, category: 'EVENTS', pricePence: 1000,
      imageUrl: 'https://example.test/image?x=" onerror="alert(1)' }],
    vouchers: [{ name: unsafe, code: unsafe, value: 10 }]
  });
  const html = receiptEmailHtml(summary, 'https://example.test/order/ref?x="&y=1');
  assert.doesNotMatch(html, /<script\b| onerror="/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;/);
  assert.match(html, /href="https:\/\/example.test\/order\/ref\?x=&quot;&amp;y=1"/);
});

test('images are optional, event-only and restricted to absolute HTTPS URLs', () => {
  for (const imageUrl of ['', '/relative.jpg', 'javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.test/a.jpg', 'https://user:pass@example.test/a.jpg']) {
    const summary = buildReceiptSummary('FCC-123', {
      items: [{ name: 'Event', category: 'EVENTS', pricePence: 500, imageUrl }]
    });
    assert.doesNotMatch(receiptEmailHtml(summary, 'https://example.test/order/ref'), /<img/);
  }
  const summary = buildReceiptSummary('FCC-123', {
    items: [{ name: 'Service', category: 'SERVICES', pricePence: 500, imageUrl: 'https://example.test/a.jpg' }]
  });
  assert.doesNotMatch(receiptEmailHtml(summary, 'https://example.test/order/ref'), /<img/);
});

test('link receipt copy can omit personal details and supports older orders without images or people', () => {
  const summary = buildReceiptSummary('FCC-OLD', { items: [{ name: 'Legacy item', pricePence: 500 }], totalPence: 500 });
  const text = receiptEmailCopy(summary);
  assert.match(text, /Order reference: FCC-OLD/);
  assert.match(text, /Legacy item: £5.00/);
  assert.doesNotMatch(text, /Paid by:|Email:/);
  assert.doesNotMatch(receiptEmailHtml(summary, 'https://example.test/order/ref'), /<img/);
});

test('assignments follow line IDs, including shared family lines and repeated products', () => {
  const people = [
    { firstName: 'Sam', lastName: 'Family', lineIds: ['family', 'trip-adult'] },
    { firstName: 'Jo', lastName: 'Family', lineIds: ['family', 'trip-junior'] },
    { firstName: 'Unrelated', lastName: 'Member', lineIds: ['other'] }
  ];
  assert.deepEqual(receiptItemNames({ lineId: 'family' }, people), ['Sam Family', 'Jo Family']);
  assert.deepEqual(receiptItemNames({ id: 'same-trip', lineId: 'trip-adult' }, people), ['Sam Family']);
  assert.deepEqual(receiptItemNames({ id: 'same-trip', lineId: 'trip-junior' }, people), ['Jo Family']);
  assert.deepEqual(receiptItemNames({ lineId: 'unassigned' }, people), []);
  assert.deepEqual(receiptItemNames({}, [{ firstName: 'Legacy', lineIds: [undefined] }]), []);
});

test('link receipts expose assigned names but exclude contact details, submitted answers and legacy receipt data', () => {
  const privatePerson = {
    firstName: 'Alex', lastName: 'Member', lineIds: ['membership'], email: 'private@example.test',
    dob: '1990-02-03', address: 'Private Street', medical: 'Private medical answer',
    guardian: { email: 'guardian-private@example.test' }, emergencyContact: 'Private contact'
  };
  const linked = buildLinkedReceipt('FCC-LINK', {
    ...order, people: [privatePerson],
    items: [{ ...order.items[0], email: privatePerson.email, dob: privatePerson.dob }],
    receiptTokenHash: 'private-token-hash'
  });
  assert.deepEqual(linked.items[0].personNames, ['Alex Member']);
  assert.match(linked.copy, /Alex Member/);
  assert.doesNotMatch(linked.copy, /Paid by:|Email:/);
  for (const value of ['private@example.test', 'guardian-private@example.test', '1990-02-03',
    'Private Street', 'Private medical answer', 'Private contact', 'private-token-hash']) {
    assert.ok(!JSON.stringify(linked).includes(value), `link receipt must not expose ${value}`);
  }
  assert.ok(!('receiptTokenHash' in linked) && !('people' in linked));
});

test('old orders without assignments retain their items without inventing names', () => {
  const linked = buildLinkedReceipt('FCC-LEGACY', { totalPence: 500, items: [{ name: 'Legacy purchase', pricePence: 500 }] });
  assert.deepEqual(linked.items[0].personNames, []);
  assert.match(linked.copy, /Legacy purchase: £5.00/);
});

test('submitted DOB and other answers are not automatically added to HTML or plain-text emails', () => {
  const summary = buildReceiptSummary('FCC-PRIVATE', {
    ...order,
    people: order.people.map((person) => ({ ...person, dob: '1990-02-03', address: 'Private Street', medical: 'Private medical answer' }))
  });
  for (const content of [receiptEmailCopy(summary), receiptEmailHtml(summary, 'https://example.test/order/private')]) {
    assert.doesNotMatch(content, /1990-02-03|Private Street|Private medical answer/);
  }
});

test('configured person details appear in both email formats, escaped and in allow-list order', () => {
  const people = [{ firstName: 'Kim', lastName: 'Junior', lineIds: ['junior'], dob: '2015-04-09', phone: '07700 900123',
    address: '1 Shore Road', postcode: 'KY1 1AA', medical: '<b>Asthma</b>', guardian: { name: 'Pat Junior', relationship: 'Parent', phone: '07700 900456' },
    emergencyContact: { name: '', phone: '', relationship: '' } }];
  const items = [{ lineId: 'junior', name: 'Junior membership', category: 'MEMBERSHIP', pricePence: 1500 }];
  const summary = buildReceiptSummary('FCC-9', { email: 'payer@example.test', totalPence: 1500, people, items },
    { personFields: ['medical', 'dob', 'emergencyContact', 'guardian', 'address', 'phone', 'unknown', '__proto__'] });
  assert.deepEqual(summary.people[0].details, [
    { label: 'Date of birth', value: '09/04/2015' },
    { label: 'Phone', value: '07700 900123' },
    { label: 'Address', value: '1 Shore Road, KY1 1AA' },
    { label: 'Parent or guardian', value: 'Pat Junior (Parent), 07700 900456' },
    { label: 'Medical information', value: '<b>Asthma</b>' }
  ], 'unknown keys and empty values are dropped');
  const text = receiptEmailCopy(summary);
  assert.match(text, /Date of birth: 09\/04\/2015/);
  assert.match(text, /Parent or guardian: Pat Junior \(Parent\), 07700 900456/);
  const html = receiptEmailHtml(summary, 'https://example.test/order/FCC-9.token');
  assert.ok(html.includes('09/04/2015') && html.includes('&lt;b&gt;Asthma&lt;/b&gt;') && !html.includes('<b>Asthma'));
});

test('person details are absent by default and never reach the receipt link', () => {
  const people = [{ firstName: 'Kim', lastName: 'Junior', lineIds: ['junior'], dob: '2015-04-09', phone: '07700 900123', medical: 'Asthma' }];
  const items = [{ lineId: 'junior', name: 'Junior membership', category: 'MEMBERSHIP', pricePence: 1500 }];
  const summary = buildReceiptSummary('FCC-9', { totalPence: 1500, people, items });
  assert.equal('details' in summary.people[0], false);
  assert.ok(!receiptEmailCopy(summary).includes('2015') && !receiptEmailHtml(summary, 'https://x.test').includes('Asthma'));
  const linked = JSON.stringify(buildLinkedReceipt('FCC-9', { totalPence: 1500, people, items }));
  assert.ok(linked.includes('Kim Junior') && !linked.includes('2015') && !linked.includes('07700') && !linked.includes('Asthma'));
});

test('stored receipt field settings are filtered to the allow-list', () => {
  assert.deepEqual(normalizeReceiptPersonFields(['phone', 'dob', 'phone', 'email', 7]), ['dob', 'phone']);
  assert.deepEqual(normalizeReceiptPersonFields(undefined), []);
  assert.ok(RECEIPT_PERSON_FIELDS.every((field) => field.key && field.label && typeof field.value === 'function'));
});

test('club-year items show what was paid now and the monthly debit', () => {
  const summary = buildReceiptSummary('FCC-124', { ...order, people: [], items: [
    { lineId: 'c', name: 'Coaching', category: 'SUBSCRIPTIONS', type: 'subscription', pricePence: 1600, monthly: true, monthlyPence: 2000, debits: 3,
      clubYear: 2026, label: '80% of this month now, then monthly from 1 Nov 2026' },
    { lineId: 'm', name: 'Adult membership', category: 'MEMBERSHIP', pricePence: 2500, monthly: false, clubYear: 2027, label: 'Club year 2027/28' }
  ] });
  assert.deepEqual(summary.otherItems.map((item) => item.billing),
    ['80% of this month now, then monthly from 1 Nov 2026 at £20.00 a month', 'Club year 2027/28']);
});

test('existing members get missing receipt details from their records only when the receipt goes to their own email', () => {
  const person = { firstName: 'Jack', lastName: 'Watt', dob: '2000-08-23', existingMember: true, membershipId: 'M0001', photoConsent: false, phone: '' };
  const member = { dob: '2000-08-23', swimming: 'Confident', medical: 'Asthma', affiliationNumber: '12345', consents: { photoVideo: { accepted: true } } };
  const household = { email: 'Jack@Example.test', phone: '07000 000000', address: '1 Shore Road', postcode: 'EH1 1AA',
    emergencyContact: { name: 'Sam Watt', relationship: 'Partner', phone: '07111 111111' } };
  const filled = receiptPersonWithRecord(person, 'jack@example.test ', member, household);
  const details = buildReceiptSummary('FCC-1', { people: [filled], items: [] }, { personFields: RECEIPT_PERSON_FIELDS.map((field) => field.key) }).people[0].details;
  assert.deepEqual(details.map((detail) => detail.label), ['Date of birth', 'Phone', 'Address', 'Paddle Scotland number', 'Club membership ID',
    'Swimming ability', 'Emergency contact', 'Medical information', 'Photo consent']);
  assert.equal(details.find((detail) => detail.label === 'Address').value, '1 Shore Road, EH1 1AA');
  assert.equal(details.find((detail) => detail.label === 'Photo consent').value, 'No', 'details entered at checkout win');

  assert.equal(receiptPersonWithRecord(person, 'someone-else@example.test', member, household), person, 'another address gets only what was entered');
  assert.equal(receiptPersonWithRecord({ ...person, existingMember: false }, 'jack@example.test', member, household).phone, '');
  const junior = receiptPersonWithRecord({ ...person, junior: true, guardian: { email: 'parent@example.test' } }, 'parent@example.test', member,
    { email: 'parent@example.test', contactName: 'Pat Parent', contactRelationship: 'Parent/Guardian', phone: '07222 222222', address: '2 Shore Road' });
  assert.deepEqual(junior.guardian, { name: 'Pat Parent', relationship: 'Parent/Guardian', phone: '07222 222222', email: 'parent@example.test' });
  assert.equal(junior.address, undefined, "a junior's receipt shows the guardian rather than repeating the household address as theirs");
});

test('receipts word the joining month as a discount, including on orders saved with the older wording', () => {
  const item = { id: 'gold-sub', name: 'Gold Subscription', pricePence: 2400, monthlyPence: 3000, clubYear: 2026, monthly: true, debits: 3,
    label: 'Rest of November now (80% of a month), then £30.00 a month: 3 payments, Dec 2026 – Feb 2027' };
  const [line] = buildReceiptSummary('FCC-1', { items: [item], people: [], totalPence: 2400, billingMode: 'monthly' }).otherItems;
  assert.equal(line.billing, 'Rest of November now (20% off), then £30.00 a month: 3 payments, Dec 2026 – Feb 2027');
});

test('a credited order shows the amount received and how it was paid', () => {
  const credited = { ...order, billingMode: 'annual', payment: { method: 'bank-transfer', amountPence: 7000, reference: 'FCC' } };
  const summary = buildReceiptSummary('FCC-124', credited);
  assert.equal(summary.total, 70);
  assert.equal(summary.paymentMethod, 'Paid by bank transfer');
  assert.match(receiptEmailCopy(summary), /Total paid: £70\.00\nPaid by bank transfer/);
  assert.match(receiptEmailHtml(summary), /Paid by bank transfer/);
  const linked = buildLinkedReceipt('FCC-124', { ...credited, payment: { method: 'complimentary', amountPence: 0 } });
  assert.equal(linked.total, 0);
  assert.equal(linked.paymentMethod, 'Complimentary (no charge)');
  assert.equal('paymentMethod' in buildReceiptSummary('FCC-123', order), false);
});
