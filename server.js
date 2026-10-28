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
import { getFirestore as getAdminFirestore, Timestamp, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { PAGE_CONTENT } from './src/constants/pageContent.js';
import { validateTileLayout, validateSupporterTiles } from './src/utils/pageTiles.js';
import { PRODUCTS } from './src/constants/products.js';
import { calculateCart, expandClubYearLines, expandPeopleLines, NEXT_YEAR_LINE_SUFFIX } from './src/utils/pricing.js';
import { clubYearOf, clubYearDates, clubYearLabel, clubYearKind, resolveClubYearChoice, holdsForClubYear } from './src/utils/clubYear.js';
import { createClubYearSubscription } from './src/server/clubYearSubscription.js';
import { summariseVoucherCodes, voucherScope } from './src/utils/vouchers.js';
import { applyTripDiscounts, isTripEvent } from './src/utils/tripDiscount.js';
import { bookingsClosed } from './src/utils/eventRoster.js';
import { sanitizePerson, validateCheckout, membershipPartsNeeded, peopleGrantedMembership, lineMembershipRule, grantsMembership, contactEmail, isMembership, resolvedKind, withFamilyContacts, normaliseName, matchMembership } from './src/utils/checkout.js';
import { membershipActivity, renewalConfirmationOpen } from './src/utils/membership.js';
import { orderReport, membershipReport, subscriptionWarning } from './src/utils/adminReports.js';
import { readJustgoSync } from './src/server/justgoSync.js';
import { buildRawEmail } from './src/utils/mail.js';
import { buildReceiptSummary, buildLinkedReceipt, receiptEmailCopy, receiptEmailHtml } from './src/utils/receipt.js';
import { assertLocalFirebase } from './src/utils/localFirebase.js';
import { loadStripeSubscribers, importStripeSubscribers, nextClubYearEnd, cancelStripeSubscription, stripeSubscriberReport } from './src/utils/stripeReports.js';
import { resolveCatalogue, validateEventSchedule, eventScheduleLabel } from './src/utils/catalogue.js';
import { productLimits, remainingStock, isSoldOut, wantedQuantities, stockProblem, withHold, itemLabel, isMerchandise } from './src/utils/inventory.js';
import { deletionAuditEntry } from './src/utils/privacy.js';
import { CURRENT_MEMBERSHIP_VERSION } from './src/utils/schema.js';
import { householdForPerson, HOUSEHOLD_MEMBER_FIELDS, householdGroupKey } from './src/utils/households.js';
import { lineHolders, stripeItemLines, activeSubscriptionItems, subscriptionLive, endedAtCutoff, clubYearEndUpdate } from './src/utils/subscriptions.js';
import { registerGdprRoutes } from './src/server/gdpr.js';
import { registerPolicyRoutes, syncPolicies, currentCheckoutPolicies } from './src/server/policies.js';
import { isLive, liveReadinessProblems } from './src/utils/live.js';
import { allowedOrigins, isAllowedOrigin } from './src/utils/cors.js';
import { registerVolunteerRoutes } from './src/server/volunteers.js';
import { applyVolunteerBenefits, volunteerPrivileges } from './src/utils/volunteering.js';
import { allocateMemberIds } from './src/utils/memberIds.js';
import { allocateRecordIds, reserveRecordIds } from './src/utils/recordIds.js';
import { registerEmailCodeRoutes } from './src/server/emailCodes.js';
import { registerMyDetailsRoutes } from './src/server/myDetails.js';
import { registerClubNightRoutes } from './src/server/clubNight.js';
import { volunteerCancellationPhases } from './src/utils/volunteerCancellation.js';
import { registerBoathouseRoutes } from './src/server/boathouse.js';
import { registerAdminAccessRoutes } from './src/server/adminAccess.js';
import { registerEventRosterRoutes } from './src/server/eventRosters.js';
import { registerMemberCheckRoutes } from './src/server/memberChecks.js';
import { registerReceiptEmailRoutes } from './src/server/receiptEmail.js';
import { registerRenewalRoutes } from './src/server/renewals.js';
import { registerKeyAccessRoutes } from './src/server/keyAccess.js';
import { registerItemActionRoutes, orderSubscriptions } from './src/server/itemActions.js';
import { rateLimit, baselineRateLimit } from './src/server/rateLimit.js';
import { isClubEmail } from './src/utils/adminAccess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

const scheduleVolunteerCancellation = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!adminDb) return res.status(503).json({ error: 'Subscription storage is not configured.' });
    const reference = adminDb.collection('subscriptions').doc(req.params.id);
    const document = await reference.get();
    const item = document.data()?.items?.find((entry) => entry.lineId === req.params.lineId && entry.status === 'active');
    if (!item || !item.membershipIds?.length) return res.status(404).json({ error: 'Active monthly item not found.' });
    if (item.cancelScheduledAt) return res.status(409).json({ error: 'Cancellation is already scheduled for this item.' });
    if (![clubYearOf(), clubYearOf() + 1].includes(item.clubYear)) return res.status(409).json({ error: 'Only current or next-club-year benefits can be scheduled here.' });
    const members = new Map((await adminDb.getAll(...item.membershipIds.map((id) => adminDb.collection('memberships').doc(id))))
      .filter((member) => member.exists).map((member) => [member.id, member.data()]));
    const people = item.membershipIds.map((id) => ({ membershipId: id, lineIds: [item.lineId] }));
    const priced = applyVolunteerBenefits([{ id: item.productId, lineId: item.lineId, basePrice: item.monthlyAmount,
      clubYearPart: item.clubYear > clubYearOf() ? 'next' : 'this' }], people, members, await loadVolunteerBenefits());
    if (!priced[0].volunteerBenefit || priced[0].basePrice !== 0) return res.status(409).json({ error: 'Every holder must have this item as a free volunteer benefit for its club year.' });
    const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
    if (subscription.schedule) return res.status(409).json({ error: 'Stripe already has a schedule for this subscription. Manage that schedule in Stripe to preserve its other changes.' });
    // Validate before creating a Stripe schedule, which replaces the subscription's cancel_at.
    volunteerCancellationPhases(subscription, { current_phase: { start_date: subscription.current_period_start || subscription.items?.data?.[0]?.current_period_start } }, item.stripeItemId);
    const schedule = await stripeRequest('subscription_schedules', [['from_subscription', document.id]], 'POST',
      { idempotencyKey: `volunteer-cancel-${crypto.randomUUID()}` });
    const { params, endsAt } = volunteerCancellationPhases(subscription, schedule, item.stripeItemId);
    try {
      await stripeRequest(`subscription_schedules/${encodeURIComponent(schedule.id)}`, params, 'POST');
    } catch (error) {
      await stripeRequest(`subscription_schedules/${encodeURIComponent(schedule.id)}/release`, [['preserve_cancel_date', 'true']], 'POST');
      await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, [['cancel_at', String(subscription.cancel_at)], ['proration_behavior', 'none']], 'POST');
      throw error;
    }
    const cancelScheduledAt = Timestamp.fromMillis(endsAt * 1000);
    await reference.update({ items: document.data().items.map((entry) => entry.lineId === item.lineId
      ? { ...entry, cancelScheduledAt, cancellationScheduleId: schedule.id } : entry) });
    await adminDb.collection('adminSubscriptionAudit').add({ action: 'schedule-volunteer-benefit-cancellation',
      adminUid: admin.uid, stripeSubscriptionId: document.id, lineIds: [item.lineId], checkedAt: Timestamp.now(), cancelScheduledAt });
    res.json({ subscription: subscriptionView(await reference.get()), cancelScheduledAt: cancelScheduledAt.toDate().toISOString() });
  } catch (error) {
    console.error('Could not schedule volunteer benefit cancellation:', error.message);
    res.status(502).json({ error: `Could not schedule cancellation: ${error.message}` });
  }
};

// Cloud Run sits behind one Google front end; trusting that hop gives each visitor their own rate-limit bucket.
app.set('trust proxy', process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : (process.env.K_SERVICE ? 1 : false));
app.disable('x-powered-by');

const corsOrigins = allowedOrigins(process.env);
const allowLocalhostOrigins = !isLive() || process.env.LOCAL_FIREBASE_EMULATORS === 'true';
// Pages are framed by nobody; the full script/connect policy is report-only until it has been checked in browsers.
const PAGE_CSP_REPORT_ONLY = [
  "default-src 'self'", "script-src 'self' https://www.googletagmanager.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.google-analytics.com https://*.analytics.google.com https://*.run.app",
  "frame-src https://*.firebaseapp.com https://*.web.app", "form-action 'self' https://checkout.stripe.com"
].join('; ');

app.use(compression());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (/^\/(?:admin|api|order|my-details|check-ins|club-night|payment-success|_preview)(?:\/|$)/.test(req.path)) {
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  }
  if (req.path.startsWith('/api/')) {
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  } else {
    res.set('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    res.set('Content-Security-Policy-Report-Only', PAGE_CSP_REPORT_ONLY);
  }
  // Receipt links carry their access token in the URL: never cache them or leak them in a Referer header.
  if (/^\/(order\/|payment-success|api\/orders\/|api\/checkout-receipt)/.test(req.path)) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  }
  next();
});
app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin, corsOrigins, { allowLocalhost: allowLocalhostOrigins })),
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Email-Session', ...(process.env.LOCAL_FIREBASE_EMULATORS === 'true' ? ['X-Test-Now'] : [])],
  maxAge: 600
}));
// Cloud Run is the API origin; public page crawling belongs on Firebase Hosting.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});
app.use(express.static('dist'));
// Everything after static files (API and the SPA fallback) shares one per-visitor ceiling; routes add tighter limits.
app.use(baselineRateLimit);

const stripeRequest = async (path, params, method = 'POST', { idempotencyKey } = {}) => {
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  if (!secretKey.startsWith('sk_test_')) {
    throw new Error('Stripe checkout requires a test-mode secret key. Live payments are disabled.');
  }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    ...(method === 'GET' || !params ? {} : { body: new URLSearchParams(params) })
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Stripe request failed.'), { stripeCode: data.error?.code, stripeStatus: response.status });
  return data;
};

// Checkout is tied to a Stripe customer holding the email given at the start, so Stripe shows it read-only
// and subscriptions cannot end up under a different address from the order.
const stripeCustomerFor = async (email) => {
  const existing = await stripeRequest(`customers?${new URLSearchParams({ email, limit: '1' })}`, null, 'GET');
  return existing.data?.[0]?.id || (await stripeRequest('customers', [['email', email]])).id;
};

const customerId = (email) => crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');

/** Only configured frontend origins may receive Stripe's success and cancel redirects. */
const checkoutSiteOrigin = (req) => {
  const configuredSite = process.env.PUBLIC_SITE_URL || 'http://localhost:3000';
  let defaultOrigin = 'http://localhost:3000';
  try { defaultOrigin = new URL(configuredSite).origin; } catch { /* use the local default */ }
  const siteOrigins = [configuredSite, ...(process.env.PUBLIC_SITE_URLS || '').split(',')]
    .map((url) => { try { return new URL(url.trim()).origin; } catch { return ''; } })
    .filter(Boolean);
  const requestedOrigin = req.get('origin');
  return siteOrigins.includes(requestedOrigin) ? requestedOrigin : defaultOrigin;
};

const clubYearEnd = () => {
  const now = new Date();
  return new Date(now.getMonth() >= 2 ? now.getFullYear() + 1 : now.getFullYear(), 2, 1);
};

// Returns the person's existing membership, or a conflict when the details contradict a record.
const toMembershipRecord = (document) => {
  const data = document.data();
  return {
    id: document.id, affiliationNumber: data.affiliationNumber || '', email: data.email || '', householdId: data.householdId || '', dob: data.dob || '',
    firstName: data.firstName || '', lastName: data.lastName || '', status: data.status, validUntil: data.validUntil?.toMillis() || 0,
    membershipAccessEndsAt: data.membershipAccessEndsAt?.toMillis(),
    clubYears: Array.isArray(data.clubYears) ? data.clubYears.map(Number).filter(Number.isFinite) : [],
    justgo: data.justgoSyncStatus === 'synced' || data.renewalMethod === 'justgo',
    renewalMethod: data.renewalMethod || '', justgoSyncStatus: data.justgoSyncStatus || '', lastJustgoSync: data.lastJustgoSync?.toMillis() || 0,
    stripeMembershipSubscriptionId: data.stripeMembershipSubscriptionId || '', stripeMembershipMode: data.stripeMembershipMode || '',
    hasStripeMembershipReference: Object.hasOwn(data, 'stripeMembershipSubscriptionId'), history: Array.isArray(data.history) ? data.history : [],
    familyTier: data.membershipTier === 'family'
  };
};

/** Backfill one recurring membership subscription from old orders, never coaching subscriptions. */
const linkHistoricalStripeSubscription = async (member) => {
  if (member.stripeMembershipSubscriptionId || member.hasStripeMembershipReference || !member.history.length) return member;
  const orderRefs = [...new Set(member.history.map((entry) => entry.orderRef).filter((id) => typeof id === 'string' && id))].slice(-100);
  if (!orderRefs.length) return member;
  const orders = await adminDb.getAll(...orderRefs.map((id) => adminDb.collection('orders').doc(id)));
  const order = orders.find((document) => document.exists && document.data().stripeSubscriptionId
    && (document.data().items || []).some((item) => item.category === 'MEMBERSHIP' && item.type === 'subscription'))?.data();
  if (!order) {
    await adminDb.collection('memberships').doc(member.id).set({ stripeMembershipSubscriptionId: '', stripeMembershipMode: '' }, { merge: true });
    return { ...member, stripeMembershipSubscriptionId: '', stripeMembershipMode: '', hasStripeMembershipReference: true };
  }
  const stripeMode = order.stripeMode || (process.env.STRIPE_SECRET_KEY?.includes('_live_') ? 'live' : 'test');
  await adminDb.collection('memberships').doc(member.id).set({ stripeMembershipSubscriptionId: order.stripeSubscriptionId, stripeMembershipMode: stripeMode }, { merge: true });
  return { ...member, stripeMembershipSubscriptionId: order.stripeSubscriptionId, stripeMembershipMode: stripeMode, hasStripeMembershipReference: true };
};

const stripeSubscriptionIsActive = async (member) => {
  const linkedMember = await linkHistoricalStripeSubscription(member);
  if (!linkedMember.stripeMembershipSubscriptionId) return true;
  const mode = linkedMember.stripeMembershipMode || 'test';
  const secrets = [process.env.STRIPE_REPORT_SECRET_KEY, process.env.STRIPE_SECRET_KEY]
    .filter((secret) => /^(sk|rk)_(test|live)_/.test(secret || '') && secret.includes(`_${mode}_`));
  if (!secrets.length) throw new Error('Stripe subscription validation is not configured for this mode.');
  const subscription = await stripeReportRequest(secrets[0])(
    `subscriptions/${encodeURIComponent(linkedMember.stripeMembershipSubscriptionId)}?expand[]=customer&expand[]=latest_invoice.payment_intent.latest_charge`
  );
  const report = stripeSubscriberReport(subscription);
  // A club-year subscription ends at the 1 March boundary after covering the full February payment period.
  // Our club-year subscriptions wait as `trialing` until the first 1st.
  const clubYearWaiting = subscription.status === 'trialing' && subscription.metadata?.club_year && !subscription.pause_collection;
  return report.status === 'Active' || Boolean(clubYearWaiting) || (endedAtCutoff(subscription) && !report.paymentReversed);
};

const findMembership = async (person, now = new Date()) => {
  const memberships = adminDb.collection('memberships');
  const [byNumber, byEmail, households] = await Promise.all([
    person.affiliationNumber ? memberships.where('affiliationNumber', '==', person.affiliationNumber).limit(5).get() : null,
    memberships.where('email', '==', contactEmail(person)).limit(50).get(),
    adminDb.collection('households').where('email', '==', contactEmail(person)).limit(50).get()
  ]);
  const householdMembers = (await Promise.all(households.docs.map((household) =>
    memberships.where('householdId', '==', household.id).limit(50).get()
  ))).flatMap((snapshot) => snapshot.docs);
  const candidateDocuments = [...new Map([...byEmail.docs, ...(byNumber?.docs || []), ...householdMembers]
    .map((document) => [document.id, document])).values()];
  const otherHouseholdIds = [...new Set(candidateDocuments.map((document) => document.data().householdId)
    .filter((id) => id && !households.docs.some((household) => household.id === id)))];
  const otherHouseholds = otherHouseholdIds.length
    ? await adminDb.getAll(...otherHouseholdIds.map((id) => adminDb.collection('households').doc(id)))
    : [];
  const householdById = new Map([...households.docs, ...otherHouseholds].filter((document) => document.exists)
    .map((document) => [document.id, document.data()]));
  const asMatchRecord = (document) => {
    const data = document.data();
    return { ...toMembershipRecord(document), email: data.email || householdById.get(data.householdId)?.email || '', contactOnly: data.contactOnly === true };
  };
  const contactName = person.junior ? person.guardian.name : `${person.firstName} ${person.lastName}`;
  const matchingHouseholds = households.docs.filter((household) =>
    normaliseName(household.data().contactName) === normaliseName(contactName));
  const recordsById = new Map(candidateDocuments.map((document) => {
    const record = asMatchRecord(document);
    return [record.id, record];
  }));
  const result = matchMembership(person, {
    byNumber: (byNumber?.docs || []).map(asMatchRecord),
    byEmail: [...recordsById.values()]
  });
  const match = result.match;
  let stripeActive = true;
  try {
    if (match) stripeActive = await stripeSubscriptionIsActive(match);
  } catch (error) {
    console.error('Stripe subscription validation failed:', error.message);
    return { conflict: result.conflict, reason: result.reason, validationError: true, existing: null };
  }
  const activity = match ? membershipActivity(match, now) : 'inactive';
  return {
    conflict: result.conflict, reason: result.reason,
    contactHouseholdId: matchingHouseholds.length === 1 ? matchingHouseholds[0].id : '',
    existing: match ? { id: match.id, householdId: match.householdId, family: Boolean(match.familyTier && match.householdId),
      active: stripeActive && activity === 'active', awaitingRenewal: activity === 'awaiting-renewal', justgo: match.justgo, validUntil: match.validUntil, clubYears: match.clubYears || [], contactOnly: match.contactOnly } : null
  };
};

const recordPurchase = (transaction, { orderRef, order, vouchers, paidAt, householdSnapshots = new Map(), memberSnapshots = new Map() }) => {
  const paidYear = clubYearOf(paidAt.toDate());
  const membershipIds = [];
  const households = new Map();
  for (const person of order.people || []) {
    if (!person.householdId) continue;
    const group = households.get(person.householdId) || [];
    group.push(person);
    households.set(person.householdId, group);
  }
  for (const [householdId, people] of households) {
    const reference = adminDb.collection('households').doc(householdId);
    const existing = householdSnapshots.get(householdId)?.data();
    if (existing) {
      const junior = people.find((person) => person.junior);
      const update = { updatedAt: paidAt };
      if (junior && normaliseName(existing.contactName) === normaliseName(junior.guardian?.name) && junior.guardian?.relationship) {
        update.contactRelationship = junior.guardian.relationship;
      }
      transaction.set(reference, update, { merge: true });
    } else {
      const { id: _id, ...fields } = householdForPerson(people[0], householdId, paidAt);
      transaction.set(reference, fields);
    }
  }
  for (const person of order.people || []) {
    const lines = person.lineIds.map((id) => order.items.find((item) => item.lineId === id)).filter(Boolean);
    const yearOf = (item) => item.clubYear || paidYear;
    // Lines are per club year, so a renewal bought alongside this year's membership is a second membership line.
    const membershipLines = lines.filter(isMembership).sort((a, b) => yearOf(a) - yearOf(b));
    const membershipLine = membershipLines.at(-1);
    const grantedYears = Array.isArray(person.grantMembershipYears) ? person.grantMembershipYears : person.grantMembership ? [paidYear] : [];
    const includedLines = lines.filter((item) => grantsMembership(item) && grantedYears.includes(yearOf(item)));
    const includedLine = !membershipLine ? includedLines.at(-1) : null;
    const coveredYears = [...new Set([...membershipLines, ...includedLines].map(yearOf))].sort();
    // Membership runs to 1 March after the latest club year bought.
    const validUntil = coveredYears.length ? Timestamp.fromDate(clubYearDates(coveredYears.at(-1)).end) : null;
    const grantedTier = person.junior ? 'junior' : 'adult';
    // Event tickets stay in the purchase history; privileges are ongoing entitlements for their club year.
    const privileges = lines.filter((item) => !isMembership(item) && item.category !== 'EVENTS')
      .map((item) => ({ productId: item.id, name: item.name, type: item.type, orderRef, grantedAt: paidAt, ...(item.lineId ? { lineId: item.lineId } : {}),
        ...(item.clubYear ? { clubYear: item.clubYear } : {}) }));
    const historyEntry = { orderRef, paidAt, items: lines.map((item) => ({ id: item.id, name: item.name, price: item.price, ...(item.clubYear ? { clubYear: item.clubYear } : {}) })) };
    const { id, lineIds, membershipId, existingMember, householdId, ownKitLineIds, grantMembership: _grant, grantMembershipYears: _years, heldClubYears: _held, subscriptionGroup: _group, ...details } = person;
    for (const key of HOUSEHOLD_MEMBER_FIELDS) delete details[key];
    membershipIds.push(membershipId);
    const previous = memberSnapshots.get(membershipId)?.data();
    transaction.set(adminDb.collection('memberships').doc(membershipId), {
      ...(existingMember ? {} : {
        ...details, source: 'website', renewalMethod: 'website', createdAt: paidAt, searchName: normaliseName(`${person.firstName} ${person.lastName}`)
      }),
      // Non-members booking open events are kept as contact-only records until they buy a membership.
      ...(membershipLine || includedLine ? { contactOnly: FieldValue.delete() } : existingMember ? {} : { contactOnly: true }),
      schemaVersion: CURRENT_MEMBERSHIP_VERSION,
      ...(householdId ? { householdId } : {}),
      ...Object.fromEntries(HOUSEHOLD_MEMBER_FIELDS.map((key) => [key, FieldValue.delete()])),
      // Consent is recorded against the wording version shown at checkout; the disclaimer is re-accepted on every purchase.
      consents: {
        disclaimer: { ...order.policyVersions?.disclaimer, acceptedAt: paidAt, by: person.junior ? 'guardian' : 'self' },
        ...(existingMember ? {} : { photoVideo: { ...order.policyVersions?.photoVideo, accepted: person.photoConsent === true, recordedAt: paidAt, by: person.junior ? 'guardian' : 'self' } })
      },
      ...(membershipLine || includedLine ? { status: 'active', validUntil, clubYears: FieldValue.arrayUnion(...new Set([...(person.heldClubYears || []), ...coveredYears])), membershipTier: membershipLine ? membershipLine.membershipTier || '' : grantedTier, justgoSyncStatus: 'pending', renewalMethod: 'website', justgoUpload: { status: 'queued', attempts: 0, failures: 0, needsStaff: false, mode: (person.affiliationNumber || existingMember) ? 'invite' : 'new', nextAttemptAt: paidAt, queuedAt: paidAt } } : {}),
      ...(membershipLine || includedLine ? { membershipAccessEndsAt: FieldValue.delete() } : {}),
      ...(previous && previous.source !== 'website' && previous.validUntil && !previous.membershipBeforeWebsite
        ? { membershipBeforeWebsite: { validUntil: previous.validUntil, source: previous.source || 'imported' } } : {}),
      // A monthly membership is linked to its subscription once that is set up after payment (setUpSubscriptions).
      ...(membershipLine && !membershipLine.monthly
        ? { stripeMembershipSubscriptionId: '', stripeMembershipMode: '' }
        : {}),
      ...(includedLine ? { stripeMembershipSubscriptionId: '', stripeMembershipMode: '', membershipIncludedWith: { productId: includedLine.id, name: includedLine.name, orderRef } } : {}),
      ...(privileges.length ? { privileges: FieldValue.arrayUnion(...privileges) } : {}),
      ...(lines.some((item) => item.id === 'keyhire') ? { keyAccess: { grantedAt: paidAt, source: 'purchase' } } : {}),
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

const createFirestoreOrder = async ({ orderRef, email, items, total, status, stripeSessionId = '', discountCodeId = null, people = [], siteUrl = '', billingMode = 'annual', receiptViewTokenHash = '', stockProductIds = [], policyVersions = null, subscriptionPlan = null }) => {
  if (!adminDb) throw new Error('Firebase Admin SDK is not configured.');
  await adminDb.collection('orders').doc(orderRef).create({
    email: email.toLowerCase(),
    items,
    people,
    stockProductIds,
    policyVersions,
    total: String(total),
    status,
    stripeSessionId,
    siteUrl,
    billingMode,
    receiptViewTokenHash,
    discountCodeId,
    ...(subscriptionPlan ? { subscriptionPlan } : {}),
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + ORDER_ACCESS_DAYS * 24 * 60 * 60 * 1000))
  });
};
const updateFirestoreOrder = async (orderRef, fields) => {
  if (!adminDb) throw new Error('Firebase Admin SDK is not configured.');
  await adminDb.collection('orders').doc(orderRef).update(fields);
};

const stockReference = (productId) => adminDb.collection('stock').doc(productId);
const limitedProductIds = (items) => [...new Set(items.filter((item) => item.category === 'EVENTS' || isMerchandise(item)).map((item) => item.id))];
const readStock = (transaction, productIds) => productIds.length
  ? transaction.getAll(...productIds.map(stockReference))
  : Promise.resolve([]);
const dropHold = (transaction, snapshot, orderRef) => {
  if (snapshot.data()?.holds?.[orderRef]) transaction.update(snapshot.ref, new FieldPath('holds', orderRef), FieldValue.delete());
};

/** Takes stock for every limited line in one transaction; throws a `soldOut` error when any line cannot be supplied. */
const reserveStock = async (orderRef, selected, catalog) => {
  const productIds = limitedProductIds(selected).filter((id) => productLimits(catalog.find((product) => product.id === id)));
  if (!productIds.length) return [];
  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await readStock(transaction, productIds);
    const now = Date.now();
    snapshots.forEach((snapshot, index) => {
      const product = catalog.find((candidate) => candidate.id === productIds[index]);
      const holds = snapshot.data()?.holds || {};
      const wanted = wantedQuantities(selected.filter((line) => line.id === product.id));
      const problem = stockProblem(product, holds, wanted, now);
      if (problem) throw Object.assign(new Error(problem), { soldOut: true, productId: product.id });
      transaction.set(snapshot.ref, { holds: withHold(holds, orderRef, wanted, now) });
    });
  });
  return productIds;
};

const releaseStock = (orderRef, productIds) => productIds.length ? adminDb.runTransaction(async (transaction) => {
  const snapshots = await readStock(transaction, productIds);
  snapshots.forEach((snapshot) => dropHold(transaction, snapshot, orderRef));
}) : Promise.resolve();

/** Terminal checkout failures update status but keep the saved order for support and retries. */
const recordUnsuccessfulCheckout = async (session, status) => {
  const orderRef = session.metadata?.order_ref;
  if (!orderRef || !adminDb) return;
  await adminDb.runTransaction(async (transaction) => {
    const orderDocument = adminDb.collection('orders').doc(orderRef);
    const document = await transaction.get(orderDocument);
    if (!document.exists) throw new Error('Order not found for unsuccessful Checkout Session.');
    const order = document.data();
    if (order.stripeSessionId !== session.id) throw new Error('Checkout Session does not match the order.');
    if (order.status !== 'pending') return;
    const discountDocument = order.discountCodeId ? adminDb.collection('discountCodes').doc(order.discountCodeId) : null;
    const discount = discountDocument ? (await transaction.get(discountDocument)).data() : null;
    const stock = await readStock(transaction, order.stockProductIds || []);
    stock.forEach((snapshot) => dropHold(transaction, snapshot, orderRef));
    const timestamp = Timestamp.now();
    transaction.update(orderDocument, { status, ...(status === 'expired' ? { expiredAt: timestamp } : { paymentFailedAt: timestamp }) });
    if (discountDocument && discount?.reservedByOrder === orderRef && !discount.used) {
      transaction.update(discountDocument, { reservedByOrder: null, reservedUntil: null });
    }
  });
};

/** A declined PaymentIntent stays pending because Stripe Checkout can still retry it. */
const recordPaymentFailureAttempt = async (intent) => {
  const orderRef = intent.metadata?.order_ref;
  if (!orderRef || !adminDb) return;
  const orderDocument = adminDb.collection('orders').doc(orderRef);
  await adminDb.runTransaction(async (transaction) => {
    const document = await transaction.get(orderDocument);
    if (!document.exists || document.data().stripePaymentIntentId === intent.id && document.data().status === 'paid') return;
    transaction.update(orderDocument, {
      lastPaymentFailureAt: Timestamp.now(),
      lastPaymentFailureCode: intent.last_payment_error?.code || '',
      lastPaymentFailureDeclineCode: intent.last_payment_error?.decline_code || ''
    });
  });
};

/**
 * Marks a pending order paid and writes its membership records, vouchers and stock holds.
 * Returns the order with its receipt access token, or null when it was already fulfilled.
 */
const fulfilOrder = async ({ orderRef, sessionId, amountTotal, paymentIntent = '', setupIntent = '' }) => {
  const accessToken = createAccessToken();
  const fields = await adminDb.runTransaction(async (transaction) => {
    const orderDocument = adminDb.collection('orders').doc(orderRef);
    const document = await transaction.get(orderDocument);
    if (!document.exists) throw new Error('Order not found.');
    const order = document.data();
    if (order.stripeSessionId !== sessionId || Math.round(Number(order.total) * 100) !== amountTotal) {
      throw new Error('Payment does not match the order.');
    }
    if (order.emailSent === true) return null;
    if (order.emailSendingUntil?.toMillis() > Date.now()) throw new Error('Receipt delivery is already in progress.');
    const stock = await readStock(transaction, order.stockProductIds || []);
    const discountDocument = order.discountCodeId ? adminDb.collection('discountCodes').doc(order.discountCodeId) : null;
    const discount = discountDocument ? (await transaction.get(discountDocument)).data() : null;
    const memberIds = [...new Set((order.people || []).map((person) => person.membershipId).filter(Boolean))];
    const memberDocuments = memberIds.length
      ? await transaction.getAll(...memberIds.map((id) => adminDb.collection('memberships').doc(id)))
      : [];
    const memberHouseholds = new Map(memberDocuments.filter((member) => member.exists)
      .map((member) => [member.id, member.data().householdId || '']));
    const groups = new Map();
    for (const person of order.people || []) {
      const key = householdGroupKey(person);
      const group = groups.get(key) || [];
      group.push(person);
      groups.set(key, group);
    }
    const unlinkedGroups = [];
    for (const group of groups.values()) {
      const householdIds = [...new Set(group.map((person) => person.householdId || memberHouseholds.get(person.membershipId)).filter(Boolean))];
      if (householdIds.length > 1) throw new Error('Checkout people reference different households.');
      if (householdIds.length) group.forEach((person) => { person.householdId = householdIds[0]; });
      else unlinkedGroups.push(group);
    }
    const householdReservation = await reserveRecordIds(adminDb, transaction, 'households', unlinkedGroups.length);
    unlinkedGroups.forEach((group, index) => group.forEach((person) => { person.householdId = householdReservation.ids[index]; }));
    const householdIds = [...new Set((order.people || []).map((person) => person.householdId).filter(Boolean))];
    const householdDocuments = householdIds.length
      ? await transaction.getAll(...householdIds.map((id) => adminDb.collection('households').doc(id)))
      : [];
    const householdSnapshots = new Map(householdDocuments.map((household) => [household.id, household]));
    if (discount?.singleUse && discount.used && discount.usedByOrder !== orderRef) throw new Error('Voucher has already been redeemed.');
    householdReservation.save();
    const vouchers = order.vouchers || (order.items || []).filter((item) => item.type === 'voucher').map((item) => ({
      code: `FCC-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,
      name: item.name,
      productId: item.id,
      scope: voucherScope(item),
      value: item.voucherValue,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
    }));
    if (!order.vouchers) {
      for (const voucher of vouchers) {
        transaction.create(adminDb.collection('discountCodes').doc(voucher.code), {
          code: voucher.code, label: voucher.name, discountType: 'credit', discountValue: voucher.value,
          ...(voucher.productId ? { sourceProductId: voucher.productId } : {}),
          productIds: voucher.scope.productIds, categories: voucher.scope.categories,
          used: false, singleUse: true, excludedCategories: ['MEMBERSHIP'],
          orderRef, email: order.email, createdAt: Timestamp.now(), expiresAt: voucher.expiresAt
        });
      }
    }
    if (discount?.singleUse) transaction.update(discountDocument, { used: true, usedByOrder: orderRef, usedAt: Timestamp.now() });
    // Paid stock holds never lapse; rebuilt from the order in case the reservation was already cleared.
    stock.forEach((snapshot) => transaction.set(snapshot.ref, {
      holds: withHold(snapshot.data()?.holds || {}, orderRef, wantedQuantities(order.items.filter((item) => item.id === snapshot.id)), Date.now(), null)
    }));
    const paidAt = order.paidAt || Timestamp.now();
    if (!order.recordsWritten) recordPurchase(transaction, { orderRef, order, vouchers, paidAt, householdSnapshots,
      memberSnapshots: new Map(memberDocuments.map((document) => [document.id, document])) });
    transaction.update(orderDocument, {
      people: order.people || [],
      status: 'paid', vouchers, accessTokenHash: hashAccessToken(accessToken), recordsWritten: true,
      stripePaymentIntentId: paymentIntent, ...(setupIntent ? { stripeSetupIntentId: setupIntent } : {}),
      paidAt,
      emailSendingUntil: Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000))
    });
    return { ...order, vouchers };
  });
  return fields && { ...fields, accessToken };
};

/** Lets newly-qualified volunteers know the boathouse code, then emails the receipt. */
const deliverOrder = async (orderRef, fields) => {
  // A volunteer who was inducted before joining gets their code once this purchase makes them a member.
  try {
    await settleVolunteersFor([fields.email, ...(fields.people || []).map(contactEmail)].map(normalizeEmail));
    for (const id of new Set((fields.people || []).map((person) => person.membershipId).filter(Boolean))) {
      await settleKeyAccess(adminDb.collection('memberships').doc(id));
    }
  }
  catch (error) { console.error('Could not check volunteer codes after payment:', error.message); }
  try {
    const emailSent = await sendOrderEmail({ email: fields.email, orderRef, accessToken: fields.accessToken, items: fields.items, people: fields.people, total: fields.total,
      vouchers: fields.vouchers, siteUrl: fields.siteUrl, billingMode: fields.billingMode });
    await updateFirestoreOrder(orderRef, { emailSent, emailSendingUntil: null, ...(emailSent ? { emailSentAt: Timestamp.now() } : {}) });
    if (!emailSent) throw new Error('Receipt email is not configured.');
  } catch (error) {
    await updateFirestoreOrder(orderRef, { emailSendingUntil: null });
    throw error;
  }
};

// While a club-year subscription waits for its first debit, its period ends at that debit.
const periodEnd = (subscription) => subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end || 0;
const stripeId = (value) => value?.id || value || '';
const unixSeconds = (timestamp) => Math.floor(timestamp.toMillis() / 1000);

// Card and bank-account fingerprints stay the same when the same details are entered again at a later checkout.
const paymentFingerprint = async (id) => {
  if (!id) return '';
  const method = await stripeRequest(`payment_methods/${encodeURIComponent(id)}`, null, 'GET');
  return method.card?.fingerprint || method.bacs_debit?.fingerprint || method.sepa_debit?.fingerprint || method.id;
};

const monthlyPriceParams = (prefix, item, product) => {
  const key = (name) => prefix ? `${prefix}[price_data]${name}` : `price_data${name}`;
  return [[key('[currency]'), 'gbp'], [key('[product]'), product],
    [key('[unit_amount]'), String(Math.round(Number(item.monthlyAmount ?? item.price) * 100))], [key('[recurring][interval]'), 'month']];
};

/**
 * Starts or joins one club year's monthly payments for a paid order. Checkout took the joining share of the current
 * month and saved the card or bank account; debits then run on the 1st from `firstDebitAt` and the subscription is
 * cancelled at the club-year end (1 March), so the last debit is 1 February. Items paid with the same details
 * as a live subscription for the same club year join it, so they share one debit; different details may belong to
 * someone else, so they get their own subscription.
 */
const setUpSubscriptionGroup = async ({ order, orderRef, group, lineById, paymentMethod, customer, fingerprint }) => {
  const firstDebit = unixSeconds(group.firstDebitAt);
  const subscriptionEnd = unixSeconds(group.cutoffAt);
  const debitPassed = firstDebit <= Date.now() / 1000;
  const owned = await adminDb.collection('subscriptions').where('email', '==', order.email).where('status', '==', 'active').limit(20).get();
  let target = null;
  let otherLive = false;
  for (const document of owned.docs.filter((candidate) => candidate.data().clubYear === group.clubYear)) {
    const candidate = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
    if (!subscriptionLive(candidate)) continue;
    if (await paymentFingerprint(stripeId(candidate.default_payment_method)) === fingerprint) {
      target = candidate;
      break;
    }
    otherLive = true;
  }
  const products = new Map();
  for (const lineId of group.lineIds) {
    products.set(lineId, (await stripeRequest('products', [['name', itemLabel(lineById.get(lineId))], ['metadata[line_id]', lineId]], 'POST',
      { idempotencyKey: `${orderRef}-${lineId}-product` })).id);
  }
  const itemMetadata = (prefix, lineId) => [[`${prefix}[line_id]`, lineId], [`${prefix}[order_ref]`, orderRef], [`${prefix}[club_year]`, String(group.clubYear)]];
  if (target) {
    const endUpdate = clubYearEndUpdate(target, group.clubYear, subscriptionEnd);
    if (endUpdate) target = await stripeRequest(`subscriptions/${encodeURIComponent(target.id)}`, endUpdate, 'POST',
      { idempotencyKey: `${target.id}-club-year-end-${group.clubYear}-${subscriptionEnd}` });
    // A missed 1st (a delayed bank payment) is charged pro rata on the next debit; otherwise the next debit is a full month.
    for (const lineId of group.lineIds) {
      await stripeRequest('subscription_items', [['subscription', target.id], ['proration_behavior', debitPassed && target.status === 'active' ? 'create_prorations' : 'none'],
        ...monthlyPriceParams('', lineById.get(lineId), products.get(lineId)), ...itemMetadata('metadata', lineId)], 'POST', { idempotencyKey: `${orderRef}-${lineId}-item` });
    }
    return { subscription: await stripeRequest(`subscriptions/${encodeURIComponent(target.id)}`, null, 'GET'), created: false };
  }
  const base = [['customer', customer], ['default_payment_method', paymentMethod], ['metadata[order_ref]', orderRef],
    ['metadata[club_year]', String(group.clubYear)], ['metadata[cutoff_at]', String(subscriptionEnd)],
    ...group.lineIds.flatMap((lineId, index) => [...monthlyPriceParams(`items[${index}]`, lineById.get(lineId), products.get(lineId)),
      ...itemMetadata(`items[${index}][metadata]`, lineId)])];
  const subscription = await createClubYearSubscription(stripeRequest, {
    base, firstDebit, subscriptionEnd, orderRef, clubYear: group.clubYear
  });
  return { subscription, created: true, newPaymentDetails: otherLive };
};

/**
 * Records the monthly items on a paid order against the payer's subscriptions, one per club year. Each item records
 * which members receive it. Safe to repeat: a recorded plan is skipped and Stripe calls use idempotency keys. A change
 * Stripe refuses is marked failed for staff rather than retried.
 */
const setUpSubscriptions = async (orderRef) => {
  const orderReference = adminDb.collection('orders').doc(orderRef);
  const order = (await orderReference.get()).data();
  const plan = order?.subscriptionPlan;
  if (order?.status !== 'paid' || !plan || plan.recordedAt) return;
  const lineById = new Map(order.items.map((item) => [item.lineId, item]));
  const now = Timestamp.now();
  const results = [];
  let next;
  try {
    const intent = order.stripePaymentIntentId
      ? await stripeRequest(`payment_intents/${encodeURIComponent(order.stripePaymentIntentId)}`, null, 'GET')
      : order.stripeSetupIntentId ? await stripeRequest(`setup_intents/${encodeURIComponent(order.stripeSetupIntentId)}`, null, 'GET') : null;
    const paymentMethod = stripeId(intent?.payment_method);
    if (!paymentMethod) throw new Error('Stripe did not save a payment method at checkout.');
    const customer = stripeId(intent.customer) || await stripeCustomerFor(order.email);
    const fingerprint = await paymentFingerprint(paymentMethod);
    for (const group of plan.groups || []) {
      const result = await setUpSubscriptionGroup({ order, orderRef, group, lineById, paymentMethod, customer, fingerprint });
      results.push({ group, ...result });
    }
    const batch = adminDb.batch();
    const memberItems = new Map();
    for (const { group, subscription, created } of results) {
      const itemIds = stripeItemLines(subscription, group.lineIds);
      const items = group.lineIds.map((lineId) => {
        const line = lineById.get(lineId);
        return { lineId, orderRef, productId: line?.id || '', name: line?.name || '', monthlyAmount: Number(line?.monthlyAmount ?? line?.price ?? 0),
          clubYear: group.clubYear, stripeItemId: itemIds.get(lineId) || '', ...lineHolders(lineId, order.people), status: 'active' };
      });
      const membershipIds = [...new Set(items.flatMap((item) => item.membershipIds))];
      const names = [...new Set(items.flatMap((item) => item.names))];
      batch.set(adminDb.collection('subscriptions').doc(subscription.id), {
        email: order.email, stripeMode: order.stripeMode || 'test', status: 'active', updatedAt: now, clubYear: group.clubYear,
        firstDebitAt: group.firstDebitAt, cancelAt: group.cutoffAt,
        orderRefs: FieldValue.arrayUnion(orderRef), items: FieldValue.arrayUnion(...items),
        ...(membershipIds.length ? { membershipIds: FieldValue.arrayUnion(...membershipIds) } : {}),
        ...(names.length ? { names: FieldValue.arrayUnion(...names) } : {}),
        ...(created ? { orderRef, createdAt: now } : {})
      }, { merge: true });
      batch.set(adminDb.collection('customers').doc(customerId(order.email)), { subscriptionIds: FieldValue.arrayUnion(subscription.id) }, { merge: true });
      for (const membershipId of membershipIds) {
        // Members see what they receive and who pays for it, even when the subscription belongs to someone else.
        const received = items.filter((item) => item.membershipIds.includes(membershipId)).map(({ lineId, productId, name, monthlyAmount, clubYear }) => ({
          subscriptionId: subscription.id, lineId, orderRef, productId, name, monthlyAmount, clubYear, payerEmail: order.email, status: 'active', startedAt: order.paidAt || now }));
        const entry = memberItems.get(membershipId) || { subscriptionIds: [], received: [], membershipSubscription: null };
        entry.subscriptionIds.push(subscription.id);
        entry.received.push(...received);
        // The latest club year's membership subscription is the one checked when the member buys again.
        if (received.some((item) => lineById.get(item.lineId)?.category === 'MEMBERSHIP')
          && (!entry.membershipSubscription || entry.membershipSubscription.clubYear < group.clubYear)) {
          entry.membershipSubscription = { id: subscription.id, clubYear: group.clubYear };
        }
        memberItems.set(membershipId, entry);
      }
    }
    for (const [membershipId, entry] of memberItems) {
      batch.set(adminDb.collection('memberships').doc(membershipId), {
        subscriptionIds: FieldValue.arrayUnion(...entry.subscriptionIds), subscriptionItems: FieldValue.arrayUnion(...entry.received),
        ...(entry.membershipSubscription ? { stripeMembershipSubscriptionId: entry.membershipSubscription.id, stripeMembershipMode: order.stripeMode || 'test' } : {}) }, { merge: true });
    }
    await batch.commit();
    const groups = (plan.groups || []).map((group) => {
      const result = results.find((candidate) => candidate.group === group);
      return { ...group, stripeSubscriptionId: result.subscription.id, created: result.created, ...(result.newPaymentDetails ? { newPaymentDetails: true } : {}) };
    });
    next = { ...plan, groups, status: 'active', recordedAt: now,
      stripeItemIds: Object.fromEntries(results.flatMap(({ group, subscription }) => [...stripeItemLines(subscription, group.lineIds)])),
      ...(groups.some((group) => group.newPaymentDetails) ? { newPaymentDetails: true } : {}) };
  } catch (error) {
    console.error('Could not set up the monthly payments on %s: %s', orderRef, error.message);
    next = { ...plan, status: 'failed', error: error.message.slice(0, 300), recordedAt: now,
      ...(results.length ? { partialSubscriptionIds: results.map(({ subscription }) => subscription.id) } : {}) };
  }
  const subscriptionFor = new Map((next.groups || []).filter((group) => group.stripeSubscriptionId)
    .flatMap((group) => group.lineIds.map((lineId) => [lineId, group.stripeSubscriptionId])));
  await orderReference.update({
    subscriptionPlan: next,
    stripeSubscriptionIds: [...new Set(subscriptionFor.values())],
    subscriptionSetupNeedsStaff: next.status === 'failed',
    items: order.items.map((item) => subscriptionFor.has(item.lineId)
      ? { ...item, stripeSubscriptionId: subscriptionFor.get(item.lineId), stripeSubscriptionItemId: next.stripeItemIds?.[item.lineId] || '' } : item)
  });
};

/**
 * Subscriptions are cancelled at the club-year end. Stripe stops retrying a failed 1 February debit then, so its
 * unpaid invoice is voided (no later collection) and the subscription is flagged for staff. Any other ending (Stripe
 * giving up on failed payments, or a cancellation outside this site) is flagged too.
 */
const recordSubscriptionEnded = async (subscription) => {
  if (!adminDb) return;
  const reference = adminDb.collection('subscriptions').doc(subscription.id);
  const document = await reference.get();
  if (!document.exists) return;
  const atCutoff = endedAtCutoff(subscription);
  const voided = [];
  if (atCutoff) {
    const open = await stripeRequest(`invoices?${new URLSearchParams({ subscription: subscription.id, status: 'open', limit: '20' })}`, null, 'GET');
    for (const invoice of open.data || []) {
      await stripeRequest(`invoices/${encodeURIComponent(invoice.id)}/void`, [], 'POST', { idempotencyKey: `${invoice.id}-void` });
      voided.push({ id: invoice.id, amountDue: (invoice.amount_due || 0) / 100 });
    }
  }
  const data = document.data();
  const now = Timestamp.now();
  await reference.set({
    ...(data.status === 'active' ? { status: 'ended' } : {}),
    endedAt: subscription.ended_at ? Timestamp.fromMillis(subscription.ended_at * 1000) : now, endedAtCutoff: atCutoff, updatedAt: now,
    ...(voided.length ? { voidedInvoices: voided } : {}),
    ...((voided.length || (!atCutoff && data.status === 'active')) ? { needsStaff: true } : {})
  }, { merge: true });
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
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      await recordUnsuccessfulCheckout(event.data.object, event.type === 'checkout.session.expired' ? 'expired' : 'payment_failed');
      return res.json({ received: true });
    }
    if (event.type === 'payment_intent.payment_failed') {
      await recordPaymentFailureAttempt(event.data.object);
      return res.json({ received: true });
    }
    if (event.type === 'customer.subscription.deleted') {
      await recordSubscriptionEnded(event.data.object);
      return res.json({ received: true });
    }
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const session = event.data.object;
      if (!['paid', 'no_payment_required'].includes(session.payment_status)) return res.json({ received: true });
      const orderRef = session.metadata?.order_ref;
      if (!orderRef || !adminDb) return res.status(400).send('Order metadata is missing.');
      // Setup-mode sessions (nothing due now, monthly payments to come) have no amount.
      const fields = await fulfilOrder({ orderRef, sessionId: session.id, amountTotal: session.amount_total ?? 0, paymentIntent: stripeId(session.payment_intent),
        setupIntent: stripeId(session.setup_intent), stripeMode: session.livemode ? 'live' : 'test' });
      if (fields) await deliverOrder(orderRef, fields);
      await setUpSubscriptions(orderRef);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    res.status(500).send('Payment processing could not complete.');
  }
});

app.use(express.json({ limit: '100kb' }));

// Google Sheets API Setup
let sheets;
let adminDb;
let adminAuth;
let gmailApi;
let driveApi;
let sheetsApi;
const localFirebase = process.env.LOCAL_FIREBASE_EMULATORS === 'true';
if (localFirebase) assertLocalFirebase(process.env);
// Flow tests check the club-year sale windows by sending `X-Test-Now`; only the local emulator stack honours it.
const requestNow = (req) => {
  const requested = localFirebase ? Date.parse(req.get('x-test-now') || '') : NaN;
  return Number.isFinite(requested) ? new Date(requested) : new Date();
};
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
      // Domain-wide delegation only works when the impersonated user is passed as a client option.
      clientOptions: { subject: process.env.GOOGLE_WORKSPACE_DELEGATED_USER || undefined },
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
const generateOrderRef = () => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const randomValue = crypto.randomInt(0, alphabet.length ** 8);
  return `FCC-${randomValue.toString(alphabet.length).toUpperCase().padStart(8, '0')}`;
};
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
    // checkRevoked makes a removed admin lose API access straight away rather than when their token expires.
    const decoded = await adminAuth.verifyIdToken(token, true);
    if (decoded.admin !== true || !isClubEmail(decoded.email)) {
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
    const recordId = req.query.recordId;
    if (recordId !== undefined && (typeof recordId !== 'string' || !/^[\w-]{1,128}$/.test(recordId))) {
      return res.status(400).json({ error: 'Invalid record ID.' });
    }
    let query = source.orderBy(FieldPath.documentId()).limit(101);
    if (recordId) query = query.where(FieldPath.documentId(), '==', recordId);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const documents = snapshot.docs.slice(0, 100);
    let members = new Map();
    let households = new Map();
    if (req.query.kind !== 'members') {
      const ids = [...new Set(documents.flatMap((document) => (document.data().people || []).map((person) => person.membershipId)).filter(Boolean))];
      if (ids.length) members = new Map((await adminDb.getAll(...ids.map((id) => adminDb.collection('memberships').doc(id)))).filter((document) => document.exists).map((document) => [document.id, document.data()]));
    }
    const householdIds = [...new Set((req.query.kind === 'members'
      ? documents.map((document) => document.data().householdId)
      : [...members.values()].map((member) => member.householdId)).filter(Boolean))];
    if (householdIds.length) {
      households = new Map((await adminDb.getAll(...householdIds.map((id) => adminDb.collection('households').doc(id))))
        .filter((document) => document.exists).map((document) => [document.id, document.data()]));
      if (req.query.kind !== 'members') {
        members = new Map([...members].map(([id, member]) => [id, { ...member, household: households.get(member.householdId) || {} }]));
      }
    }
    const now = new Date();
    const justgoSync = req.query.kind === 'members' ? await readJustgoSync(adminDb, now) : null;
    const records = documents.filter((document) => req.query.kind !== 'members' || document.data().contactOnly !== true).map((document) => (req.query.kind === 'members'
      ? membershipReport(document.id, document.data(), now, households.get(document.data().householdId) || {}, justgoSync)
      : orderReport(document.id, document.data(), members)));
    res.json({ records: eventReport ? records.filter((record) => record.items.some((item) => item.category === 'EVENTS'))
      .map((record) => ({ ...record, orderTotal: record.total, items: record.items.filter((item) => item.category === 'EVENTS'),
        total: record.items.filter((item) => item.category === 'EVENTS').reduce((sum, item) => sum + (item.price || 0), 0) })) : records,
      nextCursor: snapshot.size > 100 ? documents.at(-1).id : null, ...(justgoSync ? { justgoSync } : {}) });
  } catch (error) {
    console.error('Admin report failed:', error.message);
    res.status(500).json({ error: 'Could not retrieve report.' });
  }
});

const isoTime = (value) => value?.toDate ? value.toDate().toISOString() : value || '';
const subscriptionView = (document) => {
  const data = document.data();
  return { id: document.id, ...data, createdAt: isoTime(data.createdAt), updatedAt: isoTime(data.updatedAt), cancelledAt: isoTime(data.cancelledAt),
    items: (data.items || []).map((item) => ({ ...item, cancelledAt: isoTime(item.cancelledAt), cancelScheduledAt: isoTime(item.cancelScheduledAt) })) };
};

app.get('/api/admin/subscriptions', rateLimit(60, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    if (!adminDb) return res.status(503).json({ error: 'Subscription storage is not configured.' });
    const subscriptions = adminDb.collection('subscriptions');
    const text = (name) => typeof req.query[name] === 'string' ? req.query[name].trim().slice(0, 254) : '';
    const query = text('orderRef') ? subscriptions.where('orderRefs', 'array-contains', text('orderRef'))
      : text('membershipId') ? subscriptions.where('membershipIds', 'array-contains', text('membershipId'))
      : text('email') ? subscriptions.where('email', '==', normalizeEmail(text('email'))) : null;
    if (!query) return res.status(400).json({ error: 'Choose an order, member or customer.' });
    const snapshot = await query.limit(50).get();
    const items = snapshot.docs.flatMap((document) => document.data().items || []);
    const ids = [...new Set(items.flatMap((item) => item.membershipIds || []))];
    const records = ids.length ? await adminDb.getAll(...ids.map((id) => adminDb.collection('memberships').doc(id))) : [];
    const members = new Map(records.filter((document) => document.exists).map((document) => [document.id, document.data()]));
    const tiers = await loadVolunteerBenefits();
    const volunteerCancellableLineIds = items.filter((item) => {
      if (!item.membershipIds?.length || ![clubYearOf(), clubYearOf() + 1].includes(item.clubYear)) return false;
      const priced = applyVolunteerBenefits([{ id: item.productId, lineId: item.lineId, basePrice: item.monthlyAmount,
        clubYearPart: item.clubYear > clubYearOf() ? 'next' : 'this' }],
      item.membershipIds.map((id) => ({ membershipId: id, lineIds: [item.lineId] })), members, tiers)[0];
      return item.status === 'active' && !item.cancelScheduledAt && priced.volunteerBenefit && priced.basePrice === 0;
    }).map((item) => item.lineId);
    const order = text('orderRef') ? (await adminDb.collection('orders').doc(text('orderRef')).get()).data() : null;
    const plan = order?.subscriptionPlan;
    res.json({ subscriptions: snapshot.docs.map(subscriptionView), volunteerCancellableLineIds,
      failed: plan?.status === 'failed' ? [{ key: text('orderRef'), lineIds: plan.lineIds, error: plan.error,
        names: [...new Set(plan.lineIds.flatMap((lineId) => lineHolders(lineId, order.people).names))],
        itemNames: plan.lineIds.map((lineId) => order.items.find((item) => item.lineId === lineId)?.name).filter(Boolean) }] : [] });
  } catch (error) {
    console.error('Subscription lookup failed:', error.message);
    res.status(500).json({ error: 'Could not load the monthly payments.' });
  }
});

/**
 * Stops monthly payments for some or all items on a payer's subscription, straight away and without a refund; the
 * debit drops by those items from the next payment, and the subscription is cancelled once nothing is left on it.
 * What was bought stays in the history; the matching entitlements end, and a cancelled membership runs to the
 * paid-up date.
 */
const cancelSubscriptionLines = async (req, res, pick, action) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!adminDb) return res.status(503).json({ error: 'Subscription storage is not configured.' });
  const reference = adminDb.collection('subscriptions').doc(String(req.params.id).slice(0, 100));
  const document = await reference.get();
  if (!document.exists) return res.status(404).json({ error: 'Subscription not found.' });
  const record = document.data();
  const active = activeSubscriptionItems(record);
  const ending = pick(active);
  if (!ending.length) return res.status(409).json({ error: 'Those monthly payments are already cancelled.' });
  const result = await stopSubscriptionItems(reference, record, ending, admin, action, req.body?.reason || '');
  res.json(result);
};

const stopSubscriptionItems = async (reference, record, ending, admin, action, reason = '') => {
  const document = { id: reference.id };
  const active = activeSubscriptionItems(record);
  const stripeSubscription = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
  const paidUntil = periodEnd(stripeSubscription) ? Timestamp.fromMillis(periodEnd(stripeSubscription) * 1000) : null;
  const wholeSubscription = ending.length === active.length;
  if (wholeSubscription) {
    if (stripeSubscription.status !== 'canceled') await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'DELETE');
  } else {
    for (const item of ending) {
      if (!item.stripeItemId) throw new Error(`No Stripe item is recorded for ${item.name}.`);
      try {
        await stripeRequest(`subscription_items/${encodeURIComponent(item.stripeItemId)}?proration_behavior=none`, null, 'DELETE');
      } catch (error) {
        // A previous attempt may have reached Stripe but failed before its local batch committed.
        if (error.stripeCode !== 'resource_missing') throw error;
      }
    }
  }
  const now = Timestamp.now();
  const endingLines = new Set(ending.map((item) => item.lineId));
  const endingKeys = new Set(ending.map((item) => `${item.orderRef || record.orderRef}/${item.lineId}`));
  const isEnding = (item, orderRef = item.orderRef) => endingKeys.has(`${orderRef}/${item.lineId}`);
  const by = admin.email || admin.uid;
  const batch = adminDb.batch();
  batch.update(reference, {
    items: record.items.map((item) => isEnding(item, item.orderRef || record.orderRef) ? { ...item, status: 'cancelled', cancelledAt: now, cancelledBy: by } : item),
    ...(wholeSubscription ? { status: 'cancelled', cancelledAt: now, cancelledBy: by } : {}), updatedAt: now
  });
  const orderRefs = [...new Set(ending.map((item) => item.orderRef || record.orderRef).filter(Boolean))];
  const orders = orderRefs.length ? await adminDb.getAll(...orderRefs.map((ref) => adminDb.collection('orders').doc(ref))) : [];
  const orderLines = new Map();
  for (const order of orders.filter((entry) => entry.exists)) {
    order.data().items.forEach((item) => orderLines.set(`${order.id}/${item.lineId}`, item));
    batch.update(order.ref, { items: order.data().items.map((item) => isEnding(item, order.id) ? { ...item, monthlyCancelledAt: now } : item) });
  }
  const endsMembership = ending.some((item) => orderLines.get(`${item.orderRef || record.orderRef}/${item.lineId}`)?.category === 'MEMBERSHIP');
  const memberIds = [...new Set(ending.flatMap((item) => item.membershipIds || record.membershipIds || []))];
  const members = memberIds.length ? await adminDb.getAll(...memberIds.map((id) => adminDb.collection('memberships').doc(id))) : [];
  for (const member of members.filter((entry) => entry.exists)) {
    const data = member.data();
    const linkedMembership = endsMembership && data.stripeMembershipSubscriptionId === document.id;
    batch.update(member.ref, {
      privileges: (data.privileges || []).map((privilege) => isEnding(privilege) && !privilege.endedAt ? { ...privilege, endedAt: now } : privilege),
      subscriptionItems: (data.subscriptionItems || []).map((item) => isEnding(item) && item.status === 'active'
        ? { ...item, status: 'cancelled', cancelledAt: now } : item),
      ...(linkedMembership ? { stripeMembershipSubscriptionId: '', monthlyPaymentsCancelledAt: now,
        ...(paidUntil && (!data.validUntil || data.validUntil.toMillis() > paidUntil.toMillis()) ? { validUntil: paidUntil } : {}) } : {}),
      updatedAt: now
    });
  }
  batch.set(adminDb.collection('adminSubscriptionAudit').doc(), {
    adminUid: admin.uid, adminEmail: admin.email || '', action: wholeSubscription ? 'cancel-subscription' : action,
    stripeSubscriptionId: document.id, orderRefs, lineIds: [...endingLines], reason, checkedAt: now
  });
  await batch.commit();
  return { subscription: subscriptionView(await reference.get()), cancelledWholeSubscription: wholeSubscription, cancelledLineIds: [...endingLines] };
};

const cancelRoute = (pick, action, failure) => async (req, res) => {
  try { await cancelSubscriptionLines(req, res, (active) => pick(active, req), action); }
  catch (error) {
    console.error(`${failure}:`, error.message);
    res.status(502).json({ error: `Stripe did not make the change: ${error.message}` });
  }
};

app.post('/api/admin/subscriptions/:id/items/:lineId/volunteer-cancel', rateLimit(10, 60 * 1000), scheduleVolunteerCancellation);
app.post('/api/admin/subscriptions/:id/items/:lineId/cancel', rateLimit(20, 60 * 1000),
  cancelRoute((active, req) => active.filter((item) => item.lineId === String(req.params.lineId)), 'cancel-items', 'Cancelling a monthly item failed'));

// Stops everything one member receives on a payer's subscription; the payer keeps paying for everyone else.
app.post('/api/admin/subscriptions/:id/members/:membershipId/cancel', rateLimit(20, 60 * 1000),
  cancelRoute((active, req) => active.filter((item) => (item.membershipIds || []).includes(String(req.params.membershipId))), 'cancel-member', 'Cancelling a member\'s monthly items failed'));

app.post('/api/admin/subscriptions/:id/cancel', rateLimit(20, 60 * 1000),
  cancelRoute((active) => active, 'cancel-subscription', 'Cancelling a subscription failed'));

app.post('/api/admin/subscribers/:id/cancel', rateLimit(10, 60 * 1000), async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.set('Cache-Control', 'no-store');
  try {
    const { mode, clubCustomerId, confirmId, acknowledgeImmediateCancellation } = req.body;
    const id = req.params.id;
    if (!adminDb) return res.status(503).json({ error: 'Subscriber registry is not configured.' });
    if (!/^sub_[a-zA-Z0-9]+$/.test(id) || !['test', 'live'].includes(mode) || typeof clubCustomerId !== 'string'
      || confirmId !== id || acknowledgeImmediateCancellation !== true) {
      return res.status(400).json({ error: 'Confirm the exact subscription ID and approve immediate cancellation.' });
    }
    if (localFirebase && mode === 'live') return res.status(400).json({ error: 'Live billing changes are disabled with local emulators.' });
    const secret = process.env.STRIPE_SUBSCRIPTION_ADMIN_KEY || '';
    if (!/^(sk|rk)_(test|live)_/.test(secret)) return res.status(503).json({ error: 'Subscription cancellation is not configured. Set STRIPE_SUBSCRIPTION_ADMIN_KEY on the server.' });
    if ((secret.includes('_live_') ? 'live' : 'test') !== mode) return res.status(400).json({ error: 'Stripe write key and report mode do not match.' });
    const registry = adminDb.collection('stripeSubscriptions').doc(`FCC-${mode}-${id}`);
    const existing = await registry.get();
    if (!existing.exists || existing.data().clubCustomerId !== clubCustomerId) {
      return res.status(409).json({ error: 'Import and verify this subscriber before cancellation.' });
    }
    const result = await cancelStripeSubscription(stripeReportRequest(secret), id, clubCustomerId, mode);
    const checkedAt = new Date().toISOString();
    const [record] = await importStripeSubscribers(adminDb, [result.record], mode, checkedAt);
    const batch = adminDb.batch();
    batch.set(registry, { immediateCancellationConfirmedAt: checkedAt, immediateCancellationConfirmedBy: admin.uid }, { merge: true });
    batch.set(adminDb.collection('adminSubscriptionAudit').doc(`immediate-${mode}-${id}`), {
      adminUid: admin.uid, stripeSubscriptionId: id, clubCustomerId, mode, action: 'cancel-immediately',
      changed: result.changed, checkedAt
    }, { merge: true });
    await batch.commit();
    res.json({ ...result, record, checkedAt });
  } catch (error) {
    console.error('Immediate subscription cancellation failed:', error.message);
    res.status(502).json({ error: 'Could not finish confirming and recording immediate cancellation. Check Stripe and refresh the report before retrying; Stripe may already have accepted the change.' });
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
    const auditSecret = process.env.AUDIT_LOOKUP_SECRET || (localFirebase ? 'local-audit-secret' : '');
    if (!auditSecret) return res.status(503).json({ error: 'Deletion audit is not configured. Set AUDIT_LOOKUP_SECRET.' });
    const reference = collection.doc(req.params.id);
    const result = await adminDb.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return { status: 404, error: 'Record not found.' };
      const fields = document.data();
      if (fields.itemActionPending) return { status: 409, error: 'An item action is unfinished. Retry that exact action before deleting this order.' };
      let warning = subscriptionWarning(fields);
      if (fields.email) {
        const related = await transaction.get(adminDb.collection('orders').where('email', '==', normalizeEmail(fields.email)).limit(101));
        warning ||= related.size > 100 || related.docs.some((order) => subscriptionWarning(order.data()));
      } else if (req.params.kind === 'members') warning = true;
      if (warning && req.body.acknowledgeStripe !== true) return { status: 409,
        error: 'Check and cancel any active Stripe subscription before deleting this record. Deleting website data does not stop payments.',
        requiresStripeAcknowledgement: true, stripeSubscriptionId: fields.stripeSubscriptionId || '' };
      // Explicit record deletion also releases any remaining stock holds.
      const stock = req.params.kind === 'orders' ? await readStock(transaction, limitedProductIds(fields.items || [])) : [];
      stock.forEach((snapshot) => dropHold(transaction, snapshot, req.params.id));
      transaction.delete(reference);
      transaction.create(adminDb.collection('adminDeletionAudit').doc(), {
        ...deletionAuditEntry({ kind: req.params.kind, id: req.params.id, fields, secret: auditSecret, adminUid: admin.uid, stripeAcknowledged: req.body.acknowledgeStripe === true }),
        createdAt: Timestamp.now()
      });
      return { status: 200, success: true };
    });
    res.status(result.status).json(result);
  } catch (error) {
    console.error('Admin deletion failed:', error.message);
    res.status(500).json({ error: 'Could not delete record.' });
  }
});

registerGdprRoutes(app, { requireAdmin, db: () => adminDb, stripeReportRequest, localFirebase, customerId, normalizeEmail, isValidEmail });
registerPolicyRoutes(app, { requireAdmin, db: () => adminDb, distDirectory: join(__dirname, 'dist'), siteUrl: process.env.PUBLIC_SITE_URL, live: isLive() });
const { settleKeyAccess, notifyKeyAccess } = registerKeyAccessRoutes(app, { requireAdmin, db: () => adminDb, sendEmail: (message) => sendEmail(message) });
const { settleVolunteersFor, loadVolunteerBenefits, volunteerRenewalContent, sendVolunteerRenewals } = registerVolunteerRoutes(app, { requireAdmin, db: () => adminDb, sheets: () => sheets,
  toMembershipRecord, stripeSubscriptionIsActive, settleKeyAccess, sendEmail: (message) => sendEmail(message), requestNow,
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerBoathouseRoutes(app, { requireAdmin, db: () => adminDb, onCodeChanged: notifyKeyAccess });
const emailCodes = registerEmailCodeRoutes(app, { db: () => adminDb, sendEmail: (message) => sendEmail(message) });
registerMyDetailsRoutes(app, { db: () => adminDb, sendEmail: (message) => sendEmail(message), emailCodes });
registerClubNightRoutes(app, { requireAdmin, db: () => adminDb, emailCodes, requestNow, live: () => isLive(),
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerItemActionRoutes(app, { requireAdmin, db: () => adminDb, stripeRequest,
  stopMonthlyItem: async (orderRef, item, admin, reason) => {
    const subscriptions = await orderSubscriptions(adminDb, orderRef);
    for (const document of subscriptions) {
      const record = document.data();
      const ending = activeSubscriptionItems(record).filter((entry) => entry.lineId === item.lineId && (entry.orderRef || record.orderRef) === orderRef);
      if (ending.length) await stopSubscriptionItems(document.ref, record, ending, admin, 'revoke-item', reason);
    }
  } });
registerAdminAccessRoutes(app, { requireAdmin, auth: () => adminAuth, db: () => adminDb, localFirebase });
const { sendDueRosters } = registerEventRosterRoutes(app, { requireAdmin, db: () => adminDb, sendEmail: (message) => sendEmail(message),
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerMemberCheckRoutes(app, { requireAdmin, db: () => adminDb });
const { loadReceiptPersonFields } = registerReceiptEmailRoutes(app, { requireAdmin, db: () => adminDb });
registerRenewalRoutes(app, { requireAdmin, db: () => adminDb, sendEmail: (...args) => sendEmail(...args), requestNow: (req) => requestNow(req),
  volunteerRenewalContent, sendVolunteerRenewals,
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))),
  siteUrl: () => (process.env.PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '') });

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
  try {
    const raw = buildRawEmail({ fromName: 'Forth Canoe Club Website', from: sender, to: recipient,
      subject: `Website changes need your review: PR #${pullRequest.number}`,
      body: [`An administrator (${requestedBy}) submitted website content for review.`, '',
        `Review and merge the pull request to publish the changes: ${pullRequest.html_url}`, '',
        'The approved main-branch workflow deploys the website to Firebase.'].join('\n') });
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

app.post('/api/admin/products/reserve-id', rateLimit(20, 60 * 1000), async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    if (!adminDb) return res.status(503).json({ error: 'Product storage is not configured.' });
    const [id] = await allocateRecordIds(adminDb, 'products');
    res.set('Cache-Control', 'no-store');
    res.json({ id });
  } catch (error) {
    console.error('Could not reserve product ID:', error.message);
    res.status(500).json({ error: 'Could not create a product ID. Please try again.' });
  }
});

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
    const [formId] = await allocateRecordIds(adminDb, 'forms');
    const formDocument = adminDb.collection('forms').doc(formId);
    await formDocument.create(form);
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
  productIds: Array.isArray(discount.productIds) ? discount.productIds : [],
  categories: Array.isArray(discount.categories) ? discount.categories : []
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

    const [byEmail, orderSnapshot, memberSnapshot, householdSnapshot] = await Promise.all([
      adminDb.collection('discountCodes').where('email', '==', email).get(),
      adminDb.collection('orders').where('email', '==', email).limit(50).get(),
      adminDb.collection('memberships').where('email', '==', email).limit(20).get(),
      adminDb.collection('households').where('email', '==', email).limit(50).get()
    ]);
    const householdMembers = (await Promise.all(householdSnapshot.docs.map((household) =>
      adminDb.collection('memberships').where('householdId', '==', household.id).limit(50).get()
    ))).flatMap((snapshot) => snapshot.docs);
    const allMembers = [...new Map([...memberSnapshot.docs, ...householdMembers].map((document) => [document.id, document])).values()];
    // Older vouchers have no email of their own, so they are found through the customer's orders.
    const known = new Set(byEmail.docs.map((document) => document.id));
    const olderCodes = orderSnapshot.docs.flatMap((order) => (order.data().vouchers || []).map((voucher) => voucher.code)).filter((code) => !known.has(code));
    const voucherDocs = [...byEmail.docs.filter((document) => document.data().orderRef)];
    if (olderCodes.length) voucherDocs.push(...(await adminDb.getAll(...olderCodes.map((code) => adminDb.collection('discountCodes').doc(code)))).filter((document) => document.exists));
    if (!voucherDocs.length && !orderSnapshot.size && !allMembers.length) return res.status(404).json({ error: 'No customer found.' });
    const now = Date.now();
    res.json({
      email,
      vouchers: voucherDocs.map((document) => {
        const data = document.data();
        return {
          code: data.code, value: data.discountValue, orderRef: data.orderRef, usedByOrder: data.usedByOrder || '',
          status: data.active === false ? 'revoked' : data.used ? 'used' : data.expiresAt?.toMillis() <= now ? 'expired' : data.reservedUntil?.toMillis() > now ? 'in checkout' : 'active',
          createdAt: data.createdAt?.toMillis() || 0, expiresAt: data.expiresAt?.toMillis() || 0, usedAt: data.usedAt?.toMillis() || 0
        };
      }).sort((a, b) => b.createdAt - a.createdAt),
      memberships: allMembers.map((document) => {
        const data = document.data();
        return {
          id: document.id, name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.name || 'Unnamed',
          membershipTier: data.membershipTier || '', status: data.status === 'active' && data.validUntil?.toMillis() <= now ? 'expired' : data.status || 'unknown',
          validUntil: data.validUntil?.toMillis() || 0, affiliationNumber: data.affiliationNumber || '', membershipNumber: data.membershipNumber || '',
          privileges: (data.privileges || []).filter((privilege) => !privilege.endedAt).map((privilege) => privilege.name)
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
    const vouchers = summariseVoucherCodes(snapshot.docs.map((document) => document.data()).map((data) => ({
      orderRef: data.orderRef, sourceProductId: data.sourceProductId, label: data.label, discountValue: data.discountValue,
      used: data.used === true, expiresAt: data.expiresAt?.toMillis() || 0
    })), now);
    const codes = snapshot.docs.map((document) => document.data()).filter((data) => !data.orderRef).map((data) => ({
      code: data.code, label: data.label || '', discountType: data.discountType || 'multiplier',
      discountValue: data.discountValue ?? 0.25, productIds: Array.isArray(data.productIds) ? data.productIds : [],
      singleUse: data.singleUse === true, used: data.used === true, active: data.active !== false,
      expired: data.expiresAt?.toMillis() <= now, expiresAt: data.expiresAt?.toMillis() || 0, createdAt: data.createdAt?.toMillis() || 0
    })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
    res.json({ codes, vouchers });
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

// Says whether a membership exists for an email; names are only returned for a matching date of birth.
app.post('/api/membership-names', rateLimit(8, 60 * 1000), async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const dob = typeof req.body.dob === 'string' ? req.body.dob.trim() : '';
    if (!adminDb || !isValidEmail(email)) return res.json({ exists: false, names: [] });
    const [legacy, households] = await Promise.all([
      adminDb.collection('memberships').where('email', '==', email).limit(10).get(),
      adminDb.collection('households').where('email', '==', email).limit(50).get()
    ]);
    const householdMembers = (await Promise.all(households.docs.map((household) =>
      adminDb.collection('memberships').where('householdId', '==', household.id).limit(50).get()
    ))).flatMap((snapshot) => snapshot.docs.map((document) => document.data()));
    const records = [...new Map([...legacy.docs.map((document) => document.data()), ...householdMembers]
      .filter(({ firstName, lastName }) => firstName && lastName)
      .map((record) => [`${record.firstName} ${record.lastName}|${record.dob || ''}`, record])).values()];
    const names = new Map();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      for (const { firstName, lastName, dob: held, volunteer } of records) if (held === dob) names.set(`${firstName} ${lastName}`.toLowerCase(), { firstName, lastName,
        ...(volunteer?.inducted ? { volunteer: { inducted: true, years: Object.fromEntries(Object.entries(volunteer.years || {})
          .map(([year, value]) => [year, { active: value.active === true, tier: value.tier }])) } } : {}) });
    }
    res.json({ exists: records.length > 0, names: [...names.values()] });
  } catch (error) {
    console.error('Membership email lookup failed:', error.message);
    res.status(503).json({ error: 'Membership lookup is unavailable.' });
  }
});

/** Remaining stock for limited products, so the shop can hide anything sold out. */
app.get('/api/availability', rateLimit(60, 60 * 1000), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!adminDb) return res.json({ availability: {} });
  try {
    const [productSnapshot, stockSnapshot] = await Promise.all([adminDb.collection('products').get(), adminDb.collection('stock').get()]);
    const catalog = resolveCatalogue(PRODUCTS, productSnapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
    const holdsById = new Map(stockSnapshot.docs.map((document) => [document.id, document.data().holds || {}]));
    const availability = {};
    for (const product of catalog) {
      const remaining = remainingStock(product, holdsById.get(product.id));
      if (remaining) availability[product.id] = { remaining, soldOut: isSoldOut(remaining) };
    }
    res.json({ availability });
  } catch (error) {
    console.error('Could not load availability:', error.message);
    res.status(503).json({ error: 'Availability is unavailable.' });
  }
});

app.get('/api/checkout-status', rateLimit(30, 60 * 1000), async (req, res) => {
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Invalid Checkout Session.' });
  if (!adminDb) return res.status(503).json({ error: 'Checkout status is unavailable.' });
  try {
    const snapshot = await adminDb.collection('orders').where('stripeSessionId', '==', sessionId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ error: 'Checkout order not found.' });
    return res.json({ status: snapshot.docs[0].data().status || 'pending' });
  } catch (error) {
    console.error('Could not load checkout status:', error.message);
    return res.status(503).json({ error: 'Checkout status is unavailable.' });
  }
});

app.get('/api/checkout-receipt', rateLimit(20, 60 * 1000), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  const token = typeof req.query.receipt_token === 'string' ? req.query.receipt_token : '';
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(404).json({ error: 'Receipt not found.' });
  }
  if (!adminDb) return res.status(503).json({ error: 'Receipt service is unavailable.' });
  try {
    const snapshot = await adminDb.collection('orders').where('stripeSessionId', '==', sessionId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ error: 'Receipt not found.' });
    const document = snapshot.docs[0];
    const order = document.data();
    const actualHash = hashAccessToken(token);
    const expectedHash = order.receiptViewTokenHash || '';
    if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash))) {
      return res.status(404).json({ error: 'Receipt not found.' });
    }
    if (order.status !== 'paid') return res.status(409).json({ status: order.status || 'pending' });
    const receipt = buildReceiptSummary(document.id, order);
    return res.json({ receipt, copy: receiptEmailCopy(receipt) });
  } catch (error) {
    console.error('Could not load checkout receipt:', error.message);
    return res.status(503).json({ error: 'Receipt service is unavailable.' });
  }
});

app.post('/api/checkout-session', rateLimit(10, 60 * 1000), async (req, res) => {
  let reservedDocument;
  let reservedStockIds = [];
  const orderRef = `FCC-${crypto.randomUUID().toUpperCase()}`;
  try {
    const email = normalizeEmail(req.body.email);
    const { items: requestedItems, billingMode = 'annual' } = req.body;
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe test mode is not configured.' });
    if (!isValidEmail(email) || !Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 20 || !['annual', 'monthly'].includes(billingMode)) {
      return res.status(400).json({ error: 'Enter a valid email address and include at least one item.' });
    }

    const orderRef = generateOrderRef();
    if (!adminDb) return res.status(503).json({ error: 'Order storage is not configured.' });
    const catalogSnapshot = await adminDb.collection('products').get();
    const catalog = resolveCatalogue(PRODUCTS, catalogSnapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
    const lineIds = requestedItems.map((item) => typeof item?.lineId === 'string' ? item.lineId.slice(0, 64) : '');
    const catalogItems = requestedItems.map((item) => catalog.find((product) => product.id === item?.id));
    if (catalogItems.some((item) => !item || item.type === 'external' || !Number.isFinite(item.basePrice) || item.basePrice < 0) || lineIds.some((id) => !id || id.includes(NEXT_YEAR_LINE_SUFFIX)) || new Set(lineIds).size !== lineIds.length) {
      return res.status(400).json({ error: 'Your basket contains an unavailable item. Please refresh the shop.' });
    }
    const now = requestNow(req);
    const selected = catalogItems.map((item, index) => ({ ...item, lineId: lineIds[index],
      ...(isMerchandise(item) ? { size: typeof requestedItems[index]?.size === 'string' ? requestedItems[index].size.trim().slice(0, 40) : '' } : {}),
      ...(clubYearKind(item) ? { clubYearChoice: resolveClubYearChoice(item, requestedItems[index]?.clubYearChoice, now) } : {}) }));
    const offSale = selected.find((item) => clubYearKind(item) && !item.clubYearChoice);
    if (offSale) {
      return res.status(400).json({ code: 'club_year_unavailable', error: `${offSale.name} is not on sale for the club year chosen. Choose the club year again in your basket.` });
    }
    const unsized = selected.find((item) => isMerchandise(item) && !Object.hasOwn(productLimits(item) || {}, item.size));
    if (unsized) return res.status(400).json({ error: `Choose an available size for ${unsized.name}.` });
    for (const item of selected.filter((product) => product.category === 'EVENTS')) {
      try { validateEventSchedule(item.eventSchedule); }
      catch (error) { return res.status(400).json({ error: `Invalid event schedule for ${item.name}.` }); }
      if (item.type !== 'event-ticket') return res.status(400).json({ error: 'Event tickets must use one-off event pricing.' });
      if (bookingsClosed(item)) return res.status(400).json({ error: `Bookings for ${item.name} have closed. Remove it from your basket.` });
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
    const detailErrors = validateCheckout({ lines: selected, people, now });
    if (detailErrors.length) return res.status(400).json({ error: detailErrors[0], details: detailErrors });
    // From here each line covers one club year; a 'both' line becomes this year's line and a next-year line.
    const lines = expandClubYearLines(selected);
    const linePeople = expandPeopleLines(people, selected);
    const getsMembership = new Set(peopleGrantedMembership(lines, linePeople).map((person) => person.id));
    const nextYearEnd = clubYearDates(clubYearOf(now) + 1).end.getTime();
    const storedPeople = [];
    for (const person of withFamilyContacts(linePeople, lines)) {
      const { existing, conflict, reason, validationError, contactHouseholdId } = await findMembership(person, now);
      if (validationError) {
        return res.status(503).json({ error: 'We could not confirm your Stripe direct-debit subscription. Your basket is unchanged; please try again shortly.' });
      }
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
      const membershipParts = person.lineIds.map((id) => lines.find((line) => line.lineId === id)).filter(isMembership)
        .map((line) => line.clubYearPart === 'next' ? 'next' : 'this');
      const buysMembership = membershipParts.length > 0;
      // An active member is covered for next year once their renewal is recorded, and for this year unless they have only
      // bought next year (which covers this year too from 8 February). Records from before club years were recorded
      // count as this year's.
      const currentClubYear = clubYearOf(now);
      const coversNextYear = Boolean(existing?.active && existing.validUntil >= nextYearEnd);
      const heldYears = existing?.clubYears || [];
      const coversThisYear = Boolean(existing?.active && (!heldYears.length || heldYears.some((year) => year <= currentClubYear)
        || (coversNextYear && now >= clubYearDates(currentClubYear).membershipSaleEnds)));
      const covers = (part) => part === 'this' ? coversThisYear : coversNextYear;
      const neededParts = membershipPartsNeeded(lines, person, now).filter((part) => !covers(part));
      // From 1 March every JustGo member is inactive until the weekly sync confirms their direct-debit renewal.
      if (existing?.awaitingRenewal && renewalConfirmationOpen(now) && (buysMembership || neededParts.length || getsMembership.has(person.id))) {
        return res.status(409).json({
          code: 'renewal_unconfirmed', personIds: [person.id],
          error: `${person.firstName} ${person.lastName}'s membership renews through JustGo direct debit and is still being confirmed for the new club year. This usually completes within a day, so please try again then or contact secretary@forthcanoeclub.co.uk. There is no need to buy a membership here.`
        });
      }
      if (membershipParts.some(covers)) {
        const name = `${person.firstName} ${person.lastName}`;
        const renewalOpen = now >= clubYearDates(clubYearOf(now)).renewalOpens;
        return res.status(409).json({
          code: existing.justgo ? 'renews_via_justgo' : 'membership_active', personIds: [person.id],
          error: existing.justgo
            ? `${name} is already an active member and renews through JustGo, so no membership is needed here. Remove the membership from your basket; add-ons can still be bought.`
            : `${name} is already an active member until ${new Date(existing.validUntil).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}. ${renewalOpen && !coversNextYear
              ? `To renew, choose club year ${clubYearLabel(clubYearOf(now) + 1)} only for the membership in your basket.`
              : 'Remove the membership from your basket; add-ons can still be bought.'}`
        });
      }
      const grantYears = getsMembership.has(person.id) ? [...new Set(person.lineIds.map((id) => lines.find((line) => line.lineId === id))
        .filter((line) => line && grantsMembership(line) && !membershipParts.includes(line.clubYearPart === 'next' ? 'next' : 'this'))
        .map((line) => line.clubYearPart === 'next' ? 'next' : 'this'))]
        .filter((part) => !covers(part))
        .map((part) => currentClubYear + (part === 'next' ? 1 : 0)) : [];
      if (neededParts.length) {
        return res.status(409).json({
          code: 'membership_required', personIds: [person.id],
          error: existing?.contactOnly
            ? `${person.firstName} ${person.lastName} is on our contact list from an event booking but is not a club member, so these items need a membership. Add a membership to your basket.`
            : existing?.awaitingRenewal
            ? `${person.firstName} ${person.lastName}'s JustGo renewal has not been confirmed for this club year, so add-ons cannot be bought yet. If you have renewed, it can take a day to appear; otherwise add a membership to your basket. Questions: secretary@forthcanoeclub.co.uk.`
            : `${person.firstName} ${person.lastName} needs a Forth Canoe Club membership before buying these items. Add a membership to your basket, or check the membership number or date of birth and email you entered. If you are already a member through JustGo your record can take a day to appear; contact secretary@forthcanoeclub.co.uk.`
        });
      }
      storedPeople.push({ ...person, membershipId: existing?.id || '',
        existingMember: Boolean(existing),
        // A membership-included item makes the person a member for its club year unless they already are one.
        ...(grantYears.length ? { grantMembership: true, grantMembershipYears: grantYears } : {}),
        // Keeps this year in the record's club years when a member from before club years were recorded renews.
        ...(coversThisYear ? { heldClubYears: [currentClubYear] } : {}),
        ...((existing?.householdId || contactHouseholdId)
          ? { householdId: existing?.householdId || contactHouseholdId } : {}) });
    }
    const householdGroups = new Map();
    for (const person of storedPeople) {
      const key = householdGroupKey(person);
      const group = householdGroups.get(key) || [];
      group.push(person);
      householdGroups.set(key, group);
    }
    for (const group of householdGroups.values()) {
      const existingHouseholds = [...new Set(group.map((person) => person.householdId).filter(Boolean))];
      if (existingHouseholds.length > 1) {
        return res.status(409).json({ error: 'The family members are linked to different households. Contact the club before continuing.' });
      }
      const householdId = existingHouseholds[0] || (await allocateRecordIds(adminDb, 'households'))[0];
      group.forEach((person) => { person.householdId = householdId; });
    }
    // Club-year items cannot be bought twice for the same person and club year.
    const existingIds = [...new Set(storedPeople.filter((person) => person.existingMember).map((person) => person.membershipId))];
    const memberData = new Map(existingIds.length ? (await adminDb.getAll(...existingIds.map((id) => adminDb.collection('memberships').doc(id))))
      .filter((document) => document.exists).map((document) => [document.id, document.data()]) : []);
    for (const person of storedPeople.filter((candidate) => memberData.has(candidate.membershipId))) {
      const held = person.lineIds.map((id) => lines.find((line) => line.lineId === id))
        .find((line) => line && !isMembership(line) && line.category !== 'EVENTS' && clubYearKind(line)
          && holdsForClubYear(memberData.get(person.membershipId), line.id, clubYearOf(now) + (line.clubYearPart === 'next' ? 1 : 0)));
      if (held) {
        const nextYearOnSale = now >= clubYearDates(clubYearOf(now)).renewalOpens;
        const year = nextYearOnSale ? ` for club year ${clubYearLabel(clubYearOf(now) + (held.clubYearPart === 'next' ? 1 : 0))}` : '';
        const nextStep = nextYearOnSale ? ' Remove it from your basket or choose another club year.' : ' Remove it from your basket.';
        return res.status(409).json({ code: 'already_held', personIds: [person.id], lineId: held.sourceLineId,
          error: `${person.firstName} ${person.lastName} already has ${held.name}${year}.${nextStep}` });
      }
    }
    let promo = null;
    const code = typeof req.body.discountCode === 'string' ? req.body.discountCode.trim().toUpperCase() : '';
    const discountDocument = code ? await findDiscountCode(code) : null;
    if (code) {
      const message = discountFailure(discountDocument?.data());
      if (message) return res.status(400).json({ error: message });
      promo = publicDiscount(discountDocument.data());
    }
    // Single-day trips are discounted for attendees holding boat hire or a subscription this club year, or buying one now.
    const tripPrivileges = new Map();
    const volunteerTiers = await loadVolunteerBenefits();
    if (selected.some(isTripEvent)) {
      for (const person of storedPeople) if (memberData.has(person.membershipId)) {
        const data = memberData.get(person.membershipId);
        tripPrivileges.set(person.id, [...(data.privileges || []), ...volunteerPrivileges(data, volunteerTiers, now)]);
      }
    }
    const volunteerLines = applyVolunteerBenefits(lines, storedPeople, memberData, volunteerTiers, now);
    const pricing = calculateCart(applyTripDiscounts(volunteerLines, storedPeople, tripPrivileges, now), billingMode === 'annual', promo, now);
    if (promo && pricing.promoDiscountValue <= 0) return res.status(400).json({ error: 'This code does not apply to the items in your basket.' });
    const siteUrl = checkoutSiteOrigin(req);
    const receiptViewToken = createAccessToken();
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
      id: item.id, lineId: item.lineId, name: item.name, category: item.category, type: item.type, pricingMode: item.pricingMode, price: item.displayPrice,
      monthly: Boolean(item.monthlyBilling && item.monthlyAmount > 0),
      ...(item.volunteerBenefit ? { volunteerBenefit: true } : {}),
      ...(item.clubYear ? { clubYear: item.clubYear, clubYearPart: item.clubYearPart, label: item.label } : {}),
      ...(item.sourceLineId !== item.lineId ? { sourceLineId: item.sourceLineId } : {}),
      ...(item.monthlyBilling ? { monthlyAmount: item.monthlyAmount, debits: item.debits,
        ...(item.debits ? { firstDebitAt: Timestamp.fromDate(item.firstDebit), cutoffAt: Timestamp.fromDate(item.subscriptionEnd) } : {}) } : {}),
      ...(lineMembershipRule(item) && item.category !== 'MERCHANDISE' && item.category !== 'VOUCHERS' ? { membershipRule: lineMembershipRule(item) } : {}),
      ...(item.tripSaving > 0 ? { tripDiscount: item.tripSaving, tripDiscountReasons: item.tripDiscountReasons } : {}),
      ...(item.size ? { size: item.size } : {}),
      ...(item.membershipTier ? { membershipTier: item.membershipTier } : {}),
      ...(item.type === 'voucher' ? { voucherValue: item.basePrice, voucherScope: voucherScope(item) } : {}),
      ...(item.category === 'EVENTS' ? {
        eventSchedule: validateEventSchedule(item.eventSchedule),
        ...(storedPeople.some((person) => person.lineIds.includes(item.lineId) && person.ownKitLineIds.includes(item.lineId)) ? { ownKit: true } : {}),
        ...(typeof item.imageUrl === 'string' && item.imageUrl ? { imageUrl: item.imageUrl } : {})
      } : {})
    }));
    const total = pricing.total;
    reservedStockIds = await reserveStock(orderRef, selected, catalog);
    const policyVersions = await currentCheckoutPolicies(adminDb, isLive());
    const hasRecurringItem = items.some((item) => item.monthly);
    // New people get their permanent short ID only once the checkout has passed every check.
    const newPeople = storedPeople.filter((person) => !person.membershipId);
    (await allocateMemberIds(adminDb, newPeople.length)).forEach((id, index) => { newPeople[index].membershipId = id; });
    // Checkout takes the joining share of this month (and anything paid up front) and saves the payment details. Each
    // club year's monthly items are then set up after payment as a subscription debited on the 1st (see setUpSubscriptions).
    const debited = items.filter((item) => item.monthly && item.debits > 0);
    const groups = [...new Set(debited.map((item) => item.clubYear))].sort().map((clubYear) => {
      const groupItems = debited.filter((item) => item.clubYear === clubYear);
      return { clubYear, lineIds: groupItems.map((item) => item.lineId), firstDebitAt: groupItems[0].firstDebitAt, cutoffAt: groupItems[0].cutoffAt };
    });
    const subscriptionPlan = groups.length ? { status: 'pending', lineIds: debited.map((item) => item.lineId), groups } : null;
    const checkoutTotal = total;
    // Stripe will not take a £0 payment, so a fully discounted basket with no monthly payments is completed here instead.
    const free = !subscriptionPlan && Math.round(checkoutTotal * 100) === 0;
    const freeSessionId = free ? `cs_free_${crypto.randomBytes(16).toString('hex')}` : '';
    await createFirestoreOrder({ orderRef, email, items, total: checkoutTotal, status: 'pending', discountCodeId: discountDocument?.id || null, stripeSessionId: freeSessionId,
      people: storedPeople, siteUrl, billingMode: hasRecurringItem ? 'monthly' : 'annual', receiptViewTokenHash: hashAccessToken(receiptViewToken), stockProductIds: reservedStockIds, policyVersions,
      subscriptionPlan });
    if (free) {
      const fields = await fulfilOrder({ orderRef, sessionId: freeSessionId, amountTotal: 0 });
      await updateFirestoreOrder(orderRef, { paymentMethod: 'free' });
      try { if (fields) await deliverOrder(orderRef, fields); }
      catch (error) { console.error('Free order completed but the receipt email failed:', error.message); }
      const params = new URLSearchParams({ session_id: freeSessionId, receipt_token: receiptViewToken });
      return res.json({ success: true, free: true, orderRef, sessionId: freeSessionId, checkoutUrl: `${siteUrl}/payment-success?${params}` });
    }
    const dateLabel = (timestamp) => timestamp.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
    const money = (value) => `£${Number(value).toFixed(2)}`;
    const debitText = groups.map((group) => {
      const monthly = debited.filter((item) => item.clubYear === group.clubYear).reduce((sum, item) => sum + Number(item.monthlyAmount), 0);
      return `${money(monthly)} a month by direct debit on the 1st from ${dateLabel(group.firstDebitAt)} through February (club year ${clubYearLabel(group.clubYear)})`;
    }).join('; ');
    // Nothing due now but monthly payments to come: Checkout only saves the payment details.
    const setupOnly = Math.round(checkoutTotal * 100) === 0;
    const charged = items.filter((item) => Math.round(Number(item.price) * 100) > 0);
    const lineItems = setupOnly ? [] : charged.flatMap((item, index) => [
      [`line_items[${index}][price_data][currency]`, 'gbp'],
      [`line_items[${index}][price_data][product_data][name]`, item.clubYear ? `${itemLabel(item)} – ${item.label}` : itemLabel(item)],
      [`line_items[${index}][price_data][product_data][metadata][line_id]`, item.lineId],
      [`line_items[${index}][price_data][unit_amount]`, String(Math.round(Number(item.price) * 100))],
      [`line_items[${index}][quantity]`, '1']
    ]);
    const session = await stripeRequest('checkout/sessions', [
      ...lineItems,
      ['expires_at', String(Math.floor(Date.now() / 1000) + 3600)],
      ['mode', setupOnly ? 'setup' : 'payment'],
      ['customer', await stripeCustomerFor(email)],
      ...(setupOnly
        ? [['currency', 'gbp'], ['setup_intent_data[metadata][order_ref]', orderRef]]
        : [['payment_intent_data[metadata][order_ref]', orderRef],
          // Saves the card or bank account for the monthly direct debits set up after payment.
          ...(subscriptionPlan ? [['payment_intent_data[setup_future_usage]', 'off_session']] : [])]),
      ...(debitText ? [['custom_text[submit][message]', `Your payment details are saved for ${debitText}.`.slice(0, 1200)]] : []),
      ['success_url', `${siteUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&receipt_token=${receiptViewToken}`],
      ['cancel_url', `${siteUrl}/membership`],
      ['metadata[order_ref]', orderRef],
      ['metadata[total]', String(checkoutTotal)],
      ['metadata[billing_mode]', hasRecurringItem ? 'monthly' : 'annual']
    ]);
    await updateFirestoreOrder(orderRef, { stripeSessionId: session.id, stripeMode: session.livemode ? 'live' : 'test' });

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
    try { await releaseStock(orderRef, reservedStockIds); }
    catch (releaseError) { console.error('Could not release stock hold:', releaseError.message); }
    if (error.soldOut) return res.status(409).json({ code: 'sold_out', productId: error.productId, error: error.message });
    res.status(500).json({ error: 'Could not start secure checkout.' });
  }
});

/** Sends email through Workspace; the emulator stack writes it to `testMail` instead. */
const sendEmail = async ({ to, subject, body, html, record = {} }) => {
  if (localFirebase) {
    await adminDb.collection('testMail').add({ email: to, subject, body, ...(html ? { html } : {}), ...record, createdAt: Timestamp.now() });
    return true;
  }
  const sender = process.env.GOOGLE_WORKSPACE_SENDER || process.env.GOOGLE_WORKSPACE_DELEGATED_USER;
  if (!gmailApi || !sender) {
    console.error('Email not sent: set GOOGLE_WORKSPACE_DELEGATED_USER (and a service account with domain-wide delegation).');
    return false;
  }
  const raw = buildRawEmail({ fromName: 'Forth Canoe Club', from: sender, to, subject, body, html });
  await gmailApi.users.messages.send({ userId: 'me', requestBody: { raw } });
  return true;
};

const sendOrderEmail = async ({ email, orderRef, accessToken, items, people = [], total, vouchers = [], siteUrl = '', billingMode = 'annual' }) => {
  const orderSiteUrl = siteUrl || process.env.PUBLIC_SITE_URL || 'http://localhost:3000';
  // Admin-chosen person details go in the email only, never the shareable receipt link.
  const receipt = buildReceiptSummary(orderRef, { email, items, people, total, vouchers, billingMode }, { personFields: await loadReceiptPersonFields() });
  const retrievalUrl = `${orderSiteUrl}/order/${orderRef}.${accessToken}`;
  const body = [receiptEmailCopy(receipt), '', `Retrieve your receipt and subscription information: ${retrievalUrl}`, '',
    'For help, contact secretary@forthcanoeclub.co.uk.'].join('\n');
  return sendEmail({ to: email, subject: `Your Forth Canoe Club receipt - ${orderRef}`, body, html: receiptEmailHtml(receipt, retrievalUrl),
    record: { orderRef, items, people, total, receipt, retrievalUrl, vouchers } });
};

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
      ...buildLinkedReceipt(orderRef, fields),
      createdAt: fields.createdAt?.toDate?.() || null,
      expiresAt: fields.expiresAt?.toDate?.() || null
    });
  } catch (error) {
    if (error.code === 404) return res.status(404).json({ error: 'Order not found.' });
    console.error('Error retrieving order:', error);
    res.status(500).json({ error: 'Could not retrieve order.' });
  }
});

// Health check for the uptime alert: only healthy when Firestore can be read, so a broken database or credentials also alert.
app.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!adminDb) return res.status(503).json({ status: 'unavailable', error: 'Database not configured.' });
  let timer;
  try {
    await Promise.race([adminDb.collection('settings').doc('health').get(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Firestore read timed out.')), 5000); })]);
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ status: 'unavailable', error: 'Database unavailable.' });
  } finally { clearTimeout(timer); }
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
// Records changed consent and policy wording after each release once the site is live; repeated hourly in case the website deployed after this instance started.
const recordPolicyVersions = async () => {
  try {
    const recorded = await syncPolicies(adminDb, { distDirectory: join(__dirname, 'dist'), siteUrl: process.env.PUBLIC_SITE_URL });
    if (recorded.length) console.log('Recorded policy versions:', recorded.map(({ key, version }) => `${key}@${version}`).join(', '));
    const currentVersions = Object.fromEntries((await adminDb.collection('policies').get()).docs.map((document) => [document.id, document.data().currentVersion || 0]));
    liveReadinessProblems({ currentVersions }).forEach((problem) => console.warn(`Not ready for live: ${problem}`));
  } catch (error) {
    console.error('Policy sync failed:', error.message);
  }
};
if (adminDb && isLive()) {
  recordPolicyVersions();
  setInterval(recordPolicyVersions, 60 * 60 * 1000).unref();
} else if (adminDb) {
  console.log('WEBSITE_ISLIVE is not true: consent and policy wording is not versioned and consent records show pre-live.');
}

if (adminDb) {
  // Event leaders get their attendee list once bookings close.
  const sendRosters = () => sendDueRosters().catch((error) => console.error('Event roster check failed:', error.message));
  sendRosters();
  setInterval(sendRosters, 60 * 60 * 1000).unref();
}

app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`ðŸŽ¯ FCC Website running at http://127.0.0.1:${PORT}`);
  console.log(`ðŸ“ Serving from: ${__dirname}/dist`);
  console.log(`ðŸ›‘ To stop the server, press Ctrl+C`);
});
