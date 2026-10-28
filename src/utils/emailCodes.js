import crypto from 'node:crypto';

/** One-time email codes: what each purpose may do and for how long a verified session lasts. */
export const EMAIL_CODE_PURPOSES = {
  details: { sessionMs: 30 * 60 * 1000 },
  volunteer: { sessionMs: 12 * 60 * 60 * 1000 },
  'email-change': { sessionMs: 0 }
};
export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_AFTER_MS = 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5;

const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export const normaliseCodeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const isCodeEmail = (email) => email.length <= 254 && EMAIL.test(email);
export const isCodePurpose = (purpose) => Object.hasOwn(EMAIL_CODE_PURPOSES, purpose);

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const codeDocumentId = (purpose, email) => sha256(`${purpose}|${email}`);
export const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
export const hashCode = (code, salt) => sha256(`${salt}|${code}`);
export const createSessionToken = () => crypto.randomBytes(32).toString('hex');

/** Whether another code may be sent now, given the stored code record. */
export const canSendCode = (record, now) => {
  if (!record) return true;
  const sentAt = record.sentAt || 0;
  if (now - sentAt < RESEND_AFTER_MS) return false;
  const windowStart = record.windowStart || 0;
  return now - windowStart >= 60 * 60 * 1000 || (record.sendCount || 0) < MAX_CODES_PER_HOUR;
};

/** The next stored record after sending a code; the hourly count restarts after an hour. */
export const nextCodeRecord = (record, { codeHash, salt, now, extra = {} }) => {
  const sameWindow = record && now - (record.windowStart || 0) < 60 * 60 * 1000;
  return {
    codeHash, salt, sentAt: now, expiresAt: now + CODE_TTL_MS, attempts: 0,
    windowStart: sameWindow ? record.windowStart : now, sendCount: sameWindow ? (record.sendCount || 0) + 1 : 1, ...extra
  };
};

/** `ok`, or why the entered code cannot be accepted. Comparison is constant-time. */
export const checkCode = (record, code, now) => {
  if (!record?.codeHash) return 'missing';
  if (record.expiresAt <= now) return 'expired';
  if ((record.attempts || 0) >= MAX_CODE_ATTEMPTS) return 'locked';
  if (!/^\d{6}$/.test(String(code || ''))) return 'wrong';
  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hashCode(String(code), record.salt), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) ? 'ok' : 'wrong';
};

export const codeEmail = (code, purpose) => {
  const reason = purpose === 'volunteer' ? 'sign in to club-night check-in'
    : purpose === 'email-change' ? 'confirm this new contact email address' : 'view or update your Forth Canoe Club details';
  const intro = `Your code to ${reason} is ${code}.`;
  const expiry = 'It expires in 10 minutes. If you did not ask for it, you can ignore this email.';
  const htmlIntro = intro.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  return {
    subject: `Your Forth Canoe Club code: ${code}`,
    body: `${intro}\n\n${expiry}`,
    html: `<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#002147"><p>${htmlIntro}</p><p>${expiry}</p></body></html>`
  };
};
