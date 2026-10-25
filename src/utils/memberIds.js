/** Permanent membership record IDs are short club numbers (M0001) that never change. */
export const MEMBER_ID_COUNTER = ['counters', 'memberships'];

export const formatMemberId = (number) => {
  if (!Number.isInteger(number) || number < 1) throw new Error('Member numbers start at 1.');
  return `M${String(number).padStart(4, '0')}`;
};

/** The Paddle Scotland membership number shown to staff once JustGo confirms the affiliation number. */
export const membershipNumberFor = (affiliationNumber) => {
  const number = String(affiliationNumber ?? '').trim();
  return /^\d{4,8}$/.test(number) ? `FCC-${number}` : '';
};

/** Reserves `count` unused IDs in one transaction. Skipped numbers (abandoned checkouts) are never reused. */
export const allocateMemberIds = async (db, count) => {
  if (!Number.isInteger(count) || count < 0 || count > 50) throw new Error('Allocate between 0 and 50 member IDs.');
  if (!count) return [];
  const counter = db.collection(MEMBER_ID_COUNTER[0]).doc(MEMBER_ID_COUNTER[1]);
  return db.runTransaction(async (transaction) => {
    let next = (await transaction.get(counter)).data()?.next || 1;
    const ids = [];
    while (ids.length < count) {
      const batch = Array.from({ length: count - ids.length }, (_, index) => formatMemberId(next + index));
      const documents = await transaction.getAll(...batch.map((id) => db.collection('memberships').doc(id)));
      ids.push(...batch.filter((id, index) => !documents[index].exists));
      next += batch.length;
    }
    transaction.set(counter, { next }, { merge: true });
    return ids;
  });
};
