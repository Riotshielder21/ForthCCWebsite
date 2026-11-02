import { orderVersion2 } from './orders.js';

/**
 * Versioned upgrades for stored records. Each step moves a document from the version before `to` to `to`; a document without
 * `schemaVersion` is version 1. Steps return only what changes, so the same code serves the dry run and the real run.
 */
export const MEMBERSHIP_MIGRATIONS = [
  {
    to: 2,
    description: 'Rename scaNumber / scaId to affiliationNumber',
    upgrade: (fields) => {
      const affiliationNumber = String(fields.affiliationNumber || fields.scaNumber || fields.scaId || '').trim();
      return { set: affiliationNumber ? { affiliationNumber } : {}, remove: ['scaNumber', 'scaId'].filter((key) => key in fields) };
    }
  },
  {
    to: 3,
    description: 'Move contact and household details to households',
    upgrade: (fields) => {
      const consents = fields.consents && typeof fields.consents === 'object' ? fields.consents : {};
      const set = fields.photoConsent === true && !consents.photoVideo
        ? { consents: { ...consents, photoVideo: { accepted: true, legacyUnversioned: true, recordedAt: null, by: fields.junior ? 'guardian' : 'self' } } }
        : {};
      return {
        set,
        remove: ['email', 'phone', 'address', 'postcode', 'guardian', 'emergencyContact', 'emergencyNote', 'photoConsent',
          'familyGroup', 'junior', 'returning', 'disclaimerAccepted'].filter((key) => key in fields)
      };
    }
  },
  {
    to: 4,
    // scripts/migrate-schema.js writes the terms (legacyTerms in membershipTerms.js) in the same batch before these go.
    description: 'Move privileges and purchase history to membershipTerms and orders',
    upgrade: (fields) => ({ set: {}, remove: ['privileges', 'history'].filter((key) => key in fields) })
  }
];

export const CURRENT_MEMBERSHIP_VERSION = MEMBERSHIP_MIGRATIONS.at(-1).to;

export const ORDER_MIGRATIONS = [
  {
    to: 2,
    description: 'Store money in pence, one receipt token, grouped Stripe/fulfilment/failure fields and recorded people as references',
    upgrade: orderVersion2
  }
];

export const CURRENT_ORDER_VERSION = ORDER_MIGRATIONS.at(-1).to;

/** What bringing one record up to the current version would change, or null when it already is. */
export const planUpgrade = (fields, migrations = MEMBERSHIP_MIGRATIONS) => {
  const from = Number(fields.schemaVersion) || 1;
  const steps = migrations.filter((migration) => migration.to > from);
  if (!steps.length) return null;
  const working = { ...fields };
  const set = {};
  const remove = new Set();
  for (const step of steps) {
    const change = step.upgrade(working);
    Object.assign(working, change.set);
    Object.assign(set, change.set);
    change.remove.forEach((key) => { delete working[key]; remove.add(key); });
  }
  const toVersion = steps.at(-1).to;
  for (const key of Object.keys(set)) remove.delete(key);
  return { from, to: toVersion, set: { ...set, schemaVersion: toVersion }, remove: [...remove], descriptions: steps.map((step) => step.description) };
};
