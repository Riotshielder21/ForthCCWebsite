export const RECORD_ID_TYPES = {
  memberships: { collection: 'memberships', prefix: 'M', digits: 4 },
  households: { collection: 'households', prefix: 'H', digits: 5 },
  products: { collection: 'products', prefix: 'P', digits: 5 },
  forms: { collection: 'forms', prefix: 'F', digits: 5 },
  formSubmissions: { collection: 'formSubmissions', prefix: 'R', digits: 5 },
  volunteers: { collection: 'lists', prefix: 'V', digits: 5 },
  lists: { collection: 'lists', prefix: 'L', digits: 5 }
};

export const formatRecordId = (type, number) => {
  const settings = RECORD_ID_TYPES[type];
  if (!settings) throw new Error(`Unknown record ID type: ${type}.`);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Record numbers start at 1.');
  return `${settings.prefix}${String(number).padStart(settings.digits, '0')}`;
};

/** Read reservations before other transaction writes, then save the counter after all reads. */
export const reserveRecordIds = async (db, transaction, type, count = 1) => {
  const settings = RECORD_ID_TYPES[type];
  if (!settings) throw new Error(`Unknown record ID type: ${type}.`);
  if (!Number.isInteger(count) || count < 0 || count > 50) throw new Error('Allocate between 0 and 50 record IDs.');
  if (!count) return { ids: [], save: () => {} };
  const counter = db.collection('counters').doc(type);
  const stored = (await transaction.get(counter)).data()?.next;
  let next = stored === undefined ? 1 : stored;
  if (!Number.isSafeInteger(next) || next < 1) throw new Error(`Invalid ${type} ID counter.`);
  const ids = [];
  while (ids.length < count) {
    const candidates = Array.from({ length: count - ids.length }, (_, index) => formatRecordId(type, next + index));
    const documents = await transaction.getAll(...candidates.map((id) => db.collection(settings.collection).doc(id)));
    ids.push(...candidates.filter((id, index) => !documents[index].exists));
    next += candidates.length;
  }
  if (!Number.isSafeInteger(next)) throw new Error(`The ${type} ID counter is exhausted.`);
  return { ids, save: () => transaction.set(counter, { next }, { merge: true }) };
};

/** Reservations are never reused, even if a checkout or subsequent write is abandoned. */
export const allocateRecordIds = (db, type, count = 1) => db.runTransaction(async (transaction) => {
  const reservation = await reserveRecordIds(db, transaction, type, count);
  reservation.save();
  return reservation.ids;
});
