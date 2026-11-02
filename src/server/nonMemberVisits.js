import { nonMemberCheckinVisits, nonMemberEventVisits } from '../utils/visits.js';

const chunks = (values, size = 30) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

/**
 * Each person's visit history: `visits` maps a membership id to their visits as a non-member in the club year (check-ins
 * made while not an active member plus paid tickets for events open to non-members, one per event); `checkedIn` holds the
 * ids of everyone who has ever checked in to club night or another check-in session. `products` is the catalogue.
 */
export const loadVisitHistory = async (db, membershipIds, products, clubYear) => {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  const checkins = new Map(ids.map((id) => [id, []]));
  const orders = new Map();
  for (const group of chunks(ids)) {
    const [checkinSnapshot, orderSnapshot] = await Promise.all([
      db.collection('clubNightCheckins').where('memberId', 'in', group).get(),
      db.collection('orders').where('membershipIds', 'array-contains-any', group).get()
    ]);
    for (const document of checkinSnapshot.docs) checkins.get(document.data().memberId)?.push(document.data());
    for (const document of orderSnapshot.docs) orders.set(document.id, document.data());
  }
  const orderList = [...orders.values()];
  return {
    visits: new Map(ids.map((id) => [id,
      nonMemberCheckinVisits(checkins.get(id), clubYear) + nonMemberEventVisits(orderList, id, products, clubYear)])),
    checkedIn: new Set(ids.filter((id) => checkins.get(id).length > 0))
  };
};

export const loadNonMemberVisits = async (db, membershipIds, products, clubYear) =>
  (await loadVisitHistory(db, membershipIds, products, clubYear)).visits;
