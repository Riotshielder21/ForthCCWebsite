import { resolvedOrderPerson } from '../utils/orders.js';

const readAll = async (db, collection, ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const documents = await db.getAll(...unique.map((id) => db.collection(collection).doc(id)));
  return new Map(documents.filter((document) => document.exists).map((document) => [document.id, document.data()]));
};

/**
 * Fills in the people on one order or a list of orders from their member and household records, since a recorded order keeps
 * only references. Returns copies in the same shape as given; erased or missing records resolve to a neutral placeholder.
 */
export const resolveOrderPeople = async (db, orders) => {
  const list = Array.isArray(orders) ? orders : [orders];
  const needed = list.flatMap((order) => (order?.people || []).filter((person) => !person.firstName && !person.lastName && !person.erased));
  const members = await readAll(db, 'memberships', needed.map((person) => person.membershipId));
  const households = await readAll(db, 'households', needed.map((person) => members.get(person.membershipId)?.householdId || person.householdId));
  const resolved = list.map((order) => order && Array.isArray(order.people) ? {
    ...order,
    people: order.people.map((person) => {
      const member = members.get(person.membershipId);
      return resolvedOrderPerson(person, member, households.get(member?.householdId || person.householdId) || {});
    })
  } : order);
  return Array.isArray(orders) ? resolved : resolved[0];
};
