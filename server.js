import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { domainToASCII } from 'url';
import compression from 'compression';
import cors from 'cors';
import { google } from 'googleapis';
import fs from 'fs';
import crypto from 'crypto';
import { cert, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { PAGE_CONTENT } from './src/constants/pageContent.js';
import { validateTileLayout, validateSupporterTiles } from './src/utils/pageTiles.js';
import { PRODUCTS } from './src/constants/products.js';
import { calculateCart } from './src/utils/pricing.js';
import { sanitizePerson, validateCheckout, peopleNeedingMembership, contactEmail, isMembership, resolvedKind, withFamilyContacts, normaliseName, matchMembership, DISCLAIMER_VERSION } from './src/utils/checkout.js';
import { membershipActivity, renewalConfirmationOpen } from './src/utils/membership.js';
import { orderReport, membershipReport, subscriptionWarning } from './src/utils/adminReports.js';
import { FieldPath } from 'firebase-admin/firestore';
import { assertLocalFirebase } from './src/utils/localFirebase.js';
import { loadStripeSubscribers, importStripeSubscribers, nextClubYearEnd, scheduleClubYearCancellation } from './src/utils/stripeReports.js';
import { resolveCatalogue, validateEventSchedule, eventScheduleLabel } from './src/utils/catalogue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const requestWindows = new Map();
const rateLimit = (limit, windowMs) => (req, res, next) => {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const recent = (requestWindows.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  recent.push(now);
  requestWindows.set(key, recent);
  next();
};

const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const isValidEmail = (value) => {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, inputDomain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const domain = domainToASCII(inputDomain);
  if (!domain || domain.length > 253) return false;
  const labels = domain.split('.');
  return labels.length > 1 && labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
};

// Middleware
app.use(compression());
app.use(cors());
app.use(express.static('dist'));

const stripeRequest = async (path, params) => {
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  if (!secretKey.startsWith('sk_test_')) {
    throw new Error('Stripe checkout requires a test-mode secret key. Live payments are disabled.');
  }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Stripe request failed.');
  return data;
};

const customerId = (email) => crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');

const clubYearEnd = () => {
  const now = new Date();
  return new Date(now.getMonth() >= 2 ? now.getFullYear() + 1 : now.getFullYear(), 2, 1);
};

// Returns the person's existing membership, or a conflict when the details contradict a record.
const toMembershipRecord = (document) => {
  const data = document.data();
  return {
    id: document.id, scaNumber: data.scaNumber || '', email: data.email || '', dob: data.dob || '',
    firstName: data.firstName || '', lastName: data.lastName || '', status: data.status, validUntil: data.validUntil?.toMillis() || 0,
    justgo: data.justgoSyncStatus === 'synced' || data.renewalMethod === 'justgo',
    renewalMethod: data.renewalMethod || '', justgoSyncStatus: data.justgoSyncStatus || '', lastJustgoSync: data.lastJustgoSync?.toMillis() || 0
  };
};

const findMembership = async (person) => {
  const memberships = adminDb.collection('memberships');
  const [byNumber, byEmail] = await Promise.all([
    person.scaNumber ? memberships.where('scaNumber', '==', person.scaNumber).limit(5).get() : null,
    memberships.where('email', '==', contactEmail(person)).limit(50).get()
  ]);
  const result = matchMembership(person, { byNumber: byNumber?.docs.map(toMembershipRecord) || [], byEmail: byEmail.docs.map(toMembershipRecord) });
  const match = result.match;
  return {
    conflict: result.conflict, reason: result.reason,
    existing: match ? { id: match.id, active: membershipActivity(match) === 'active', awaitingRenewal: membershipActivity(match) === 'awaiting-renewal', justgo: match.justgo, validUntil: match.validUntil } : null
  };
};

const verifyMemberByName = async (name) => {
  if (!adminDb) return { verified: false };
  const snapshot = await adminDb.collection('memberships').where('searchName', '==', normaliseName(name)).limit(5).get();
  const current = snapshot.docs.map(toMembershipRecord).find((member) => membershipActivity(member) === 'active');
  return { verified: Boolean(current) };
};

const recordPurchase = (transaction, { orderRef, order, vouchers, paidAt }) => {
  const validUntil = Timestamp.fromDate(clubYearEnd());
  const membershipIds = [];
  for (const person of order.people || []) {
    const lines = person.lineIds.map((id) => order.items.find((item) => item.lineId === id)).filter(Boolean);
    const membershipLine = lines.find(isMembership);
    // Event tickets stay in the purchase history; privileges are ongoing entitlements.
    const privileges = lines.filter((item) => !isMembership(item) && item.category !== 'EVENTS')
      .map((item) => ({ productId: item.id, name: item.name, type: item.type, orderRef, grantedAt: paidAt }));
    const historyEntry = { orderRef, paidAt, items: lines.map((item) => ({ id: item.id, name: item.name, price: item.price })) };
    const { id, lineIds, membershipId, existingMember, ...details } = person;
    membershipIds.push(membershipId);
    transaction.set(adminDb.collection('memberships').doc(membershipId), {
      ...(existingMember ? {} : {
        ...details, email: contactEmail(person), source: 'website', renewalMethod: 'website', createdAt: paidAt, searchName: normaliseName(`${person.firstName} ${person.lastName}`),
        ...(person.junior ? { phone: person.guardian.phone, address: person.guardian.address, postcode: person.guardian.postcode } : {}),
        disclaimerVersion: order.disclaimerVersion, disclaimerAcceptedAt: paidAt
      }),
      ...(membershipLine ? { status: 'active', validUntil, membershipTier: membershipLine.membershipTier || '', justgoSyncStatus: 'pending', renewalMethod: 'website', justgoUpload: { status: 'queued', attempts: 0, failures: 0, needsStaff: false, mode: (person.scaNumber || existingMember) ? 'invite' : 'new', nextAttemptAt: paidAt, queuedAt: paidAt } } : {}),
      ...(privileges.length ? { privileges: FieldValue.arrayUnion(...privileges) } : {}),
      history: FieldValue.arrayUnion(historyEntry),
      updatedAt: paidAt
    }, { merge: true });
  }
  transaction.set(adminDb.collection('customers').doc(customerId(order.email)), {
    email: order.email, updatedAt: paidAt, orderRefs: FieldValue.arrayUnion(orderRef),
    ...(membershipIds.length ? { membershipIds: FieldValue.arrayUnion(...membershipIds) } : {}),
    ...(vouchers.length ? { vouchers: FieldValue.arrayUnion(...vouchers.map((voucher) => ({
      code: voucher.code, name: voucher.name, value: voucher.value, orderRef, expiresAt: voucher.expiresAt
    }))) } : {})
  }, { merge: true });
};

const createFirestoreOrder = async ({ orderRef, email, items, total, status, stripeSessionId = '', discountCodeId = null, people = [] }) => {
  if (!adminDb) throw new Error('Firebase Admin SDK is not configured.');
  await adminDb.collection('orders').doc(orderRef).create({
    email: email.toLowerCase(),
    items,
    people,
    disclaimerVersion: DISCLAIMER_VERSION,
    total: String(total),
    status,
    stripeSessionId,
    discountCodeId,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + ORDER_ACCESS_DAYS * 24 * 60 * 60 * 1000))
  });
};
const updateFirestoreOrder = async (orderRef, fields) => {
  if (!adminDb) throw new Error('Firebase Admin SDK is not configured.');
  await adminDb.collection('orders').doc(orderRef).update(fields);
};

app.post('/api/stripe/webhook', rateLimit(100, 60 * 1000), express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) return res.status(400).send('Webhook is not configured.');
    const timestamp = signature.match(/t=(\d+)/)?.[1];
    const receivedSignature = signature.match(/v1=([^,]+)/)?.[1];
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return res.status(400).send('Expired webhook.');
    }
    const signedPayload = `${timestamp}.${req.body.toString()}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    if (!receivedSignature || expectedSignature.length !== receivedSignature.length || !crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(receivedSignature))) {
      return res.status(400).send('Invalid webhook signature.');
    }

    const event = JSON.parse(req.body.toString());
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const session = event.data.object;
      if (!['paid', 'no_payment_required'].includes(session.payment_status)) return res.json({ received: true });
      const orderRef = session.metadata?.order_ref;
      if (!orderRef || !adminDb) return res.status(400).send('Order metadata is missing.');
      const accessToken = createAccessToken();
      const fields = await adminDb.runTransaction(async (transaction) => {
        const orderDocument = adminDb.collection('orders').doc(orderRef);
        const document = await transaction.get(orderDocument);
        if (!document.exists) throw new Error('Order not found.');
        const order = document.data();
        if (order.stripeSessionId !== session.id || Math.round(Number(order.total) * 100) !== session.amount_total) {
          throw new Error('Payment does not match the order.');
        }
        if (order.emailSent === true) return null;
        if (order.emailSendingUntil?.toMillis() > Date.now()) throw new Error('Receipt delivery is already in progress.');
        const discountDocument = order.discountCodeId ? adminDb.collection('discountCodes').doc(order.discountCodeId) : null;
        const discount = discountDocument ? (await transaction.get(discountDocument)).data() : null;
        if (discount?.singleUse && discount.used && discount.usedByOrder !== orderRef) throw new Error('Voucher has already been redeemed.');
        const vouchers = order.vouchers || (order.items || []).filter((item) => item.type === 'voucher').map((item) => ({
          code: `FCC-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,
          name: item.name,
          value: item.voucherValue,
          expiresAt: Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
        }));
        if (!order.vouchers) {
          for (const voucher of vouchers) {
            transaction.create(adminDb.collection('discountCodes').doc(voucher.code), {
              code: voucher.code, label: voucher.name, discountType: 'credit', discountValue: voucher.value,
              used: false, singleUse: true, excludedCategories: ['MEMBERSHIP'],
              orderRef, email: order.email, createdAt: Timestamp.now(), expiresAt: voucher.expiresAt
            });
          }
        }
        if (discount?.singleUse) transaction.update(discountDocument, { used: true, usedByOrder: orderRef, usedAt: Timestamp.now() });
        const paidAt = order.paidAt || Timestamp.now();
        if (!order.recordsWritten) recordPurchase(transaction, { orderRef, order, vouchers, paidAt });
        transaction.update(orderDocument, {
          status: 'paid', vouchers, accessTokenHash: hashAccessToken(accessToken), recordsWritten: true,
          stripePaymentIntentId: session.payment_intent || '', stripeSubscriptionId: session.subscription || '',
          paidAt,
          emailSendingUntil: Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000))
        });
        return { ...order, vouchers };
      });
      if (!fields) return res.json({ received: true });
      try {
        const emailSent = await sendOrderEmail({ email: fields.email, orderRef, accessToken, items: fields.items, total: fields.total, vouchers: fields.vouchers });
        await updateFirestoreOrder(orderRef, { emailSent, emailSendingUntil: null, ...(emailSent ? { emailSentAt: Timestamp.now() } : {}) });
        if (!emailSent) throw new Error('Receipt email is not configured.');
      } catch (error) {
        await updateFirestoreOrder(orderRef, { emailSendingUntil: null });
        throw error;
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    res.status(500).send('Payment processing could not complete.');
  }
});

app.use(express.json());
app.use(express.static('dist'));

// Google Sheets API Setup
let sheets;
let adminDb;
let adminAuth;
let gmailApi;
let driveApi;
let sheetsApi;
const localFirebase = process.env.LOCAL_FIREBASE_EMULATORS === 'true';
if (localFirebase) assertLocalFirebase(process.env);
try {
  const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(__dirname, 'google-service-account.json');
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (localFirebase) {
    const adminApp = getApps()[0] || initializeAdminApp({ projectId: process.env.GCLOUD_PROJECT });
    adminDb = getAdminFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    console.log('Local Firebase emulators enabled. Workspace integrations disabled.');
  } else if (credentialsJson || fs.existsSync(credentialsPath)) {
    const credentials = credentialsJson
      ? JSON.parse(credentialsJson)
      : JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const adminApp = getApps()[0] || initializeAdminApp({ credential: cert(credentials) });
    adminDb = getAdminFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    const workspaceAuth = new google.auth.GoogleAuth({
      credentials,
      subject: process.env.GOOGLE_WORKSPACE_DELEGATED_USER || undefined,
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });
    sheets = google.sheets({ version: 'v4', auth: workspaceAuth });
    sheetsApi = sheets;
    gmailApi = google.gmail({ version: 'v1', auth: workspaceAuth });
    driveApi = google.drive({ version: 'v3', auth: workspaceAuth });
    console.log('âœ… Google Sheets API initialized');
  } else {
    console.warn('âš ï¸  Google service account key not found. Google Sheets integration disabled.');
  }
} catch (error) {
  console.error('âŒ Error initializing Google Sheets API:', error.message);
}

const createAccessToken = () => crypto.randomBytes(32).toString('hex');
const hashAccessToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const ORDER_ACCESS_DAYS = 90;

const currentClubYear = () => {
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
};

const requireAdmin = async (req, res) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : '';
  if (!token || !adminAuth) {
    res.status(401).json({ error: 'Admin authentication required.' });
    return null;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (decoded.admin !== true || !decoded.email?.toLowerCase().endsWith('@forthcanoeclub.co.uk')) {
      res.status(403).json({ error: 'Admin access required.' });
      return null;
    }
    return decoded;
  } catch {
    res.status(401).json({ error: 'Invalid admin session.' });
    return null;
  }
};

// One register: JustGo sync and website purchases both write to memberships.
const memberCollection = () => adminDb.collection('memberships');
const reportCollection = (kind) => kind === 'orders' ? adminDb.collection('orders') : kind === 'members' ? memberCollection() : null;

const stripeReportRequest = (secret) => async (path, options = {}) => {
  const headers = { Authorization: `Bearer ${secret}`, 'Stripe-Version': '2023-10-16' };
  if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: options.method || 'GET', headers, ...(options.body ? { body: options.body } : {}), signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Stripe request failed.');
  return data;
};

app.get('/api/admin/reports', rateLimit(60, 60 * 1000), async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.set('Cache-Control', 'no-store');
  try {
    if (req.query.kind === 'subscribers') {
      if (!adminDb) return res.status(503).json({ error: 'Subscriber import storage is not configured.' });
      const cursor = req.query.cursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || !/^sub_[a-zA-Z0-9]+$/.test(cursor))) {
        return res.status(400).json({ error: 'Invalid Stripe report cursor.' });
      }
      const secret = process.env.STRIPE_REPORT_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '';
      if (!/^(sk|rk)_(test|live)_/.test(secret)) return res.status(503).json({ error: 'Stripe reporting is not configured. Set a server-only Stripe report key with read access.' });
      const mode = secret.includes('_live_') ? 'live' : 'test';
      if (localFirebase && mode === 'live') return res.status(400).json({ error: 'Use Stripe test data with local emulators.' });
      const result = await loadStripeSubscribers(stripeReportRequest(secret), cursor);
      const records = await importStripeSubscribers(adminDb, result.records, mode, result.checkedAt);
      return res.json({ ...result, records, mode, imported: records.length, clubYearEnd: nextClubYearEnd() });
    }
    if (!adminDb) return res.status(503).json({ error: 'Report storage is not configured.' });
    const collection = reportCollection(req.query.kind);
    const eventReport = req.query.kind === 'events';
    const source = eventReport ? adminDb.collection('orders') : collection;
    if (!source) return res.status(400).json({ error: 'Choose orders, events or members.' });
    const cursor = req.query.cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 1500 || cursor.includes('/'))) {
      return res.status(400).json({ error: 'Invalid report cursor.' });
    }
    let query = source.orderBy(FieldPath.documentId()).limit(101);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const documents = snapshot.docs.slice(0, 100);
    let members = new Map();
    if (req.query.kind !== 'members') {
      const ids = [...new Set(documents.flatMap((document) => (document.data().people || []).map((person) => person.membershipId)).filter(Boolean))];
      if (ids.length) members = new Map((await adminDb.getAll(...ids.map((id) => adminDb.collection('memberships').doc(id)))).filter((document) => document.exists).map((document) => [document.id, document.data()]));
    }
    const records = documents.map((document) => (req.query.kind === 'members' ? membershipReport(document.id, document.data()) : orderReport(document.id, document.data(), members)));
    res.json({ records: eventReport ? records.filter((record) => record.items.some((item) => item.category === 'EVENTS'))
      .map((record) => ({ ...record, orderTotal: record.total, items: record.items.filter((item) => item.category === 'EVENTS'),
        total: record.items.filter((item) => item.category === 'EVENTS').reduce((sum, item) => sum + (item.price || 0), 0) })) : records,
      nextCursor: snapshot.size > 100 ? documents.at(-1).id : null });
  } catch (error) {
    console.error('Admin report failed:', error.message);
    res.status(500).json({ error: 'Could not retrieve report.' });
  }
});

app.post('/api/admin/subscribers/:id/club-year-cancellation', rateLimit(10, 60 * 1000), async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.set('Cache-Control', 'no-store');
  try {
    const { mode, clubCustomerId, confirmId, clubYearEnd, acknowledgeBillingChange } = req.body;
    const id = req.params.id;
    if (!adminDb) return res.status(503).json({ error: 'Subscriber registry is not configured.' });
    if (!/^sub_[a-zA-Z0-9]+$/.test(id) || !['test', 'live'].includes(mode) || typeof clubCustomerId !== 'string'
      || confirmId !== id || acknowledgeBillingChange !== true || clubYearEnd !== nextClubYearEnd()) {
      return res.status(400).json({ error: 'Confirm the exact subscription ID, billing change and current club-year end date.' });
    }
    if (localFirebase && mode === 'live') return res.status(400).json({ error: 'Live billing changes are disabled with local emulators.' });
    const secret = process.env.STRIPE_SUBSCRIPTION_ADMIN_KEY || '';
    if (!/^(sk|rk)_(test|live)_/.test(secret)) return res.status(503).json({ error: 'Subscription scheduling is not configured. Set STRIPE_SUBSCRIPTION_ADMIN_KEY on the server.' });
    if ((secret.includes('_live_') ? 'live' : 'test') !== mode) return res.status(400).json({ error: 'Stripe write key and report mode do not match.' });
    const registry = adminDb.collection('stripeSubscriptions').doc(`FCC-${mode}-${id}`);
    const existing = await registry.get();
    if (!existing.exists || existing.data().clubCustomerId !== clubCustomerId) {
      return res.status(409).json({ error: 'Import and verify this subscriber before scheduling cancellation.' });
    }
    const result = await scheduleClubYearCancellation(stripeReportRequest(secret), id, clubCustomerId, mode);
    const checkedAt = new Date().toISOString();
    const [record] = await importStripeSubscribers(adminDb, [result.record], mode, checkedAt);
    const batch = adminDb.batch();
    batch.set(registry, { clubYearCancellationRequestedAt: checkedAt, clubYearCancellationRequestedBy: admin.uid,
      clubYearEnd: result.clubYearEnd, scheduledCancellationAt: result.cancellationAt }, { merge: true });
    batch.set(adminDb.collection('adminSubscriptionAudit').doc(`club-year-${mode}-${id}-${result.clubYearEnd.slice(0, 10)}`), {
      adminUid: admin.uid, stripeSubscriptionId: id, clubCustomerId, mode, cancellationAt: result.cancellationAt,
      clubYearEnd: result.clubYearEnd, changed: result.changed, checkedAt
    }, { merge: true });
    await batch.commit();
    res.json({ ...result, record, checkedAt });
  } catch (error) {
    console.error('Club-year cancellation failed:', error.message);
    res.status(502).json({ error: 'Could not finish confirming and recording club-year cancellation. Check Stripe and refresh the report before retrying; Stripe may already have accepted the change.' });
  }
});

app.delete('/api/admin/records/:kind/:id', rateLimit(20, 60 * 1000), async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.set('Cache-Control', 'no-store');
  try {
    if (!adminDb) return res.status(503).json({ error: 'Record storage is not configured.' });
    const collection = reportCollection(req.params.kind);
    if (!collection || !req.params.id || req.params.id.includes('/') || req.params.id.length > 1500) {
      return res.status(400).json({ error: 'Invalid report record.' });
    }
    if (req.body.confirmId !== req.params.id) return res.status(400).json({ error: 'Type the exact record ID to confirm deletion.' });
    const reference = collection.doc(req.params.id);
    const result = await adminDb.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return { status: 404, error: 'Record not found.' };
      const fields = document.data();
      let warning = subscriptionWarning(fields);
      if (fields.email) {
        const related = await transaction.get(adminDb.collection('orders').where('email', '==', normalizeEmail(fields.email)).limit(101));
        warning ||= related.size > 100 || related.docs.some((order) => subscriptionWarning(order.data()));
      } else if (req.params.kind === 'members') warning = true;
      if (warning && req.body.acknowledgeStripe !== true) return { status: 409,
        error: 'Check and cancel any active Stripe subscription before deleting this record. Deleting website data does not stop payments.',
        requiresStripeAcknowledgement: true, stripeSubscriptionId: fields.stripeSubscriptionId || '' };
      transaction.delete(reference);
      transaction.create(adminDb.collection('adminDeletionAudit').doc(), {
        adminUid: admin.uid, kind: req.params.kind,
        recordIdHash: crypto.createHash('sha256').update(req.params.id).digest('hex'),
        stripeAcknowledged: req.body.acknowledgeStripe === true, createdAt: Timestamp.now()
      });
      return { status: 200, success: true };
    });
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Admin deletion failed:', error.message);
    res.status(500).json({ error: 'Could not delete record.' });
  }
});

app.post('/api/admin/publish-page', rateLimit(10, 60 * 1000), async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { pageId, content = {} } = req.body;
    const page = PAGE_CONTENT[pageId];
    const repository = process.env.GITHUB_REPOSITORY || 'Riotshielder21/ForthCCWebsite';
    const branch = process.env.GITHUB_CONTENT_BRANCH || 'live/web-admin-edit';
    const token = process.env.GITHUB_CONTENT_TOKEN;
    if (!token) return res.status(503).json({ error: 'GitHub publishing is not configured on the API server.' });
    if (!page || !content || typeof content !== 'object' || Array.isArray(content)) {
      return res.status(400).json({ error: 'Unknown page or invalid content.' });
    }

    const publishedContent = {};
    for (const [key, definition] of Object.entries(page.fields)) {
      const value = content[key] ?? definition.value;
      if (typeof value !== 'string' || value.length > 20000) {
        return res.status(400).json({ error: `Invalid value for ${definition.label}.` });
      }
      if (/url$/i.test(key) && value && !/^https:\/\//i.test(value)) {
        return res.status(400).json({ error: `${definition.label} must be an https URL.` });
      }
      publishedContent[key] = value;
    }
    if (content.tileLayout !== undefined) {
      try {
        publishedContent.tileLayout = validateTileLayout(pageId, content.tileLayout);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    if (pageId === 'home' && content.supporterTiles !== undefined) {
      try {
        publishedContent.supporterTiles = validateSupporterTiles(content.supporterTiles);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    const github = createGitHubClient(repository, token);
    await ensureGitHubBranch(github, branch);
    const path = `public/content/pages/${pageId}.json`;
    const endpoint = github.url(`/contents/${path}`);
    const currentResponse = await github.request(`${endpoint}?ref=${encodeURIComponent(branch)}`);
    let sha;
    if (currentResponse.ok) {
      sha = (await currentResponse.json()).sha;
    } else if (currentResponse.status !== 404) {
      const errorBody = await currentResponse.json().catch(() => ({}));
      throw new Error(errorBody.message || 'GitHub could not read the current page file.');
    }

    const update = await github.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update page content: ${page.label}`,
        content: Buffer.from(`${JSON.stringify(publishedContent, null, 2)}\n`).toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
        committer: {
          name: 'FCC Website Content Manager',
          email: process.env.GITHUB_COMMIT_EMAIL || 'website@forthcanoeclub.co.uk'
        }
      })
    });
    const result = await update.json();
    if (!update.ok) throw new Error(result.message || 'GitHub could not save the page file.');

    res.json({ success: true, branch, commit: result.commit.sha, url: result.content.html_url });
  } catch (error) {
    console.error('GitHub page draft save failed:', error.message);
    res.status(500).json({ error: error.message || 'Could not save page draft.' });
  }
});

app.post('/api/admin/create-content-pr', rateLimit(5, 60 * 1000), async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const repository = process.env.GITHUB_REPOSITORY || 'Riotshielder21/ForthCCWebsite';
    const base = process.env.GITHUB_BRANCH || 'main';
    const head = process.env.GITHUB_CONTENT_BRANCH || 'live/web-admin-edit';
    const token = process.env.GITHUB_CONTENT_TOKEN;
    if (!token) return res.status(503).json({ error: 'GitHub publishing is not configured on the API server.' });

    const github = createGitHubClient(repository, token);
    const compareResponse = await github.request(github.url(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`));
    const comparison = await compareResponse.json();
    if (!compareResponse.ok) throw new Error(comparison.message || 'Could not compare the draft branch with main.');
    if (comparison.ahead_by === 0) return res.status(409).json({ error: 'There are no saved changes to review.' });

    const owner = repository.split('/')[0];
    const pullsResponse = await github.request(github.url(`/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${head}`)}`));
    const pulls = await pullsResponse.json();
    if (!pullsResponse.ok) throw new Error(pulls.message || 'Could not check for an existing review request.');

    let pullRequest = pulls[0];
    if (!pullRequest) {
      const createResponse = await github.request(github.url('/pulls'), {
        method: 'POST',
        body: JSON.stringify({
          title: 'Review website content updates',
          head,
          base,
          body: `Website content changes are ready for review.\n\nRequested by ${admin.email}. Review the page changes, then approve and merge to publish them through the main-branch Firebase deployment.`
        })
      });
      pullRequest = await createResponse.json();
      if (!createResponse.ok) throw new Error(pullRequest.message || 'Could not create the content review pull request.');
    }

    const assignee = process.env.GITHUB_PR_ASSIGNEE || 'Riotshielder21';
    if (assignee) {
      const assignmentResponse = await github.request(github.url(`/issues/${pullRequest.number}`), {
        method: 'PATCH',
        body: JSON.stringify({ assignees: [assignee] })
      });
      if (!assignmentResponse.ok) console.warn('Could not assign content PR:', (await assignmentResponse.json()).message);
    }

    const reviewers = (process.env.GITHUB_PR_REVIEWERS || 'Riotshielder21').split(',').map((name) => name.trim()).filter(Boolean);
    if (reviewers.length) {
      const reviewerResponse = await github.request(github.url(`/pulls/${pullRequest.number}/requested_reviewers`), {
        method: 'POST',
        body: JSON.stringify({ reviewers })
      });
      if (!reviewerResponse.ok) console.warn('Could not request content PR reviewers:', (await reviewerResponse.json()).message);
    }

    const notificationSent = await sendContentPrNotification(pullRequest, admin.email);
    res.json({ success: true, number: pullRequest.number, url: pullRequest.html_url, branch: head, assignee, notificationSent });
  } catch (error) {
    console.error('GitHub content PR failed:', error.message);
    res.status(500).json({ error: error.message || 'Could not create content review request.' });
  }
});

const sendContentPrNotification = async (pullRequest, requestedBy) => {
  const recipient = process.env.GITHUB_PR_NOTIFICATION_EMAIL || 'Riotshielder21@gmail.com';
  const sender = process.env.GOOGLE_WORKSPACE_SENDER || process.env.GOOGLE_WORKSPACE_DELEGATED_USER;
  if (!gmailApi || !sender || !recipient) return false;
  const raw = [
    `From: Forth Canoe Club Website <${sender}>`,
    `To: ${recipient}`,
    `Subject: Website changes need your review: PR #${pullRequest.number}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `An administrator (${requestedBy}) submitted website content for review.`,
    '',
    `Review and merge the pull request to publish the changes: ${pullRequest.html_url}`,
    '',
    'The approved main-branch workflow deploys the website to Firebase.'
  ].join('\r\n');
  try {
    await gmailApi.users.messages.send({
      userId: 'me',
      requestBody: { raw: Buffer.from(raw).toString('base64url') }
    });
    return true;
  } catch (error) {
    console.error('Could not email content PR notification:', error.message);
    return false;
  }
};

const createGitHubClient = (repository, token) => {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  return {
    url: (path) => `https://api.github.com/repos/${encodedRepository}${path}`,
    request: (url, options = {}) => fetch(url, { ...options, headers: { ...headers, ...options.headers } })
  };
};

const ensureGitHubBranch = async (github, branch) => {
  const encodedBranch = encodeURIComponent(branch);
  const branchRef = await github.request(github.url(`/git/ref/heads/${encodedBranch}`));
  if (branchRef.ok) return;
  if (branchRef.status !== 404) {
    const error = await branchRef.json().catch(() => ({}));
    throw new Error(error.message || 'Could not read content branch.');
  }

  const baseBranch = process.env.GITHUB_BRANCH || 'main';
  const baseRef = await github.request(github.url(`/git/ref/heads/${encodeURIComponent(baseBranch)}`));
  const baseData = await baseRef.json();
  if (!baseRef.ok) throw new Error(baseData.message || 'Could not read main branch.');

  const createRef = await github.request(github.url('/git/refs'), {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseData.object.sha })
  });
  if (!createRef.ok) {
    const error = await createRef.json();
    throw new Error(error.message || 'Could not create the content review branch.');
  }
};

app.post('/api/admin/forms', rateLimit(20, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    const { name, description = '', fields = [] } = req.body;
    if (!name || !Array.isArray(fields) || !adminDb || !driveApi || !sheetsApi) {
      return res.status(400).json({ error: 'Form name, fields, and Google services are required.' });
    }
    const folderName = `Forms ${currentClubYear()}-${currentClubYear() + 1}`;
    const rootFolderId = process.env.GOOGLE_FORMS_ROOT_FOLDER_ID;
    if (!rootFolderId) return res.status(503).json({ error: 'Google Forms root folder is not configured.' });

    const sharedDriveId = process.env.GOOGLE_SHARED_DRIVE_ID;
    const folderSearch = await driveApi.files.list({
      q: `'${rootFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: sharedDriveId ? 'drive' : 'user',
      ...(sharedDriveId ? { driveId: sharedDriveId } : {})
    });
    const folder = folderSearch.data.files?.[0] || (await driveApi.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId]
      },
      fields: 'id,name',
      supportsAllDrives: true
    })).data;

    const spreadsheet = await driveApi.files.create({
      requestBody: {
        name: `${name} - ${folderName}`,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folder.id]
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true
    });
    const spreadsheetId = spreadsheet.data.id;
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `A1:${String.fromCharCode(65 + Math.min(fields.length, 25))}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Timestamp', 'Email', ...fields.map((field) => typeof field === 'string' ? field : field.label || 'Response')]] }
    });
    const form = { name, description, fields, spreadsheetId, folderId: folder.id, clubYear: currentClubYear(), createdAt: new Date().toISOString() };
    const formDocument = await adminDb.collection('forms').add(form);
    res.json({ success: true, form: { id: formDocument.id, ...form } });
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({ error: 'Could not create form.' });
  }
});

const findDiscountCode = async (code) => {
  if (!adminDb) throw new Error('Discount storage is not configured.');
  const snapshot = await adminDb.collection('discountCodes').where('code', '==', code).limit(1).get();
  return snapshot.docs[0] || null;
};

const discountFailure = (discount) => {
  if (!discount || discount.used || discount.active === false) return 'Invalid or already used code.';
  if (discount.expiresAt?.toMillis() <= Date.now()) return 'Code expired.';
  if (discount.singleUse && discount.reservedUntil?.toMillis() > Date.now()) return 'Voucher is already in checkout. Try again later.';
  return null;
};

const publicDiscount = (discount) => ({
  label: discount.label || 'Discount', discountType: discount.discountType || 'multiplier',
  discountValue: discount.discountValue ?? 0.25, allowsAnnualStacking: discount.allowsAnnualStacking === true,
  productIds: Array.isArray(discount.productIds) ? discount.productIds : []
});

app.post('/api/discount-codes/validate', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9-]{3,64}$/.test(code)) return res.json({ valid: false, message: 'Invalid code.' });
    const document = await findDiscountCode(code);
    const discount = document?.data();
    const message = discountFailure(discount);
    res.json(message ? { valid: false, message } : { valid: true, ...publicDiscount(discount) });
  } catch (error) {
    res.status(503).json({ error: 'Could not validate discount code.' });
  }
});

app.post('/api/admin/memberships/:id/justgo', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    if (!adminDb) return res.status(503).json({ error: 'Member storage is not configured.' });
    const action = req.body.action;
    if (!['retry', 'manual'].includes(action) || !req.params.id || req.params.id.includes('/')) return res.status(400).json({ error: 'Choose retry or manual.' });
    const reference = adminDb.collection('memberships').doc(req.params.id);
    const document = await reference.get();
    if (!document.exists) return res.status(404).json({ error: 'Membership not found.' });
    if (document.data().justgoSyncStatus !== 'pending') return res.status(409).json({ error: 'This member is already linked to JustGo.' });
    const now = Timestamp.now();
    await reference.set({
      justgoUpload: action === 'retry'
        ? { status: 'queued', needsStaff: false, attempts: 0, failures: 0, lastError: '', nextAttemptAt: now }
        : { status: 'manual', needsStaff: false, nextAttemptAt: null },
      updatedAt: now
    }, { merge: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not update the JustGo status.' });
  }
});

app.get('/api/admin/customer', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    if (!adminDb) return res.status(503).json({ error: 'Customer storage is not configured.' });
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length > 254) return res.status(400).json({ error: 'Enter the customer email or voucher code.' });
    let email = normalizeEmail(query);
    if (!query.includes('@')) {
      const voucher = await findDiscountCode(query.toUpperCase());
      if (!voucher?.data().orderRef) return res.status(404).json({ error: 'No voucher with that code.' });
      email = voucher.data().email || normalizeEmail((await adminDb.collection('orders').doc(voucher.data().orderRef).get()).data()?.email);
    }
    if (!email) return res.status(404).json({ error: 'No customer found.' });

    const [byEmail, orderSnapshot, memberSnapshot] = await Promise.all([
      adminDb.collection('discountCodes').where('email', '==', email).get(),
      adminDb.collection('orders').where('email', '==', email).limit(50).get(),
      adminDb.collection('memberships').where('email', '==', email).limit(20).get()
    ]);
    // Older vouchers have no email of their own, so they are found through the customer's orders.
    const known = new Set(byEmail.docs.map((document) => document.id));
    const olderCodes = orderSnapshot.docs.flatMap((order) => (order.data().vouchers || []).map((voucher) => voucher.code)).filter((code) => !known.has(code));
    const voucherDocs = [...byEmail.docs.filter((document) => document.data().orderRef)];
    if (olderCodes.length) voucherDocs.push(...(await adminDb.getAll(...olderCodes.map((code) => adminDb.collection('discountCodes').doc(code)))).filter((document) => document.exists));
    if (!voucherDocs.length && !orderSnapshot.size && !memberSnapshot.size) return res.status(404).json({ error: 'No customer found.' });
    const now = Date.now();
    res.json({
      email,
      vouchers: voucherDocs.map((document) => {
        const data = document.data();
        return {
          code: data.code, value: data.discountValue, orderRef: data.orderRef, usedByOrder: data.usedByOrder || '',
          status: data.used ? 'used' : data.expiresAt?.toMillis() <= now ? 'expired' : data.reservedUntil?.toMillis() > now ? 'in checkout' : 'active',
          createdAt: data.createdAt?.toMillis() || 0, expiresAt: data.expiresAt?.toMillis() || 0, usedAt: data.usedAt?.toMillis() || 0
        };
      }).sort((a, b) => b.createdAt - a.createdAt),
      memberships: memberSnapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id, name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.name || 'Unnamed',
          membershipTier: data.membershipTier || '', status: data.status === 'active' && data.validUntil?.toMillis() <= now ? 'expired' : data.status || 'unknown',
          validUntil: data.validUntil?.toMillis() || 0, scaNumber: data.scaNumber || '',
          privileges: (data.privileges || []).map((privilege) => privilege.name)
        };
      }),
      orders: orderSnapshot.docs.map((document) => {
        const data = document.data();
        return { orderRef: document.id, status: data.status, total: data.total, createdAt: data.createdAt?.toMillis() || 0, items: (data.items || []).map((item) => item.name) };
      }).sort((a, b) => b.createdAt - a.createdAt)
    });
  } catch (error) {
    console.error('Could not load customer record:', error.message);
    res.status(500).json({ error: 'Could not load the customer record.' });
  }
});

app.get('/api/admin/discount-codes', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    if (!adminDb) return res.status(503).json({ error: 'Discount storage is not configured.' });
    const snapshot = await adminDb.collection('discountCodes').get();
    const now = Date.now();
    const codes = snapshot.docs.map((document) => document.data()).filter((data) => !data.orderRef).map((data) => ({
      code: data.code, label: data.label || '', discountType: data.discountType || 'multiplier',
      discountValue: data.discountValue ?? 0.25, productIds: Array.isArray(data.productIds) ? data.productIds : [],
      singleUse: data.singleUse === true, used: data.used === true, active: data.active !== false,
      expired: data.expiresAt?.toMillis() <= now, expiresAt: data.expiresAt?.toMillis() || 0, createdAt: data.createdAt?.toMillis() || 0
    })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
    res.json({ codes });
  } catch (error) {
    console.error('Could not list discount codes:', error.message);
    res.status(500).json({ error: 'Could not load discount codes.' });
  }
});

const parseDiscountFields = (body, { requireFutureExpiry }) => {
  const { label, discountType } = body;
  const discountValue = Number(body.discountValue);
  const expiry = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const productIds = Array.isArray(body.productIds) ? body.productIds : [];
  if (typeof label !== 'string' || !label.trim() || label.length > 120 ||
      !['credit', 'multiplier', 'flat'].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0 ||
      (discountType === 'multiplier' && discountValue > 1) || !Number.isFinite(expiry.getTime()) || (requireFutureExpiry && expiry <= new Date())) {
    return { error: 'Enter a valid label, discount value and expiry.' };
  }
  if (productIds.length > 50 || productIds.some((id) => typeof id !== 'string' || id.length > 100)) {
    return { error: 'Choose valid products for this code.' };
  }
  return { fields: {
    label: label.trim(), discountType, discountValue, productIds: [...new Set(productIds)],
    singleUse: discountType === 'credit' || body.singleUse === true, expiresAt: Timestamp.fromDate(expiry)
  } };
};

app.patch('/api/admin/discount-codes/:code', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    if (!adminDb) return res.status(503).json({ error: 'Discount storage is not configured.' });
    const document = await findDiscountCode(String(req.params.code).toUpperCase());
    if (!document || document.data().orderRef) return res.status(404).json({ error: 'Discount code not found.' });
    if (typeof req.body.active === 'boolean' && Object.keys(req.body).length === 1) {
      await document.ref.update({ active: req.body.active });
      return res.json({ success: true });
    }
    const { error, fields } = parseDiscountFields(req.body, { requireFutureExpiry: false });
    if (error) return res.status(400).json({ error });
    await document.ref.update(fields);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not update discount code.' });
  }
});

app.post('/api/admin/discount-codes', rateLimit(20, 60 * 1000), async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!adminDb) return res.status(503).json({ error: 'Discount storage is not configured.' });
    const { error, fields } = parseDiscountFields(req.body, { requireFutureExpiry: true });
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (error || !/^[A-Z0-9-]{3,64}$/.test(code)) return res.status(400).json({ error: error || 'Enter a valid code.' });
    if (await findDiscountCode(code)) return res.status(409).json({ error: 'This discount code already exists.' });
    await adminDb.collection('discountCodes').doc(code).create({
      code, ...fields, used: false, active: true,
      allowsAnnualStacking: req.body.allowsAnnualStacking === true,
      excludedCategories: ['MEMBERSHIP'], createdBy: admin.uid,
      createdAt: Timestamp.now()
    });
    res.json({ success: true, code });
  } catch (error) {
    res.status(error.code === 6 ? 409 : 500).json({ error: error.code === 6 ? 'This discount code already exists.' : 'Could not create discount code.' });
  }
});

// Names only, so a returning member can pick themselves; the date of birth is still verified at payment.
app.post('/api/membership-names', rateLimit(5, 60 * 1000), async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!adminDb || !isValidEmail(email)) return res.json({ names: [] });
    const snapshot = await adminDb.collection('memberships').where('email', '==', email).limit(10).get();
    const names = new Map();
    for (const document of snapshot.docs) {
      const { firstName, lastName } = document.data();
      if (firstName && lastName) names.set(`${firstName} ${lastName}`.toLowerCase(), { firstName, lastName });
    }
    res.json({ names: [...names.values()] });
  } catch (error) {
    res.json({ names: [] });
  }
});

app.post('/api/checkout-session', rateLimit(10, 60 * 1000), async (req, res) => {
  let reservedDocument;
  const orderRef = `FCC-${crypto.randomUUID().toUpperCase()}`;
  try {
    const email = normalizeEmail(req.body.email);
    const { items: requestedItems, billingMode = 'annual' } = req.body;
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe test mode is not configured.' });
    if (!isValidEmail(email) || !Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 20 || !['annual', 'monthly'].includes(billingMode)) {
      return res.status(400).json({ error: 'Enter a valid email address and include at least one item.' });
    }

    if (!adminDb) return res.status(503).json({ error: 'Order storage is not configured.' });
    const catalogSnapshot = await adminDb.collection('products').get();
    const catalog = resolveCatalogue(PRODUCTS, catalogSnapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
    const lineIds = requestedItems.map((item) => typeof item?.lineId === 'string' ? item.lineId.slice(0, 64) : '');
    const catalogItems = requestedItems.map((item) => catalog.find((product) => product.id === item?.id));
    if (catalogItems.some((item) => !item || item.type === 'external' || !Number.isFinite(item.basePrice) || item.basePrice < 0) || lineIds.some((id) => !id) || new Set(lineIds).size !== lineIds.length) {
      return res.status(400).json({ error: 'Your basket contains an unavailable item. Please refresh the shop.' });
    }
    const selected = catalogItems.map((item, index) => ({ ...item, lineId: lineIds[index] }));
    for (const item of selected.filter((product) => product.category === 'EVENTS')) {
      try { validateEventSchedule(item.eventSchedule); }
      catch (error) { return res.status(400).json({ error: `Invalid event schedule for ${item.name}.` }); }
      if (item.type !== 'event-ticket') return res.status(400).json({ error: 'Event tickets must use one-off event pricing.' });
    }
    if (!Array.isArray(req.body.people) || req.body.people.length > 20) {
      return res.status(400).json({ error: 'Add the details for each person in your basket.' });
    }
    const sanitized = req.body.people.map(sanitizePerson);
    const people = sanitized
      .map((person) => ({ ...person, junior: resolvedKind(person, sanitized, selected) === 'junior' }))
      .map((person) => person.returning
        ? { ...person, email: person.email || email, guardian: { ...person.guardian, email: person.guardian.email || email } }
        : person);
    const detailErrors = validateCheckout({ lines: selected, people });
    if (detailErrors.length) return res.status(400).json({ error: detailErrors[0], details: detailErrors });
    const needsMembership = new Set(peopleNeedingMembership(selected, people).map((person) => person.id));
    const storedPeople = [];
    for (const person of withFamilyContacts(people, selected)) {
      const { existing, conflict, reason } = await findMembership(person);
      if (conflict) {
        return res.status(409).json({
          code: 'identity_conflict', personIds: [person.id],
          error: reason === 'number'
            ? `The membership number entered for ${person.firstName} ${person.lastName} does not match the email address or date of birth we hold for it. Check them, or leave the number blank and we will arrange your membership with JustGo for you; JustGo will email you an invitation to accept.`
            : `A membership under this email already exists for ${person.firstName} ${person.lastName} with a different date of birth. Check the date of birth, or enter your Paddle Scotland membership number.`
        });
      }
      if (person.returning && !existing) {
        return res.status(409).json({
          code: 'returning_not_found', personIds: [person.id],
          error: `We could not match ${person.firstName} ${person.lastName} with that date of birth. Check the date of birth, or enter your full details instead.`
        });
      }
      const buysMembership = person.lineIds.some((id) => isMembership(selected.find((line) => line.lineId === id)));
      // From 1 March every JustGo member is inactive until the nightly sync confirms their direct-debit renewal.
      if (existing?.awaitingRenewal && renewalConfirmationOpen() && (buysMembership || needsMembership.has(person.id))) {
        return res.status(409).json({
          code: 'renewal_unconfirmed', personIds: [person.id],
          error: `${person.firstName} ${person.lastName}'s membership renews through JustGo direct debit and is still being confirmed for the new club year. This usually completes within a day, so please try again then or contact secretary@forthcanoeclub.co.uk. There is no need to buy a membership here.`
        });
      }
      if (buysMembership && existing?.active) {
        const name = `${person.firstName} ${person.lastName}`;
        return res.status(409).json({
          code: existing.justgo ? 'renews_via_justgo' : 'membership_active', personIds: [person.id],
          error: existing.justgo
            ? `${name} is already an active member and renews through JustGo, so no membership is needed here. Remove the membership from your basket; add-ons can still be bought.`
            : `${name} is already an active member until ${new Date(existing.validUntil).toLocaleDateString('en-GB')}. Remove the membership from your basket; add-ons can still be bought.`
        });
      }
      if (needsMembership.has(person.id) && !existing?.active) {
        return res.status(409).json({
          code: 'membership_required', personIds: [person.id],
          error: existing?.awaitingRenewal
            ? `${person.firstName} ${person.lastName}'s JustGo renewal has not been confirmed for this club year, so add-ons cannot be bought yet. If you have renewed, it can take a day to appear; otherwise add a membership to your basket. Questions: secretary@forthcanoeclub.co.uk.`
            : `${person.firstName} ${person.lastName} needs a Forth Canoe Club membership before buying these items. Add a membership to your basket, or check the membership number or date of birth and email you entered. If you are already a member through JustGo your record can take a day to appear; contact secretary@forthcanoeclub.co.uk.`
        });
      }
      storedPeople.push({ ...person, membershipId: existing?.id || `MEM-${crypto.randomUUID().toUpperCase()}`, existingMember: Boolean(existing) });
    }
    let promo = null;
    const code = typeof req.body.discountCode === 'string' ? req.body.discountCode.trim().toUpperCase() : '';
    const discountDocument = code ? await findDiscountCode(code) : null;
    if (code) {
      const message = discountFailure(discountDocument?.data());
      if (message) return res.status(400).json({ error: message });
      promo = publicDiscount(discountDocument.data());
    }
    const pricing = calculateCart(selected, billingMode === 'annual', promo);
    if (promo && pricing.promoDiscountValue <= 0) return res.status(400).json({ error: 'This code does not apply to the items in your basket.' });
    if (discountDocument?.data().singleUse) {
      await adminDb.runTransaction(async (transaction) => {
        const current = await transaction.get(discountDocument.ref);
        const message = discountFailure(current.data());
        if (message) throw new Error(message);
        transaction.update(discountDocument.ref, { reservedByOrder: orderRef, reservedUntil: Timestamp.fromDate(new Date(Date.now() + 65 * 60 * 1000)) });
      });
      reservedDocument = discountDocument.ref;
    }
    const items = pricing.items.map((item) => ({
      id: item.id, lineId: item.lineId, name: item.name, category: item.category, type: item.type, price: item.displayPrice,
      ...(item.membershipTier ? { membershipTier: item.membershipTier } : {}),
      ...(item.type === 'voucher' ? { voucherValue: item.basePrice } : {}),
      ...(item.category === 'EVENTS' ? { eventSchedule: validateEventSchedule(item.eventSchedule) } : {})
    }));
    const total = pricing.total;
    await createFirestoreOrder({ orderRef, email, items, total, status: 'pending', discountCodeId: discountDocument?.id || null, people: storedPeople });
    const hasRecurringItem = billingMode === 'monthly' && items.some((item) => item.type === 'subscription');
    const oneOffCredit = hasRecurringItem && promo?.discountType === 'credit';
    let coupon;
    if (oneOffCredit) {
      coupon = await stripeRequest('coupons', [['amount_off', String(Math.round(pricing.promoDiscountValue * 100))], ['currency', 'gbp'], ['duration', 'once']]);
    }
    const lineItems = items.flatMap((item, index) => [
      [`line_items[${index}][price_data][currency]`, 'gbp'],
      [`line_items[${index}][price_data][product_data][name]`, item.name],
      [`line_items[${index}][price_data][unit_amount]`, String(Math.round((oneOffCredit ? pricing.items[index].subtotalPrice : Number(item.price)) * 100))],
      [`line_items[${index}][quantity]`, '1'],
      ...(billingMode === 'monthly' && item.type === 'subscription'
        ? [[`line_items[${index}][price_data][recurring][interval]`, 'month']]
        : [])
    ]);
    const session = await stripeRequest('checkout/sessions', [
      ...lineItems,
      ...(coupon ? [['discounts[0][coupon]', coupon.id]] : []),
      ['expires_at', String(Math.floor(Date.now() / 1000) + 3600)],
      ['mode', hasRecurringItem ? 'subscription' : 'payment'],
      ['customer_email', email],
      ['success_url', `${process.env.PUBLIC_SITE_URL || 'http://localhost:3000'}/payment-success?session_id={CHECKOUT_SESSION_ID}`],
      ['cancel_url', `${process.env.PUBLIC_SITE_URL || 'http://localhost:3000'}/membership`],
      ['metadata[order_ref]', orderRef],
      ['metadata[total]', String(total)],
      ['metadata[billing_mode]', billingMode]
    ]);
    await updateFirestoreOrder(orderRef, { stripeSessionId: session.id });

    res.json({ success: true, orderRef, sessionId: session.id, checkoutUrl: session.url });
  } catch (error) {
    if (reservedDocument) {
      try {
        await adminDb.runTransaction(async (transaction) => {
          const document = await transaction.get(reservedDocument);
          if (document.data()?.reservedByOrder === orderRef && !document.data()?.used) {
            transaction.update(reservedDocument, { reservedByOrder: null, reservedUntil: null });
          }
        });
      } catch (releaseError) {
        console.error('Could not release voucher reservation:', releaseError.message);
      }
    }
    console.error('Error creating Stripe Checkout session:', error.message);
    res.status(500).json({ error: 'Could not start secure checkout.' });
  }
});

const sendOrderEmail = async ({ email, orderRef, accessToken, items, total, vouchers = [] }) => {
  if (localFirebase) {
    await adminDb.collection('testMail').add({ email, orderRef, items, total,
      retrievalUrl: `${process.env.PUBLIC_SITE_URL || 'http://localhost:3000'}/order/${orderRef}.${accessToken}`,
      vouchers, createdAt: Timestamp.now() });
    return true;
  }
  const sender = process.env.GOOGLE_WORKSPACE_SENDER || process.env.GOOGLE_WORKSPACE_DELEGATED_USER;
  if (!gmailApi || !sender) return false;

  const retrievalUrl = `${process.env.PUBLIC_SITE_URL || 'http://localhost:3000'}/order/${orderRef}.${accessToken}`;
  const itemLines = items.map((item) => `- ${item.name}: £${Number(item.price).toFixed(2)}${item.eventSchedule ? ` — ${eventScheduleLabel(item.eventSchedule)}` : ''}`).join('\n');
  const body = [
    'Thank you for your purchase from Forth Canoe Club.',
    '',
    `Order reference: ${orderRef}`,
    `Total: £${Number(total).toFixed(2)}`,
    '',
    itemLines,
    '',
    ...vouchers.flatMap((voucher) => [
      `${voucher.name}: ${voucher.code}`,
      `Value: £${Number(voucher.value).toFixed(2)}. Valid until ${voucher.expiresAt.toDate().toLocaleDateString('en-GB')}.`,
      'Valid on all items except membership. One use only; any unused value is forfeited.',
      ''
    ]),
    `Retrieve your receipt and subscription information: ${retrievalUrl}`,
    '',
    'For help, contact secretary@forthcanoeclub.co.uk.'
  ].join('\n');
  const raw = [
    `From: Forth Canoe Club <${sender}>`,
    `To: ${email}`,
    'Subject: Your Forth Canoe Club purchase',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ].join('\r\n');

  await gmailApi.users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(raw).toString('base64url') }
  });
  return true;
};

app.post('/api/orders', rateLimit(10, 60 * 1000), async (req, res) => {
  try {
    const { email, items, total, receipt } = req.body;
    if (!isValidEmail(email) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Enter a valid email address and include at least one item.' });
    }
    if (!adminDb) {
      return res.status(503).json({ error: 'Order storage is not configured.' });
    }

    const orderRef = `FCC-${Date.now().toString(36).toUpperCase()}`;
    const accessToken = createAccessToken();
    await adminDb.collection('orders').doc(orderRef).create({
      email: normalizeEmail(email),
      accessTokenHash: hashAccessToken(accessToken),
      receipt: receipt || {},
      items,
      total: String(total),
      status: 'paid',
      emailSent: false,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + ORDER_ACCESS_DAYS * 24 * 60 * 60 * 1000))
    });

    let emailSent = false;
    try {
      emailSent = await sendOrderEmail({ email, orderRef, accessToken, items, total });
    } catch (emailError) {
      console.error('Order stored but email could not be sent:', emailError.message);
    }

    res.json({ success: true, orderRef, accessToken, emailSent });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Could not save order.' });
  }
});

app.get('/api/orders/:accessKey', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    const separator = req.params.accessKey.indexOf('.');
    const orderRef = separator === -1 ? '' : req.params.accessKey.slice(0, separator);
    const accessToken = separator === -1 ? '' : req.params.accessKey.slice(separator + 1);
    if (!adminDb || !orderRef || !accessToken) return res.status(404).json({ error: 'Order not found.' });

    const document = await adminDb.collection('orders').doc(orderRef).get();
    if (!document.exists) return res.status(404).json({ error: 'Order not found.' });
    const fields = document.data();
    if (fields.accessTokenHash !== hashAccessToken(accessToken)) return res.status(404).json({ error: 'Order not found.' });
    if (fields.expiresAt?.toDate() < new Date()) return res.status(410).json({ error: 'This receipt link has expired.' });

    res.json({
      orderRef,
      receipt: fields.receipt || {},
      items: fields.items || [],
      total: fields.total || '0',
      createdAt: fields.createdAt?.toDate?.() || null,
      expiresAt: fields.expiresAt?.toDate?.() || null
    });
  } catch (error) {
    if (error.code === 404) return res.status(404).json({ error: 'Order not found.' });
    console.error('Error retrieving order:', error);
    res.status(500).json({ error: 'Could not retrieve order.' });
  }
});

// API Routes
app.post('/api/lists', async (req, res) => {
  try {
    const { name, email, listType, items, notes } = req.body;

    // Validate required fields
    if (!name || !email || !listType || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store in Firebase (optional backup)
    const { db, addDoc, collection, serverTimestamp, generateDiscountCode, saveDiscountCode } = await import('./src/utils/firebase.js');
    await addDoc(collection(db, 'lists'), {
      name,
      email,
      listType,
      items,
      notes: notes || '',
      timestamp: serverTimestamp(),
      status: 'pending'
    });

    // Handle volunteer verification and discount code generation
    let verificationResult = { verified: false };
    let discountCode = null;

    if (listType === 'Volunteer Sign-ups') {
      verificationResult = await verifyMemberByName(name);
      if (verificationResult.verified) {
        discountCode = generateDiscountCode();
        await saveDiscountCode(name, email, discountCode);
      }
    }

    // Add to Google Sheets if available
    if (sheets) {
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      if (spreadsheetId) {
        const values = [
          [
            new Date().toISOString(),
            name,
            email,
            listType,
            items.join('; '),
            notes || '',
            verificationResult.verified ? 'VERIFIED' : 'UNVERIFIED',
            discountCode || ''
          ]
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Lists!A:H',
          valueInputOption: 'RAW',
          resource: { values }
        });
      }
    }

    res.json({
      success: true,
      message: 'List submitted successfully',
      verification: verificationResult,
      discountCode: discountCode
    });
  } catch (error) {
    console.error('Error submitting list:', error);
    res.status(500).json({ error: 'Failed to submit list' });
  }
});

// Health check endpoint (for monitoring)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for all routes (SPA routing)
app.get('*', (req, res) => {
  const indexPath = join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).json({ error: 'Not found.' });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`ðŸŽ¯ FCC Website running at http://127.0.0.1:${PORT}`);
  console.log(`ðŸ“ Serving from: ${__dirname}/dist`);
  console.log(`ðŸ›‘ To stop the server, press Ctrl+C`);
});
