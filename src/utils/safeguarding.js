/** PVG (Protecting Vulnerable Groups) and safeguarding training records, kept on a membership as expiry dates. */
export const CHECK_TYPES = { pvg: 'PVG', safeguarding: 'Safeguarding' };
export const DUE_DAYS = 90;

export const checksManagedByJustgo = (member) => member?.justgoSyncStatus === 'synced' || Boolean(member?.lastJustgoSync)
  || Object.keys(CHECK_TYPES).some((type) => member?.checks?.[type]?.source === 'justgo');
export const CHECK_STATUS_LABELS = { none: 'Not recorded', active: 'Active', due: 'Due to expire', expired: 'Expired' };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 24 * 60 * 60 * 1000;

const parseDate = (value) => {
  const match = typeof value === 'string' && value.match(DATE);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
};

const startOfDay = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/** A check is valid through its expiry date, and "due" within DUE_DAYS of it. */
export const checkStatus = (expiresOn, now = new Date()) => {
  const expiry = parseDate(expiresOn);
  if (!expiry) return 'none';
  const daysLeft = Math.round((expiry.getTime() - startOfDay(now)) / DAY);
  if (daysLeft < 0) return 'expired';
  return daysLeft <= DUE_DAYS ? 'due' : 'active';
};

export const formatCheckDate = (expiresOn) => {
  const date = parseDate(expiresOn);
  return date ? `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}` : '';
};

/** e.g. "Due to expire (31/12/2026)", for reports and exports. */
export const checkLabel = (expiresOn, now = new Date()) => {
  const status = checkStatus(expiresOn, now);
  return status === 'none' ? CHECK_STATUS_LABELS.none : `${CHECK_STATUS_LABELS[status]} (${formatCheckDate(expiresOn)})`;
};

/** Each check's expiry date and status, from a membership's `checks` field. */
export const checkSummary = (checks = {}, now = new Date()) => Object.fromEntries(Object.keys(CHECK_TYPES).map((type) => {
  const expiresOn = parseDate(checks?.[type]?.expiresOn) ? checks[type].expiresOn : '';
  return [type, { expiresOn, status: checks?.[type]?.source === 'justgo' ? checks[type].status || 'none' : checkStatus(expiresOn, now),
    ...(checks?.[type]?.source === 'justgo' ? { source: 'justgo', label: checks[type].label || 'Not supplied by JustGo' } : {}) }];
}));

/** An admin update: one or both checks, each a YYYY-MM-DD expiry date or '' to clear it. */
export const validateCheckUpdate = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send the PVG or safeguarding expiry date.' };
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !Object.hasOwn(CHECK_TYPES, key))) return { error: 'Only PVG and safeguarding expiry dates can be saved.' };
  const value = {};
  for (const key of keys) {
    const date = body[key];
    if (date === '' || date === null) {
      value[key] = '';
      continue;
    }
    const parsed = parseDate(date);
    if (!parsed || parsed.getUTCFullYear() < 2000 || parsed.getUTCFullYear() > 2100) return { error: `Enter the ${CHECK_TYPES[key]} expiry date as a valid date.` };
    value[key] = date;
  }
  return { value };
};
