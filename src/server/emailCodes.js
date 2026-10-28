import { rateLimit } from './rateLimit.js';
import {
  EMAIL_CODE_PURPOSES, canSendCode, checkCode, codeDocumentId, codeEmail, createSessionToken, generateCode, hashCode,
  isCodeEmail, nextCodeRecord, normaliseCodeEmail, sha256
} from '../utils/emailCodes.js';
import crypto from 'node:crypto';

const SENT_MESSAGE = 'If that email address can use this, we have sent a 6-digit code. It expires in 10 minutes.';
const WRONG_MESSAGE = 'That code is wrong or has expired. Request a new code if needed.';

/**
 * Email one-time codes. A feature calls `allowPurpose(purpose, eligible)`; `eligible(email, req)` decides who may receive a code; everyone gets the same reply
 * so the form never reveals which addresses we hold. A verified code becomes a short-lived session token.
 */
export const registerEmailCodeRoutes = (app, { db, sendEmail }) => {
  const eligible = {};
  const refusals = {};
  /** `refusal`, if given, is shown when the check fails; otherwise the reply never reveals whether the address is held. */
  const allowPurpose = (purpose, check, refusal = '') => {
    if (!Object.hasOwn(EMAIL_CODE_PURPOSES, purpose)) throw new Error(`Unknown email code purpose ${purpose}.`);
    eligible[purpose] = check;
    refusals[purpose] = refusal;
  };
  const codes = () => db().collection('emailCodes');
  const sessions = () => db().collection('emailSessions');

  /** Sends a code unless one was sent too recently. Returns false when throttled or the email failed. */
  const sendCode = async (purpose, email, extra = {}) => {
    const reference = codes().doc(codeDocumentId(purpose, email));
    const code = generateCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const allowed = await db().runTransaction(async (transaction) => {
      const now = Date.now();
      const record = (await transaction.get(reference)).data();
      if (!canSendCode(record, now)) return false;
      transaction.set(reference, nextCodeRecord(record, { codeHash: hashCode(code, salt), salt, now, extra }));
      return true;
    });
    if (!allowed) return false;
    const { subject, body, html } = codeEmail(code, purpose);
    const sent = await sendEmail({ to: email, subject, body, html, record: { kind: 'email-code', purpose } }).catch((error) => {
      console.error('Could not email a code:', error.message);
      return false;
    });
    if (!sent) await reference.delete();
    return Boolean(sent);
  };

  /** Checks a code, counting wrong attempts, and deletes it once used. Returns the stored record or null. */
  const consumeCode = async (purpose, email, code) => {
    const reference = codes().doc(codeDocumentId(purpose, email));
    return db().runTransaction(async (transaction) => {
      const record = (await transaction.get(reference)).data();
      const result = checkCode(record, code, Date.now());
      if (result === 'ok') { transaction.delete(reference); return record; }
      if (result === 'wrong') transaction.update(reference, { attempts: (record.attempts || 0) + 1 });
      if (result === 'expired' || result === 'locked') transaction.delete(reference);
      return null;
    });
  };

  const sessionToken = (req) => {
    const header = req.headers['x-email-session'];
    return typeof header === 'string' && /^[a-f0-9]{64}$/.test(header) ? header : '';
  };

  /** The verified email for this request's session, or null after replying 401. */
  const requireEmailSession = async (req, res, purpose) => {
    const token = sessionToken(req);
    const session = token ? (await sessions().doc(sha256(token)).get()).data() : null;
    if (!session || session.purpose !== purpose || session.expiresAt <= Date.now()) {
      res.status(401).json({ error: 'Your code session has ended. Request a new email code.', sessionExpired: true });
      return null;
    }
    return { email: session.email, expiresAt: session.expiresAt };
  };

  const endSession = async (req) => {
    const token = sessionToken(req);
    if (token) await sessions().doc(sha256(token)).delete();
  };

  app.post('/api/email-codes', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Email codes are not available right now.' });
      const email = normaliseCodeEmail(req.body?.email);
      const purpose = req.body?.purpose;
      if (!isCodeEmail(email) || !Object.hasOwn(eligible, purpose)) return res.status(400).json({ error: 'Enter a valid email address.' });
      res.set('Cache-Control', 'no-store');
      const allowed = await eligible[purpose](email, req);
      if (!allowed && refusals[purpose]) return res.status(404).json({ error: refusals[purpose], notFound: true });
      if (allowed) await sendCode(purpose, email);
      res.json({ success: true, message: SENT_MESSAGE });
    } catch (error) {
      console.error('Could not send email code:', error.message);
      res.status(500).json({ error: 'Could not send a code. Please try again later.' });
    }
  });

  app.post('/api/email-codes/verify', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Email codes are not available right now.' });
      const email = normaliseCodeEmail(req.body?.email);
      const purpose = req.body?.purpose;
      if (!isCodeEmail(email) || !Object.hasOwn(eligible, purpose)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (!await consumeCode(purpose, email, String(req.body?.code || '').trim())) return res.status(400).json({ error: WRONG_MESSAGE });
      // Eligibility is checked again: a volunteer could have been deactivated since the code was sent.
      if (!await eligible[purpose](email, req)) return res.status(403).json({ error: refusals[purpose] || 'This email address cannot use this any more.' });
      const token = createSessionToken();
      const expiresAt = Date.now() + EMAIL_CODE_PURPOSES[purpose].sessionMs;
      await sessions().doc(sha256(token)).set({ email, purpose, expiresAt, createdAt: Date.now() });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, token, email, expiresAt });
    } catch (error) {
      console.error('Could not verify email code:', error.message);
      res.status(500).json({ error: 'Could not check the code. Please try again.' });
    }
  });

  app.delete('/api/email-codes/session', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      if (db()) await endSession(req);
      res.json({ success: true });
    } catch (error) {
      console.error('Could not end email session:', error.message);
      res.status(500).json({ error: 'Could not sign out.' });
    }
  });

  return { allowPurpose, sendCode, consumeCode, requireEmailSession };
};

export { WRONG_MESSAGE as EMAIL_CODE_WRONG_MESSAGE };
