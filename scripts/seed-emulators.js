import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';
import { PRODUCTS } from '../src/constants/products.js';
import { clubYearDates, clubYearOf } from '../src/utils/clubYear.js';

const projectId = assertLocalFirebase(process.env);
initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const uid = 'local-club-admin';
try {
  await auth.getUser(uid);
  await auth.updateUser(uid, { password: 'local-test-password' });
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error;
  await auth.createUser({ uid, email: 'admin@forthcanoeclub.co.uk', password: 'local-test-password', emailVerified: true });
}
await auth.setCustomUserClaims(uid, { admin: true });
const batch = db.batch();
for (const product of PRODUCTS) {
  const { id, ...fields } = product;
  batch.set(db.collection('products').doc(id), fields);
}
const inYear = (year) => Timestamp.fromDate(new Date(`${year}-03-01T00:00:00Z`));
const household = (id, fields) => batch.set(db.collection('households').doc(id), {
  contactName: '', contactRelationship: '', email: '', phone: '', address: '', postcode: '',
  emergencyContact: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...fields
});
household('TEST-HH-CURRENT', {
  contactName: 'Pat Current', contactRelationship: 'Self', email: 'member@example.com', phone: '07700 900111',
  address: '1 River Road', postcode: 'EH1 1AA',
  emergencyContact: { name: 'Alex Friend', phone: '07700 900222', relationship: 'Friend' }
});
household('TEST-HH-FAMILY', {
  contactName: 'Morgan Example', contactRelationship: 'Parent', email: 'family@example.test', phone: '07700 900333',
  address: '2 Family Road', postcode: 'EH2 2BB',
  emergencyContact: { name: 'Taylor Neighbour', phone: '07700 900444', relationship: 'Neighbour' }
});
household('TEST-HH-SIBLINGS', {
  contactName: 'Riley Guardian', contactRelationship: 'Guardian', email: 'siblings@example.test', phone: '07700 900555',
  address: '3 Sibling Street', postcode: 'EH3 3CC'
});
household('TEST-HH-SEPARATE', {
  contactName: 'Casey Guardian', contactRelationship: 'Guardian', email: 'separate@example.test', phone: '07700 900666',
  address: '4 Separate Street', postcode: 'EH4 4DD',
  emergencyContact: { name: 'Taylor Neighbour', phone: '07700 900444', relationship: 'Neighbour' }
});
const member = (id, fields) => batch.set(db.collection('memberships').doc(id), {
  status: 'active', validUntil: inYear(2099), source: 'website', membershipTier: 'adult',
  updatedAt: Timestamp.now(), ...fields
});
member('test-current', {
  firstName: 'Test', lastName: 'Current', searchName: 'test current', affiliationNumber: 'TEST-1',
  householdId: 'TEST-HH-CURRENT', source: 'justgo', justgoSyncStatus: 'synced', renewalMethod: 'justgo', lastJustgoSync: Timestamp.now()
});
member('test-expired', {
  firstName: 'Test', lastName: 'Expired', searchName: 'test expired', affiliationNumber: 'TEST-2',
  status: 'active', validUntil: inYear(2020), source: 'justgo', justgoSyncStatus: 'synced'
});
member('test-family-parent', {
  firstName: 'Morgan', lastName: 'Example', dob: '1987-04-12', membershipTier: 'adult', householdId: 'TEST-HH-FAMILY'
});
member('test-family-child', {
  firstName: 'Jamie', lastName: 'Example', dob: '2014-06-09', membershipTier: 'junior', householdId: 'TEST-HH-FAMILY'
});
member('test-sibling-one', {
  firstName: 'Alex', lastName: 'Guardian', dob: '2013-05-11', membershipTier: 'junior', householdId: 'TEST-HH-SIBLINGS'
});
member('test-sibling-two', {
  firstName: 'Sam', lastName: 'Guardian', dob: '2016-08-20', membershipTier: 'junior', householdId: 'TEST-HH-SIBLINGS'
});
member('test-separate-junior', {
  firstName: 'Jordan', lastName: 'Separate', dob: '2012-02-02', membershipTier: 'junior', householdId: 'TEST-HH-SEPARATE'
});
// A website family whose cover ends with this club year, for testing renewal emails and links.
const thisClubYear = clubYearOf();
household('TEST-HH-RENEWAL', {
  contactName: 'Rowan Renewal', contactRelationship: 'Self', email: 'renewal@example.test', phone: '07700 900999',
  address: '5 Renewal Row', postcode: 'EH5 5EE'
});
for (const [id, fields] of Object.entries({
  'test-renewal-parent': { firstName: 'Rowan', lastName: 'Renewal', dob: '1985-09-03',
    privileges: [{ productId: 'keyhire', name: 'Boathouse Access', type: 'yearly-service', orderRef: 'TEST-RENEWAL', grantedAt: Timestamp.now(), clubYear: thisClubYear }] },
  'test-renewal-child': { firstName: 'Robin', lastName: 'Renewal', dob: '2015-04-21' }
})) {
  member(id, { ...fields, searchName: `${fields.firstName} ${fields.lastName}`.toLowerCase(), membershipTier: 'family', householdId: 'TEST-HH-RENEWAL',
    renewalMethod: 'website', clubYears: [thisClubYear], validUntil: Timestamp.fromDate(clubYearDates(thisClubYear).end) });
}
const course = {
  name: 'Week-long paddling course', category: 'EVENTS', type: 'event-ticket', basePrice: 120,
  capacity: 12, hasAnnualDiscount: false,
  eventSchedule: { mode: 'consecutive', startDate: '2027-07-12', startTime: '09:00', endTime: '16:00', days: 5, timeZone: 'Europe/London' }
};
batch.set(db.collection('products').doc('test-week-course'), course);
batch.set(db.collection('products').doc('test-shirt'), {
  name: 'Test club shirt', category: 'MERCHANDISE', type: 'merchandise', basePrice: 20,
  variants: [{ size: 'S', stock: 4 }, { size: 'M', stock: 3 }, { size: 'L', stock: 2 }]
});
for (const [id, fields] of Object.entries({
  'TEST-MEMBERSHIP': {
    email: 'member@example.com', status: 'paid', total: '30',
    items: [{ lineId: 'adult-membership', id: 'membership-adult', name: 'Adult membership', category: 'MEMBERSHIP', type: 'annual-oneoff', price: 30 }],
    people: [{ firstName: 'Test', lastName: 'Current', dob: '1991-03-14', lineIds: ['adult-membership'], membershipId: 'test-current', existingMember: true }]
  },
  'TEST-SUBSCRIPTION': {
    email: 'subscriber@example.test', status: 'paid', total: '25', stripeSubscriptionId: 'sub_local_test',
    items: [{ lineId: 'blue-sub', id: 'blue-sub', name: 'Blue subscription', category: 'SUBSCRIPTIONS', type: 'subscription', price: 25 }],
    people: [{ firstName: 'Robin', lastName: 'Subscriber', dob: '1993-10-04', lineIds: ['blue-sub'], phone: '07700 900777', email: 'subscriber@example.test' }]
  },
  'TEST-PENDING': {
    email: 'pending@example.test', status: 'pending', total: '85',
    items: [{ lineId: 'boat-hire', id: 'boat-hire', name: 'Kit hire', category: 'SERVICES', type: 'yearly-service', price: 85 }],
    people: [{ firstName: 'Avery', lastName: 'Pending', dob: '1989-01-24', lineIds: ['boat-hire'] }]
  },
  'TEST-FAMILY-COURSE': {
    email: 'family@example.test', status: 'paid', total: '240',
    items: [
      { lineId: 'course-one', id: 'test-week-course', name: course.name, category: 'EVENTS', type: course.type, price: 120, eventSchedule: course.eventSchedule },
      { lineId: 'course-two', id: 'test-week-course', name: course.name, category: 'EVENTS', type: course.type, price: 120, eventSchedule: course.eventSchedule }
    ],
    people: [
      { firstName: 'Morgan', lastName: 'Example', dob: '1987-04-12', lineIds: ['course-one'], membershipId: 'test-family-parent', medical: 'None', swimming: 'confident', photoConsent: true },
      { firstName: 'Jamie', lastName: 'Example', dob: '2014-06-09', junior: true, lineIds: ['course-two'], membershipId: 'test-family-child', medical: 'None', swimming: 'basic', photoConsent: false }
    ]
  },
  'TEST-MIXED-CART': {
    email: 'mix@example.test', status: 'paid', total: '50',
    items: [
      { lineId: 'tee-s', id: 'test-shirt', name: 'Test club shirt', category: 'MERCHANDISE', type: 'merchandise', price: 20, size: 'S' },
      { lineId: 'tee-m', id: 'test-shirt', name: 'Test club shirt', category: 'MERCHANDISE', type: 'merchandise', price: 20, size: 'M' },
      { lineId: 'course', id: 'test-week-course', name: course.name, category: 'EVENTS', type: course.type, price: 10, eventSchedule: course.eventSchedule }
    ],
    people: [{ firstName: 'Quinn', lastName: 'Mixed', dob: '1995-12-02', lineIds: ['course'], phone: '07700 900888', email: 'mix@example.test', swimming: 'basic', medical: 'None', photoConsent: true }]
  },
  'TEST-VOUCHER': {
    email: 'gift@example.test', status: 'paid', total: '60',
    items: [{ lineId: 'voucher', id: 'vouchers', name: 'Course place voucher', category: 'VOUCHERS', type: 'voucher', price: 60 }],
    people: []
  }
})) batch.set(db.collection('orders').doc(id), { ...fields, createdAt: Timestamp.now() });
for (const product of PRODUCTS.filter((item) => item.type !== 'external')) {
  const lineId = `${product.id}-individual`;
  const item = {
    lineId, id: product.id, name: product.name, category: product.category, type: product.type,
    price: product.basePrice
  };
  let people = [];
  if (product.membershipTier === 'junior') {
    people = [{
      firstName: 'Harper', lastName: 'Junior', dob: '2013-05-08', junior: true, lineIds: [lineId],
      guardian: { name: 'Harper Parent', relationship: 'Parent', email: 'harper-parent@example.test', phone: '07700 900999', address: '5 Parent Road', postcode: 'EH5 5EE' },
      swimming: 'basic', medical: 'None', disclaimerAccepted: true, photoConsent: false
    }];
  } else if (product.membershipTier === 'family') {
    people = [
      { firstName: 'Devon', lastName: 'Family', dob: '1986-07-16', lineIds: [lineId], email: 'devon-family@example.test', phone: '07700 901111', address: '6 Family Road', postcode: 'EH6 6FF', emergencyContact: { name: 'Family Friend', phone: '07700 901222', relationship: 'Friend' }, swimming: 'confident', medical: 'None', disclaimerAccepted: true, photoConsent: true },
      { firstName: 'Rowan', lastName: 'Family', dob: '2012-09-21', junior: true, lineIds: [lineId], swimming: 'basic', medical: 'None', disclaimerAccepted: true, photoConsent: false },
      { firstName: 'Sky', lastName: 'Family', dob: '2015-01-30', junior: true, lineIds: [lineId], swimming: 'basic', medical: 'None', disclaimerAccepted: true, photoConsent: true }
    ];
  } else if (product.type !== 'voucher') {
    people = [{
      firstName: 'Harper', lastName: 'Example', dob: '1992-06-15', lineIds: [lineId],
      email: 'harper-example@example.test', phone: '07700 901333', address: '7 Example Street', postcode: 'EH7 7GG',
      emergencyContact: { name: 'Morgan Contact', phone: '07700 901444', relationship: 'Friend' },
      swimming: 'confident', medical: 'None', disclaimerAccepted: true, photoConsent: true
    }];
  }
  batch.set(db.collection('orders').doc(`TEST-ITEM-${product.id.toUpperCase()}`), {
    email: people[0]?.email || 'shop-test@example.test', status: 'paid', total: String(product.basePrice),
    items: [item], people, createdAt: Timestamp.now()
  });
}
// One example of every volunteering-page list, plus volunteer sign-ups in each induction state for the admin panel.
const listEntry = (id, fields) => batch.set(db.collection('lists').doc(id), { status: 'pending', notes: '', createdAt: Timestamp.now(), ...fields });
listEntry('TEST-LIST-EQUIPMENT', { name: 'Harper Example', email: 'harper-example@example.test', listType: 'Equipment Needed',
  items: ['What equipment do you need?: 2 paddles, 1 buoyancy aid', 'What date do you need it by?: 14 March'] });
listEntry('TEST-LIST-EVENT', { name: 'Harper Example', email: 'harper-example@example.test', listType: 'Event Participants',
  items: ['Which event?: Loch Lomond paddle', 'How many people are attending?: 3'] });
listEntry('TEST-LIST-MAINTENANCE', { name: 'Morgan Contact', email: 'morgan-contact@example.test', listType: 'Maintenance Tasks',
  items: ['What needs doing?: Fix the boat rack', 'Where is it?: boathouse'] });
listEntry('TEST-LIST-OTHER', { name: 'Morgan Contact', email: 'morgan-contact@example.test', listType: 'Other',
  items: ['Tell us what you would like to add: A night paddle'], notes: 'Happy to help organise' });
listEntry('TEST-VOLUNTEER-MEMBER', { name: 'Test Current', email: 'member@example.com', listType: 'Volunteer Sign-ups', memberId: 'test-current',
  inducted: false, discountCode: null, items: ['Which activities would you like to help with?: coaching', 'When are you available?: Thursday evenings'] });
listEntry('TEST-VOLUNTEER-NONMEMBER', { name: 'Vic Visitor', email: 'vic-visitor@example.test', listType: 'Volunteer Sign-ups', memberId: null,
  inducted: true, discountCode: null, items: ['Which activities would you like to help with?: events', 'When are you available?: weekends'] });
await batch.commit();
console.log('Seeded local demo products, households, members, mixed baskets, course attendees, list submissions and test admin. No production services contacted.');