import { justgoSyncHealth } from '../utils/membership.js';

/** Whether the weekly JustGo sync is still completing runs. A read failure counts as unknown (not healthy). */
export const readJustgoSync = async (db, now = new Date()) => {
  try {
    return justgoSyncHealth((await db.collection('settings').doc('justgoSync').get()).data(), now);
  } catch (error) {
    console.error('Could not read JustGo sync status:', error.message);
    return justgoSyncHealth(null, now);
  }
};
