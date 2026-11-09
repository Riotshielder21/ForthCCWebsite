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
import { getAppCheck } from 'firebase-admin/app-check';
import { appCheckMiddleware } from './src/server/appCheck.js';
import { getFirestore as getAdminFirestore, Timestamp, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { PAGE_CONTENT, validatePageFields } from './src/constants/pageContent.js';
import { contentDisposition, findSafeguardingPolicy, isPdf } from './src/utils/safeguardingPolicies.js';
import { BANNER_PAGES, validateBanner, validateTileLayout, validateSupporterTiles } from './src/utils/pageTiles.js';
import { PRODUCTS } from './src/constants/products.js';
import { calculateCart, expandClubYearLines, expandPeopleLines, NEXT_YEAR_LINE_SUFFIX } from './src/utils/pricing.js';
import { clubYearOf, clubYearDates, clubYearLabel, clubYearKind, resolveClubYearChoice, holdsForClubYear } from './src/utils/clubYear.js';
import { createClubYearSubscription, clubYearCancelAt } from './src/server/clubYearSubscription.js';
import { summariseVoucherCodes, voucherScope } from './src/utils/vouchers.js';
import { DISCOUNT_TYPES, discountDisplayStatus, discountFailure } from './src/utils/discountCodes.js';
import { REASON_REQUIRED, auditEntry, requiredReason } from './src/utils/auditLog.js';
import { validateCreditPayment, creditPaymentWording } from './src/utils/credits.js';
import { applyTripDiscounts, currentPrivilegeIds, isTripEvent, lockedProductIds } from './src/utils/tripDiscount.js';
import { eventShopState } from './src/utils/eventRoster.js';
import { sanitizePerson, validateCheckout, personInputErrors, membershipPartsNeeded, peopleGrantedMembership, lineMembershipRule, grantsMembership, contactEmail, isMembership, resolvedKind, withFamilyContacts, normaliseName, matchMembership, ageOn } from './src/utils/checkout.js';
import { membershipActivity, renewalConfirmationOpen, justgoUploadCanRetry } from './src/utils/membership.js';
import { orderReport, membershipReport, subscriptionWarning } from './src/utils/adminReports.js';
import { readJustgoSync } from './src/server/justgoSync.js';
import { buildRawEmail } from './src/utils/mail.js';
import { emailReplyTo, isVolunteerEmail, TREASURER_REPLY_TO } from './src/utils/emailReplyTo.js';
import { buildReceiptSummary, buildLinkedReceipt, receiptEmailCopy, receiptEmailHtml } from './src/utils/receipt.js';
import { assertLocalFirebase } from './src/utils/localFirebase.js';
import { loadStripeSubscribers, importStripeSubscribers, nextClubYearEnd, cancelStripeSubscription, stripeSubscriberReport } from './src/utils/stripeReports.js';
import { resolveCatalogue, validateEventSchedule, eventScheduleLabel } from './src/utils/catalogue.js';
import { productLimits, remainingStock, isSoldOut, wantedQuantities, stockProblem, withHold, itemLabel, isMerchandise } from './src/utils/inventory.js';
import { deletionAuditEntry } from './src/utils/privacy.js';
import { CURRENT_MEMBERSHIP_VERSION, CURRENT_ORDER_VERSION } from './src/utils/schema.js';
import { toPence, toPounds, newOrderGroups, paymentFailureRecord, orderPersonReference } from './src/utils/orders.js';
import { resolveOrderPeople } from './src/server/orderPeople.js';
import { householdForPerson, HOUSEHOLD_MEMBER_FIELDS, householdGroupKey } from './src/utils/households.js';
import { lineHolders, stripeItemLines, activeSubscriptionItems, subscriptionLive, endedAtCutoff, clubYearEndUpdate } from './src/utils/subscriptions.js';
import { registerGdprRoutes } from './src/server/gdpr.js';
import { rebaseBranch, rebaseWarning } from './src/server/githubRebase.js';
import { readContentDrafts } from './src/server/contentDrafts.js';
import { registerPolicyRoutes, syncPolicies, currentCheckoutPolicies } from './src/server/policies.js';
import { loadNotices, registerNoticeRoutes } from './src/server/notices.js';
import { checkNoticeAgreement, noticeVersionMap } from './src/utils/notices.js';
import { consentPrefill, photoConsentRecord, photoHistoryAdditions, retryConsentPrefill, wordingMatches } from './src/utils/consents.js';
import { isLive, liveReadinessProblems } from './src/utils/live.js';
import { allowedOrigins, isAllowedOrigin } from './src/utils/cors.js';
import { registerVolunteerRoutes } from './src/server/volunteers.js';
import { registerContactRoutes } from './src/server/contact.js';
import { applyVolunteerBenefits, volunteerPrivileges } from './src/utils/volunteering.js';
import { allocateMemberIds } from './src/utils/memberIds.js';
import { allocateRecordIds, reserveRecordIds } from './src/utils/recordIds.js';
import { registerEmailCodeRoutes } from './src/server/emailCodes.js';
import { registerMyDetailsRoutes } from './src/server/myDetails.js';
import { registerClubNightRoutes } from './src/server/clubNight.js';
import { volunteerCancellationPhases, scheduleWithoutPrices } from './src/utils/volunteerCancellation.js';
import { monthlyAdjustment, volunteerPriceFor } from './src/utils/volunteerAdjustments.js';
import { registerBoathouseRoutes } from './src/server/boathouse.js';
import { registerAdminAccessRoutes } from './src/server/adminAccess.js';
import { registerEventRosterRoutes } from './src/server/eventRosters.js';
import { registerMemberCheckRoutes } from './src/server/memberChecks.js';
import { registerReceiptEmailRoutes } from './src/server/receiptEmail.js';
import { registerTripDiscountRoutes } from './src/server/tripDiscounts.js';
import { registerRenewalRoutes } from './src/server/renewals.js';
import { registerKeyAccessRoutes } from './src/server/keyAccess.js';
import { registerItemActionRoutes, orderSubscriptions } from './src/server/itemActions.js';
import { rateLimit, baselineRateLimit } from './src/server/rateLimit.js';
import { isClubEmail } from './src/utils/adminAccess.js';
import { createAttention, registerAttentionRoutes } from './src/server/attention.js';
import { RETRY_LINK_DAYS, invoiceFailureEmail, invoicePeriodStart, orderFailureEmail, subscriptionPaymentReceipt, paidUpTo, restartBasket, retryBasket, splitLinkKey,
  subscriptionStoppedEmail, treasurerFailureEmail } from './src/utils/failedPayments.js';
import { writePurchaseTerms, loadTerms, loadEntitlements, loadPurchases, endTermItems } from './src/server/membershipTerms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const CLUB_REPLY_TO = 'secretary@forthcanoeclub.co.uk';
const attention = createAttention({ db: () => adminDb, sendEmail: (message) => sendEmail(message),
  alertEmail: process.env.STAFF_ALERT_EMAIL || 'committee@forthcanoeclub.co.uk' });

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

const failWith = (status, message) => Object.assign(new Error(message), { status });

/** The volunteer price for a monthly item's holders, from the catalogue price, or null without a shared benefit. */
const monthlyVolunteerPrice = async (item, tiers, catalogue, now = new Date()) => {
  const product = catalogue.find((entry) => entry.id === item.productId);
  if (!product || !item.membershipIds?.length) return null;
  const members = new Map((await adminDb.getAll(...item.membershipIds.map((id) => adminDb.collection('memberships').doc(id))))
    .filter((member) => member.exists).map((member) => [member.id, member.data()]));
  return volunteerPriceFor({ productId: item.productId, basePrice: Number(product.basePrice), membershipIds: item.membershipIds,
    clubYear: item.clubYear, members, tiers, now });
};

/** Removes a monthly item that is now a free volunteer benefit at the end of its paid period, keeping the other items. */
const scheduleVolunteerRemoval = async (reference, lineId, actor) => {
  const document = await reference.get();
  const item = document.data()?.items?.find((entry) => entry.lineId === lineId && entry.status === 'active');
  if (!item || !item.membershipIds?.length) throw failWith(404, 'Active monthly item not found.');
  if (item.cancelScheduledAt) throw failWith(409, 'Cancellation is already scheduled for this item.');
  if (![clubYearOf(), clubYearOf() + 1].includes(item.clubYear)) throw failWith(409, 'Only current or next-club-year benefits can be scheduled here.');
  const people = item.membershipIds.map((id) => ({ membershipId: id, lineIds: [item.lineId] }));
  const members = new Map((await adminDb.getAll(...item.membershipIds.map((id) => adminDb.collection('memberships').doc(id))))
    .filter((member) => member.exists).map((member) => [member.id, member.data()]));
  const priced = applyVolunteerBenefits([{ id: item.productId, lineId: item.lineId, basePrice: item.monthlyAmount,
    clubYearPart: item.clubYear > clubYearOf() ? 'next' : 'this' }], people, members, await loadVolunteerBenefits());
  if (!priced[0].volunteerBenefit || priced[0].basePrice !== 0) throw failWith(409, 'Every holder must have this item as a free volunteer benefit for its club year.');
  const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
  if (subscription.schedule) throw failWith(409, 'Stripe already has a schedule for this subscription. Manage that schedule in Stripe to preserve its other changes.');
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
  await adminDb.collection('auditLog').add(auditEntry({ kind: 'subscription', action: 'schedule-volunteer-benefit-cancellation',
    actor, at: Timestamp.now(), stripeSubscriptionId: document.id, lineIds: [item.lineId], cancelScheduledAt }));
  return cancelScheduledAt;
};

/** Charges a monthly item at the volunteer price from its next debit, without prorating the current period. */
const repriceVolunteerItem = async (reference, lineId, to, actor) => {
  const document = await reference.get();
  const record = document.data();
  const item = record?.items?.find((entry) => entry.lineId === lineId && entry.status === 'active');
  if (!item?.stripeItemId) throw failWith(404, 'Active monthly item not found in Stripe.');
  const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
  // A schedule would restore the old price at its next phase, so leave those to staff.
  if (subscription.schedule) throw failWith(409, 'Stripe has a schedule for this subscription. Change the price in Stripe.');
  const stripeItem = (subscription.items?.data || []).find((entry) => entry.id === item.stripeItemId);
  if (!stripeItem) throw failWith(409, 'The item is no longer on the Stripe subscription.');
  await stripeRequest(`subscription_items/${encodeURIComponent(item.stripeItemId)}`, [['proration_behavior', 'none'],
    ...monthlyPriceParams('', { monthlyPence: toPence(to) }, stripeId(stripeItem.price?.product))], 'POST',
  { idempotencyKey: `volunteer-price-${item.stripeItemId}-${Math.round(to * 100)}` });
  const at = Timestamp.now();
  const adjustment = { from: item.monthlyAmount, to, at };
  await reference.update({ items: record.items.map((entry) => entry.lineId === lineId && (entry.orderRef || record.orderRef) === (item.orderRef || record.orderRef)
    ? { ...entry, monthlyAmount: to, volunteerAdjustment: adjustment } : entry), updatedAt: at });
  const members = await adminDb.getAll(...item.membershipIds.map((id) => adminDb.collection('memberships').doc(id)));
  for (const member of members.filter((entry) => entry.exists)) {
    await member.ref.update({ subscriptionItems: (member.data().subscriptionItems || []).map((entry) => entry.subscriptionId === document.id
      && entry.lineId === lineId && entry.status === 'active' ? { ...entry, monthlyAmount: to } : entry) });
  }
  await adminDb.collection('auditLog').add(auditEntry({ kind: 'subscription', action: 'volunteer-price-change', actor, at,
    stripeSubscriptionId: document.id, lineIds: [lineId], from: item.monthlyAmount, to }));
};

/**
 * Applies a volunteer's benefit to monthly payments they already have: lower prices from the next debit, and free
 * items removed at the end of the paid period. Safe to repeat; each item reports what happened.
 */
const adjustVolunteerSubscriptions = async (membershipId, now = new Date()) => {
  if (!adminDb || !membershipId) return [];
  const snapshot = await adminDb.collection('subscriptions').where('membershipIds', 'array-contains', membershipId).limit(20).get();
  if (snapshot.empty) return [];
  const [tiers, catalogue] = await Promise.all([loadVolunteerBenefits(),
    resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id })))]);
  const results = [];
  for (const document of snapshot.docs.filter((entry) => entry.data().status === 'active')) {
    const items = (document.data().items || []).filter((item) => item.membershipIds?.includes(membershipId));
    // Price changes first: a removal creates a Stripe schedule, after which prices must be changed in Stripe.
    const plans = [];
    for (const item of items) {
      const plan = monthlyAdjustment({ item, volunteerPrice: await monthlyVolunteerPrice(item, tiers, catalogue, now), now });
      if (plan) plans.push({ item, plan });
    }
    plans.sort((a, b) => (a.plan.action === 'remove') - (b.plan.action === 'remove'));
    for (const { item, plan } of plans) {
      const result = { subscriptionId: document.id, lineId: item.lineId, name: item.name, ...plan };
      try {
        if (plan.action === 'remove') result.endsAt = (await scheduleVolunteerRemoval(document.ref, item.lineId, { uid: 'volunteer-benefits' })).toDate().toISOString();
        else await repriceVolunteerItem(document.ref, item.lineId, plan.to, { uid: 'volunteer-benefits' });
        results.push({ ...result, status: 'done' });
      } catch (error) {
        console.error('Could not adjust volunteer monthly payment %s/%s: %s', document.id, item.lineId, error.message);
        results.push({ ...result, status: 'failed', error: error.message.slice(0, 300) });
      }
    }
  }
  return results;
};

const scheduleVolunteerCancellation = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!adminDb) return res.status(503).json({ error: 'Subscription storage is not configured.' });
    const reference = adminDb.collection('subscriptions').doc(req.params.id);
    const cancelScheduledAt = await scheduleVolunteerRemoval(reference, req.params.lineId, admin);
    res.json({ subscription: subscriptionView(await reference.get()), cancelScheduledAt: cancelScheduledAt.toDate().toISOString() });
  } catch (error) {
    console.error('Could not schedule volunteer benefit cancellation:', error.message);
    res.status(error.status || 502).json({ error: error.status ? error.message : `Could not schedule cancellation: ${error.message}` });
  }
};

// Cloud Run sits behind one Google front end; trusting that hop gives each visitor their own rate-limit bucket.
app.set('trust proxy', process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : (process.env.K_SERVICE ? 1 : false));
app.disable('x-powered-by');

const corsOrigins = allowedOrigins(process.env);
const allowLocalhostOrigins = !isLive() || process.env.LOCAL_FIREBASE_EMULATORS === 'true';
app.use(compression());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // API responses only; page headers (including the receipt pages) are set by Firebase Hosting in firebase.json.
  res.set({ 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet' });
  // Receipt lookups carry their access token in the URL: never cache them or leak them in a Referer header.
  if (/^\/api\/(orders\/|checkout-receipt)/.test(req.path)) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  }
  next();
});
app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin, corsOrigins, { allowLocalhost: allowLocalhostOrigins })),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Email-Session', 'X-Firebase-AppCheck', ...(process.env.LOCAL_FIREBASE_EMULATORS === 'true' ? ['X-Test-Now'] : [])],
  maxAge: 600
}));
// Cloud Run is the API origin; public page crawling belongs on Firebase Hosting.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});
// Every API route shares one per-visitor ceiling; routes add tighter limits.
app.use(baselineRateLimit);
app.use(appCheckMiddleware({
  mode: process.env.APP_CHECK_MODE || 'monitor',
  local: process.env.LOCAL_FIREBASE_EMULATORS === 'true',
  appIds: (process.env.APP_CHECK_APP_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
  verifyToken: (token) => getAppCheck(getApps()[0] || initializeAdminApp()).verifyToken(token)
}));

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
  }).catch((error) => { throw Object.assign(new Error(`Could not reach Stripe: ${error.message}`), { transient: true }); });
  const data = await response.json().catch(() => ({}));
  // Rate limits and Stripe-side faults are worth retrying; anything else Stripe refused stays refused.
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Stripe request failed.'), { stripeCode: data.error?.code, stripeStatus: response.status,
    transient: response.status === 429 || response.status >= 500 || ['lock_timeout', 'idempotency_key_in_use'].includes(data.error?.code) });
  return data;
};

// Checkout is tied to a Stripe customer holding the email given at the start, so Stripe shows it read-only
// and subscriptions cannot end up under a different address from the order.
const stripeCustomerFor = async (email) => {
  const existing = await stripeRequest(`customers?${new URLSearchParams({ email, limit: '1' })}`, null, 'GET');
  return existing.data?.[0]?.id || (await stripeRequest('customers', [['email', email]])).id;
};

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
    familyTier: data.membershipTier === 'family'
  };
};

const stripeSubscriptionIsActive = async (member) => {
  if (!member.stripeMembershipSubscriptionId) return true;
  const mode = member.stripeMembershipMode || 'test';
  const secrets = [process.env.STRIPE_REPORT_SECRET_KEY, process.env.STRIPE_SECRET_KEY]
    .filter((secret) => /^(sk|rk)_(test|live)_/.test(secret || '') && secret.includes(`_${mode}_`));
  if (!secrets.length) throw new Error('Stripe subscription validation is not configured for this mode.');
  const subscription = await stripeReportRequest(secrets[0])(
    `subscriptions/${encodeURIComponent(member.stripeMembershipSubscriptionId)}?expand[]=customer&expand[]=latest_invoice.payment_intent.latest_charge`
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

/** Deletes for the fields of `previous` that `next` does not have. */
const staleFields = (previous, next) => Object.fromEntries(Object.keys(previous && typeof previous === 'object' ? previous : {})
  .filter((key) => !Object.hasOwn(next, key)).map((key) => [key, FieldValue.delete()]));

const recordPurchase = (transaction, { orderRef, order, paidAt, householdSnapshots = new Map(), memberSnapshots = new Map() }) => {
  const paidYear = clubYearOf(paidAt.toDate());
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
    // Event tickets stay on the order; other lines are entitlements on that club year's membership term.
    const entitlementLines = lines.filter((item) => !isMembership(item) && item.category !== 'EVENTS');
    const termMemberships = new Map(coveredYears.map((year) => {
      const line = membershipLines.findLast((item) => yearOf(item) === year);
      return [year, line ? { line, included: false } : { line: includedLines.findLast((item) => yearOf(item) === year), included: true }];
    }));
    writePurchaseTerms(transaction, adminDb, { membershipId: person.membershipId, orderRef, paidAt, memberships: termMemberships,
      tier: membershipLine ? membershipLine.membershipTier || '' : grantedTier, entitlementLines, yearOf });
    const { id, lineIds, membershipId, existingMember, householdId, ownKitLineIds, grantMembership: _grant, grantMembershipYears: _years, heldClubYears: _held, subscriptionGroup: _group, ...details } = person;
    for (const key of HOUSEHOLD_MEMBER_FIELDS) delete details[key];
    const previous = memberSnapshots.get(membershipId)?.data();
    // A parent or guardian answers for anyone under 18 when the order is created.
    const by = person.junior || (ageOn(person.dob, (order.createdAt || paidAt).toDate()) ?? 18) < 18 ? 'guardian' : 'self';
    const photoConsentAsked = order.photoConsentAsked === true || !existingMember;
    const photoAnsweredAt = order.createdAt || paidAt;
    const photoVideo = photoConsentAsked ? photoConsentRecord({ policy: order.policyVersions?.photoVideo, accepted: person.photoConsent === true, at: photoAnsweredAt, by,
      source: 'checkout', orderRef, notices: order.noticeAgreement?.versions }) : null;
    const previousPhoto = previous?.consents?.photoVideo;
    const previousPhotoAt = previousPhoto?.recordedAt?.toMillis?.();
    const photoAnswerAt = photoAnsweredAt?.toMillis?.();
    const newerPhotoAnswerExists = Number.isFinite(previousPhotoAt) && Number.isFinite(photoAnswerAt) && previousPhotoAt >= photoAnswerAt;
    const writePhotoConsent = photoConsentAsked && !newerPhotoAnswerExists;
    const photoHistory = photoConsentAsked ? photoHistoryAdditions(previous?.consents, photoVideo) : [];
    transaction.set(adminDb.collection('memberships').doc(membershipId), {
      ...(existingMember ? {} : {
        ...details, source: 'website', renewalMethod: 'website', createdAt: paidAt, searchName: normaliseName(`${person.firstName} ${person.lastName}`)
      }),
      // Non-members booking open events are kept as contact-only records until they buy a membership.
      ...(membershipLine || includedLine ? { contactOnly: FieldValue.delete() } : existingMember ? {} : { contactOnly: true }),
      // Existing records keep their version so the migration still converts anything older they hold.
      ...(existingMember ? {} : { schemaVersion: CURRENT_MEMBERSHIP_VERSION }),
      ...(householdId ? { householdId } : {}),
      ...Object.fromEntries(HOUSEHOLD_MEMBER_FIELDS.map((key) => [key, FieldValue.delete()])),
      // Consent is recorded against the wording version shown at checkout; the disclaimer is re-accepted on every purchase.
      consents: {
        disclaimer: { ...order.policyVersions?.disclaimer, acceptedAt: paidAt, by },
        ...(writePhotoConsent ? {
          // A merged write keeps fields the new answer lacks (such as legacyUnversioned), so those are deleted.
          photoVideo: { ...staleFields(previousPhoto, photoVideo), ...photoVideo }
        } : {}),
        ...(photoHistory.length ? { photoVideoHistory: FieldValue.arrayUnion(...photoHistory) } : {}),
        // The person paying agrees to the club notices for everyone on the order; the latest agreement replaces the last.
        ...(order.noticeAgreement ? { notices: { ...order.noticeAgreement, orderRef, by: 'purchaser' } } : {})
      },
      ...(membershipLine || includedLine ? { status: 'active', validUntil, clubYears: FieldValue.arrayUnion(...new Set([...(person.heldClubYears || []), ...coveredYears])), membershipTier: membershipLine ? membershipLine.membershipTier || '' : grantedTier, justgoSyncStatus: 'pending', renewalMethod: 'website', justgoUpload: { status: 'queued', attempts: 0, failures: 0, needsStaff: false, nextAttemptAt: paidAt, queuedAt: paidAt } } : {}),
      ...(membershipLine || includedLine ? { membershipAccessEndsAt: FieldValue.delete() } : {}),
      ...(previous && previous.source !== 'website' && previous.validUntil && !previous.membershipBeforeWebsite
        ? { membershipBeforeWebsite: { validUntil: previous.validUntil, source: previous.source || 'imported' } } : {}),
      // A monthly membership is linked to its subscription once that is set up after payment (setUpSubscriptions).
      ...(membershipLine && !membershipLine.monthly
        ? { stripeMembershipSubscriptionId: '', stripeMembershipMode: '' }
        : {}),
      ...(includedLine ? { stripeMembershipSubscriptionId: '', stripeMembershipMode: '', membershipIncludedWith: { productId: includedLine.id, name: includedLine.name, orderRef } } : {}),
      ...(lines.some((item) => item.id === 'keyhire') ? { keyAccess: { grantedAt: paidAt, source: 'purchase' } } : {}),
      updatedAt: paidAt
    }, { merge: true });
  }
};

const createFirestoreOrder = async ({ orderRef, email, items, totalPence, discountPence = 0, status, stripeSessionId = '', discountCode = '', people = [], siteUrl = '', billingMode = 'annual', receiptTokenHash = '', stockProductIds = [], policyVersions = null, noticeAgreement = null, subscriptionPlan = null, retryOf = '', restartOf = '', photoConsentAsked = false, payment = null }) => {
  if (!adminDb) throw new Error('Firebase Admin SDK is not configured.');
  await adminDb.collection('orders').doc(orderRef).create({
    schemaVersion: CURRENT_ORDER_VERSION,
    email: email.toLowerCase(),
    items,
    people,
    ...(photoConsentAsked ? { photoConsentAsked: true } : {}),
    stockProductIds,
    policyVersions,
    ...(noticeAgreement ? { noticeAgreement } : {}),
    totalPence,
    subtotalPence: totalPence + discountPence,
    discountPence,
    discountCode,
    status,
    siteUrl,
    billingMode,
    receiptTokenHash,
    ...newOrderGroups(stripeSessionId),
    ...(subscriptionPlan ? { subscriptionPlan } : {}),
    ...(retryOf ? { retryOf } : {}),
    ...(restartOf ? { restartOf } : {}),
    ...(payment ? { payment, paymentMethod: 'credit' } : {}),
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

/**
 * Terminal checkout failures update status but keep the saved order for support and retries. Returns the order when
 * this call changed it, so the caller can tell the customer once.
 */
const recordUnsuccessfulCheckout = async (session, status) => {
  const orderRef = session.metadata?.order_ref;
  if (!orderRef || !adminDb) return null;
  return adminDb.runTransaction(async (transaction) => {
    const orderDocument = adminDb.collection('orders').doc(orderRef);
    const document = await transaction.get(orderDocument);
    if (!document.exists) throw new Error('Order not found for unsuccessful Checkout Session.');
    const order = document.data();
    if (order.stripe?.sessionId !== session.id) throw new Error('Checkout Session does not match the order.');
    if (order.status !== 'pending') return null;
    const discountDocument = order.discountCode ? adminDb.collection('discountCodes').doc(order.discountCode) : null;
    const discount = discountDocument ? (await transaction.get(discountDocument)).data() : null;
    const stock = await readStock(transaction, order.stockProductIds || []);
    stock.forEach((snapshot) => dropHold(transaction, snapshot, orderRef));
    const timestamp = Timestamp.now();
    transaction.update(orderDocument, { status, 'stripe.processing': false, ...(status === 'expired' ? { expiredAt: timestamp }
      : { paymentFailure: paymentFailureRecord(order.paymentFailure, { at: timestamp }) }) });
    if (discountDocument && discount?.reservedByOrder === orderRef && discount.status !== 'used') {
      transaction.update(discountDocument, { reservedByOrder: null, reservedUntil: null });
    }
    return { ...order, orderRef };
  });
};

/** A declined PaymentIntent stays pending because Stripe Checkout can still retry it. */
const recordPaymentFailureAttempt = async (intent) => {
  const orderRef = intent.metadata?.order_ref;
  if (!orderRef || !adminDb) return;
  const orderDocument = adminDb.collection('orders').doc(orderRef);
  await adminDb.runTransaction(async (transaction) => {
    const document = await transaction.get(orderDocument);
    if (!document.exists || document.data().stripe?.paymentIntentId === intent.id && document.data().status === 'paid') return;
    transaction.update(orderDocument, { paymentFailure: paymentFailureRecord(document.data().paymentFailure, {
      at: Timestamp.now(),
      code: intent.last_payment_error?.code || '',
      declineCode: intent.last_payment_error?.decline_code || '',
      message: intent.last_payment_error?.message || ''
    }) });
  });
};

/**
 * Marks a pending order paid and writes its membership records, vouchers and stock holds.
 * Returns the order with its receipt token, or null when it was already fulfilled. `receiptToken` is the one checkout
 * created; when it is missing or does not match the order, a new one replaces it so the emailed link works.
 */
const fulfilOrder = async ({ orderRef, sessionId, amountTotal, paymentIntent = '', setupIntent = '', receiptToken: givenToken = '' }) => {
  let receiptToken = '';
  const fields = await adminDb.runTransaction(async (transaction) => {
    const orderDocument = adminDb.collection('orders').doc(orderRef);
    const document = await transaction.get(orderDocument);
    if (!document.exists) throw new Error('Order not found.');
    const order = document.data();
    if (order.stripe?.sessionId !== sessionId || order.totalPence !== amountTotal) {
      throw new Error('Payment does not match the order.');
    }
    if (order.fulfilment?.emailSent === true) return null;
    if (order.fulfilment?.emailSendingUntil?.toMillis() > Date.now()) throw Object.assign(new Error('Receipt delivery is already in progress.'), { busy: true });
    receiptToken = givenToken && tokenMatches(givenToken, order.receiptTokenHash) ? givenToken : createAccessToken();
    const stock = await readStock(transaction, order.stockProductIds || []);
    const discountDocument = order.discountCode ? adminDb.collection('discountCodes').doc(order.discountCode) : null;
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
    // The customer has paid, so the order stands; staff decide what to do about the code being used twice.
    const discountReused = Boolean(discount?.singleUse && discount.status === 'used' && discount.usedByOrder !== orderRef);
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
          code: voucher.code, label: voucher.name, type: 'credit', discountValue: voucher.value,
          ...(voucher.productId ? { sourceProductId: voucher.productId } : {}),
          productIds: voucher.scope.productIds, categories: voucher.scope.categories,
          status: 'active', singleUse: true, excludedCategories: ['MEMBERSHIP'],
          orderRef, email: order.email, createdAt: Timestamp.now(), expiresAt: voucher.expiresAt
        });
      }
    }
    if (discount?.singleUse && !discountReused) transaction.update(discountDocument, { status: 'used', usedByOrder: orderRef, usedAt: Timestamp.now() });
    // Paid stock holds never lapse; rebuilt from the order in case the reservation was already cleared.
    stock.forEach((snapshot) => transaction.set(snapshot.ref, {
      holds: withHold(snapshot.data()?.holds || {}, orderRef, wantedQuantities(order.items.filter((item) => item.id === snapshot.id)), Date.now(), null)
    }));
    const paidAt = order.paidAt || Timestamp.now();
    if (!order.fulfilment?.recordsWritten) recordPurchase(transaction, { orderRef, order, paidAt, householdSnapshots,
      memberSnapshots: new Map(memberDocuments.map((document) => [document.id, document])) });
    // The member and household records now hold everyone's details, so the order keeps only references to them.
    transaction.update(orderDocument, {
      people: (order.people || []).map(orderPersonReference),
      membershipIds: [...new Set((order.people || []).map((person) => person.membershipId).filter(Boolean))],
      status: 'paid', vouchers, receiptTokenHash: hashAccessToken(receiptToken), 'fulfilment.recordsWritten': true,
      'stripe.paymentIntentId': paymentIntent, ...(setupIntent ? { 'stripe.setupIntentId': setupIntent } : {}),
      paidAt, 'stripe.processing': false,
      ...(discountReused ? { discountReused: true } : {}),
      'fulfilment.emailSendingUntil': Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000))
    });
    return { ...order, vouchers, discountReused, discountUsedBy: discountReused ? discount.usedByOrder : '' };
  });
  if (fields?.discountReused) {
    await attention.raise('discount-reused', orderRef, { orderRef, email: fields.email,
      detail: `Single-use code ${fields.discountCode} was already used by ${fields.discountUsedBy}, but ${orderRef} has been paid with it, so the order went through. Decide whether to accept it or ask for the difference.` });
  }
  return fields && { ...fields, receiptToken };
};

/** Lets newly-qualified volunteers know the boathouse code, then emails the receipt. */
const deliverOrder = async (orderRef, given) => {
  const fields = await resolveOrderPeople(adminDb, given);
  // A volunteer who was inducted before joining gets their code once this purchase makes them a member.
  try {
    await settleVolunteersFor([fields.email, ...(fields.people || []).map(contactEmail)].map(normalizeEmail));
    for (const id of new Set((fields.people || []).map((person) => person.membershipId).filter(Boolean))) {
      await settleKeyAccess(adminDb.collection('memberships').doc(id));
    }
  }
  catch (error) { console.error('Could not check volunteer codes after payment:', error.message); }
  try {
    const emailSent = await sendOrderEmail({ email: fields.email, orderRef, receiptToken: fields.receiptToken, items: fields.items, people: fields.people, totalPence: fields.totalPence,
      vouchers: fields.vouchers, siteUrl: fields.siteUrl, billingMode: fields.billingMode, payment: fields.payment });
    await updateFirestoreOrder(orderRef, { 'fulfilment.emailSent': emailSent, 'fulfilment.emailSendingUntil': null, ...(emailSent ? { 'fulfilment.emailSentAt': Timestamp.now() } : {}) });
    if (!emailSent) throw new Error('Receipt email is not configured.');
  } catch (error) {
    await updateFirestoreOrder(orderRef, { 'fulfilment.emailSendingUntil': null });
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
    [key('[unit_amount]'), String(item.monthlyPence ?? item.pricePence)], [key('[recurring][interval]'), 'month']];
};

/**
 * Starts or joins one club year's monthly payments for a paid order. Checkout took the joining share of the current
 * month and saved the card or bank account; debits then run on the 1st from `firstDebitAt` and the subscription is
 * cancelled at the club-year end (1 March), so the last debit is 1 February. Items paid with the same details
 * as a live subscription for the same club year join it, so they share one debit; different details may belong to
 * someone else, so they get their own subscription. A subscription with a schedule (a volunteer's pending change)
 * is never joined, so the schedule cannot drop or re-add the new items.
 *
 * `onTarget` saves the subscription on the order as soon as it is known, so a later failure resumes on it rather
 * than leaving a live subscription the website does not know about. A resumed group adds only its missing items.
 */
const setUpSubscriptionGroup = async ({ order, orderRef, group, lineById, paymentMethod, customer, fingerprint, onTarget }) => {
  const firstDebit = unixSeconds(group.firstDebitAt);
  const subscriptionEnd = unixSeconds(group.cutoffAt);
  const debitPassed = firstDebit <= Date.now() / 1000;
  let target = null;
  let otherLive = false;
  if (group.stripeSubscriptionId) {
    target = await stripeRequest(`subscriptions/${encodeURIComponent(group.stripeSubscriptionId)}`, null, 'GET');
    if (['canceled', 'incomplete_expired'].includes(target.status)) {
      throw new Error(`Subscription ${target.id} was cancelled after set-up started, so nothing more was added to it. Set up the remaining monthly items by hand if they are still wanted.`);
    }
    if (group.created && subscriptionLive(target) && !target.cancel_at) {
      target = await clubYearCancelAt(stripeRequest, target.id, { subscriptionEnd, orderRef, clubYear: group.clubYear });
    }
  } else {
    const owned = await adminDb.collection('subscriptions').where('email', '==', order.email).where('status', '==', 'active').limit(20).get();
    for (const document of owned.docs.filter((candidate) => candidate.data().clubYear === group.clubYear)) {
      const candidate = await stripeRequest(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
      if (!subscriptionLive(candidate) || candidate.schedule) continue;
      if (await paymentFingerprint(stripeId(candidate.default_payment_method)) === fingerprint) {
        target = candidate;
        break;
      }
      otherLive = true;
    }
    if (target) await onTarget(target, false);
  }
  // Only items tagged with this order's line count as present; an unrelated single item must not be mistaken for one.
  const present = new Set((target?.items?.data || []).filter((item) => item.metadata?.order_ref === orderRef || item.price?.product?.metadata?.order_ref === orderRef
    || (group.created && group.stripeSubscriptionId)).map((item) => item.metadata?.line_id || item.price?.product?.metadata?.line_id).filter(Boolean));
  const missing = group.lineIds.filter((lineId) => !present.has(lineId));
  const products = new Map();
  for (const lineId of missing) {
    products.set(lineId, (await stripeRequest('products', [['name', itemLabel(lineById.get(lineId))], ['metadata[line_id]', lineId], ['metadata[order_ref]', orderRef]], 'POST',
      { idempotencyKey: `${orderRef}-${lineId}-product` })).id);
  }
  const itemMetadata = (prefix, lineId) => [[`${prefix}[line_id]`, lineId], [`${prefix}[order_ref]`, orderRef], [`${prefix}[club_year]`, String(group.clubYear)]];
  if (target) {
    const endUpdate = group.created ? null : clubYearEndUpdate(target, group.clubYear, subscriptionEnd);
    if (endUpdate) target = await stripeRequest(`subscriptions/${encodeURIComponent(target.id)}`, endUpdate, 'POST',
      { idempotencyKey: `${target.id}-club-year-end-${group.clubYear}-${subscriptionEnd}` });
    // A missed 1st (a delayed bank payment) is charged pro rata on the next debit; otherwise the next debit is a full month.
    for (const lineId of missing) {
      await stripeRequest('subscription_items', [['subscription', target.id], ['proration_behavior', debitPassed && target.status === 'active' ? 'create_prorations' : 'none'],
        ...monthlyPriceParams('', lineById.get(lineId), products.get(lineId)), ...itemMetadata('metadata', lineId)], 'POST', { idempotencyKey: `${orderRef}-${lineId}-item` });
    }
    return { subscription: missing.length ? await stripeRequest(`subscriptions/${encodeURIComponent(target.id)}`, null, 'GET') : target,
      created: Boolean(group.created), ...(group.newPaymentDetails ? { newPaymentDetails: true } : {}) };
  }
  const base = [['customer', customer], ['default_payment_method', paymentMethod], ['metadata[order_ref]', orderRef],
    ['metadata[club_year]', String(group.clubYear)], ['metadata[cutoff_at]', String(subscriptionEnd)],
    ...group.lineIds.flatMap((lineId, index) => [...monthlyPriceParams(`items[${index}]`, lineById.get(lineId), products.get(lineId)),
      ...itemMetadata(`items[${index}][metadata]`, lineId)])];
  const subscription = await createClubYearSubscription(stripeRequest, {
    base, firstDebit, subscriptionEnd, orderRef, clubYear: group.clubYear, onCreated: (created) => onTarget(created, true, otherLive)
  });
  return { subscription, created: true, newPaymentDetails: otherLive };
};

/** Writes one group's subscription, customer and member records. Repeating it writes the same values. */
const recordSubscriptionGroup = async ({ order, orderRef, plan, group, subscription, created, lineById, now }) => {
  const batch = adminDb.batch();
  const itemIds = stripeItemLines(subscription, group.lineIds);
  const items = group.lineIds.map((lineId) => {
    const line = lineById.get(lineId);
    return { lineId, orderRef, productId: line?.id || '', name: line?.name || '', monthlyAmount: toPounds(line?.monthlyPence ?? line?.pricePence),
      clubYear: group.clubYear, stripeItemId: itemIds.get(lineId) || '', ...lineHolders(lineId, order.people), status: 'active' };
  });
  const membershipIds = [...new Set(items.flatMap((item) => item.membershipIds))];
  const names = [...new Set(items.flatMap((item) => item.names))];
  batch.set(adminDb.collection('subscriptions').doc(subscription.id), {
    email: order.email, stripeMode: order.stripe?.mode || 'test', status: 'active', updatedAt: now, clubYear: group.clubYear,
    firstDebitAt: group.firstDebitAt, cancelAt: group.cutoffAt,
    orderRefs: FieldValue.arrayUnion(orderRef), items: FieldValue.arrayUnion(...items),
    ...(membershipIds.length ? { membershipIds: FieldValue.arrayUnion(...membershipIds) } : {}),
    ...(names.length ? { names: FieldValue.arrayUnion(...names) } : {}),
    ...(created ? { orderRef, createdAt: group.createdAt || now } : {})
  }, { merge: true });
  const isMembershipLine = (lineId) => lineById.get(lineId)?.category === 'MEMBERSHIP';
  for (const membershipId of membershipIds) {
    // Members see what they receive and who pays for it, even when the subscription belongs to someone else.
    const received = items.filter((item) => item.membershipIds.includes(membershipId)).map(({ lineId, productId, name, monthlyAmount, clubYear }) => ({
      subscriptionId: subscription.id, lineId, orderRef, productId, name, monthlyAmount, clubYear, payerEmail: order.email, status: 'active', startedAt: order.paidAt || now }));
    // The latest club year's membership subscription is the one checked when the member buys again.
    const latestMembershipYear = Math.max(0, ...(plan.groups || []).filter((candidate) => candidate.lineIds.some((lineId) => isMembershipLine(lineId)
      && lineHolders(lineId, order.people).membershipIds.includes(membershipId))).map((candidate) => candidate.clubYear));
    const ownsMembership = received.some((item) => isMembershipLine(item.lineId)) && group.clubYear === latestMembershipYear;
    batch.set(adminDb.collection('memberships').doc(membershipId), {
      subscriptionIds: FieldValue.arrayUnion(subscription.id), subscriptionItems: FieldValue.arrayUnion(...received),
      ...(ownsMembership ? { stripeMembershipSubscriptionId: subscription.id, stripeMembershipMode: order.stripe?.mode || 'test' } : {}) }, { merge: true });
  }
  await batch.commit();
  return itemIds;
};

const SETUP_LEASE_MS = 3 * 60 * 1000;
const SETUP_ALERT_AFTER = 3;

/**
 * Records the monthly items on a paid order against the payer's subscriptions, one per club year. Each item records
 * which members receive it. Progress is saved per group, so a repeat (Stripe resending the webhook, or a staff
 * retry) carries on where it stopped and Stripe calls use idempotency keys. A temporary fault leaves the plan
 * pending and returns `retryLater`; after a few attempts staff are told. A change Stripe refuses is marked failed
 * and raised for staff; any subscription already made is still recorded so it can be cancelled from the website.
 * Revoked items are left out, so a retry never restarts billing for something staff took back.
 */
const setUpSubscriptions = async (orderRef, { force = false } = {}) => {
  const orderReference = adminDb.collection('orders').doc(orderRef);
  const claimed = await adminDb.runTransaction(async (transaction) => {
    const order = (await transaction.get(orderReference)).data();
    const plan = order?.subscriptionPlan;
    if (order?.status !== 'paid' || !plan || (plan.recordedAt && !(force && plan.status === 'failed'))) return null;
    if (plan.runningUntil?.toMillis() > Date.now()) return { busy: true };
    const attempts = (plan.attempts || 0) + 1;
    const next = { ...plan, status: 'pending', recordedAt: null, error: '', runningUntil: Timestamp.fromMillis(Date.now() + SETUP_LEASE_MS), attempts };
    transaction.update(orderReference, { subscriptionPlan: next });
    return { order: { ...order, subscriptionPlan: next } };
  });
  if (!claimed) return { done: true };
  if (claimed.busy) return { retryLater: true };
  const order = await resolveOrderPeople(adminDb, claimed.order);
  let plan = order.subscriptionPlan;
  const revoked = new Set(order.items.filter((item) => item.revokedAt).map((item) => item.lineId));
  const lineById = new Map(order.items.map((item) => [item.lineId, item]));
  const now = Timestamp.now();
  const save = async (fields = {}) => {
    const subscriptionFor = new Map((plan.groups || []).filter((group) => group.stripeSubscriptionId)
      .flatMap((group) => group.lineIds.map((lineId) => [lineId, group.stripeSubscriptionId])));
    await orderReference.update({
      subscriptionPlan: plan,
      stripeSubscriptionIds: [...new Set(subscriptionFor.values())],
      items: order.items.map((item) => subscriptionFor.has(item.lineId)
        ? { ...item, stripeSubscriptionId: subscriptionFor.get(item.lineId), stripeSubscriptionItemId: plan.stripeItemIds?.[item.lineId] || item.stripeSubscriptionItemId || '' } : item),
      ...fields
    });
  };
  const setGroup = (index, fields) => { plan = { ...plan, groups: plan.groups.map((group, position) => position === index ? { ...group, ...fields } : group) }; };
  let failure = null;
  try {
    const intent = order.stripe?.paymentIntentId
      ? await stripeRequest(`payment_intents/${encodeURIComponent(order.stripe.paymentIntentId)}`, null, 'GET')
      : order.stripe?.setupIntentId ? await stripeRequest(`setup_intents/${encodeURIComponent(order.stripe.setupIntentId)}`, null, 'GET') : null;
    const paymentMethod = stripeId(intent?.payment_method);
    if (!paymentMethod) throw new Error('Stripe did not save a payment method at checkout.');
    const customer = stripeId(intent.customer) || await stripeCustomerFor(order.email);
    const fingerprint = await paymentFingerprint(paymentMethod);
    for (const [index, original] of (plan.groups || []).entries()) {
      if (original.recorded) continue;
      // A revoked line is never added again, even when its subscription already exists; a retry must not restart billing staff stopped.
      const group = { ...original, lineIds: original.lineIds.filter((lineId) => !revoked.has(lineId)) };
      if (!group.lineIds.length) { setGroup(index, { recorded: true, skipped: 'revoked' }); continue; }
      const onTarget = async (subscription, created, newPaymentDetails = false) => {
        setGroup(index, { stripeSubscriptionId: subscription.id, created, createdAt: now, ...(newPaymentDetails ? { newPaymentDetails: true } : {}) });
        await save();
      };
      const result = await setUpSubscriptionGroup({ order, orderRef, group, lineById, paymentMethod, customer, fingerprint, onTarget });
      const itemIds = await recordSubscriptionGroup({ order, orderRef, plan, group, subscription: result.subscription, created: result.created, lineById, now });
      setGroup(index, { stripeSubscriptionId: result.subscription.id, created: result.created, recorded: true,
        ...(result.newPaymentDetails ? { newPaymentDetails: true } : {}) });
      plan = { ...plan, stripeItemIds: { ...(plan.stripeItemIds || {}), ...Object.fromEntries(itemIds) } };
      await save();
    }
  } catch (error) {
    failure = error;
  }
  if (!failure) {
    plan = { ...plan, status: 'active', recordedAt: now, runningUntil: null, error: '',
      ...((plan.groups || []).some((group) => group.newPaymentDetails) ? { newPaymentDetails: true } : {}) };
    await save({ subscriptionSetupNeedsStaff: false });
    await attention.settle('subscription-setup', orderRef);
    return { done: true };
  }
  console.error('Could not set up the monthly payments on %s: %s', orderRef, failure.message);
  // Whatever Stripe already has is recorded, so staff can see and cancel it here.
  for (const [index, group] of (plan.groups || []).entries()) {
    if (!group.stripeSubscriptionId || group.recorded) continue;
    try {
      const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(group.stripeSubscriptionId)}`, null, 'GET');
      const present = stripeItemLines(subscription, group.lineIds);
      const partial = { ...group, lineIds: group.lineIds.filter((lineId) => present.has(lineId) && (!group.created ? subscription.items.data
        .find((item) => item.id === present.get(lineId))?.metadata?.order_ref === orderRef : true)) };
      if (partial.lineIds.length) {
        await recordSubscriptionGroup({ order, orderRef, plan, group: partial, subscription, created: group.created, lineById, now });
        setGroup(index, { partialLineIds: partial.lineIds });
      }
    } catch (error) { console.error('Could not record the partial subscription %s: %s', group.stripeSubscriptionId, error.message); }
  }
  const message = failure.message.slice(0, 300);
  if (failure.transient && plan.attempts < SETUP_ALERT_AFTER) {
    plan = { ...plan, status: 'pending', runningUntil: null, error: message };
    await save();
    return { retryLater: true };
  }
  plan = { ...plan, status: 'failed', error: message, recordedAt: now, runningUntil: null,
    partialSubscriptionIds: (plan.groups || []).map((group) => group.stripeSubscriptionId).filter(Boolean) };
  await save({ subscriptionSetupNeedsStaff: true });
  await attention.raise('subscription-setup', orderRef, { orderRef, email: order.email,
    detail: `Monthly payments for ${order.email} could not be set up: ${message}.${plan.partialSubscriptionIds.length
      ? ` Some are already live in Stripe (${plan.partialSubscriptionIds.join(', ')}) and are listed on the order.` : ' Nothing was set up in Stripe.'}`
      + (failure.transient ? ' Stripe kept failing; Retry once it is working again.' : ' Check the card or bank details with the member, then Retry, or refund.') });
  return { failed: true };
};

const subscriptionItemNames = (record) => {
  const active = (record.items || []).filter((item) => item.status === 'active');
  return [...new Set((active.length ? active : record.items || []).map((item) => item.name).filter(Boolean))];
};

/** New restart and cancel links for a subscription that has stopped; any earlier link stops working. */
const subscriptionLinks = async (reference, record) => {
  const token = createAccessToken();
  await reference.update({ restartTokenHash: hashAccessToken(token) });
  const order = record.orderRef ? (await adminDb.collection('orders').doc(record.orderRef).get()).data() : null;
  const site = publicSite(order?.siteUrl);
  const key = `${reference.id}.${token}`;
  return { restartUrl: `${site}/membership?restart=${key}`, cancelUrl: `${site}/payment-issue?subscription=${key}` };
};

/**
 * Stripe retries a failed monthly debit on its own schedule (see DEVELOPMENT.md). Each failure emails the member when
 * Stripe will try again; the final one (no retry scheduled) tells them the payments have stopped, with links to restart
 * or confirm they are stopping, copies the treasurer and is raised for staff. Stripe can send an event more than
 * once, so each invoice attempt is emailed once.
 */
const recordInvoiceFailed = async (invoice) => {
  const subscriptionId = stripeId(invoice.subscription || invoice.parent?.subscription_details?.subscription);
  const final = !invoice.next_payment_attempt;
  const attempt = invoice.attempt_count || 1;
  const amount = `£${((invoice.amount_due || 0) / 100).toFixed(2)}`;
  const reference = subscriptionId && adminDb ? adminDb.collection('subscriptions').doc(subscriptionId) : null;
  const notice = `${invoice.id}-${attempt}`;
  const record = reference ? await adminDb.runTransaction(async (transaction) => {
    const document = await transaction.get(reference);
    if (!document.exists) return null;
    if ((document.data().failureNotices || []).includes(notice)) return { ...document.data(), noticeSent: true };
    transaction.update(reference, { failureNotices: FieldValue.arrayUnion(notice),
      lastFailedInvoice: { id: invoice.id, attempt, final, at: Timestamp.now() }, updatedAt: Timestamp.now() });
    return document.data();
  }) : null;
  const email = record?.email || invoice.customer_email || '';
  const paidUntil = invoicePeriodStart(invoice);
  const details = { names: record?.names || [], itemNames: record ? subscriptionItemNames(record) : [], amountDuePence: invoice.amount_due || 0, attempt };
  if (record && !record.noticeSent && email) {
    const links = final ? await subscriptionLinks(reference, record) : {};
    await sendEmail({ to: email, ...invoiceFailureEmail({ ...details, nextAttempt: invoice.next_payment_attempt || null, paidUntil, ...links, contact: TREASURER_REPLY_TO }),
      record: { kind: 'invoice-failed', subscriptionId, invoiceId: invoice.id, attempt, final } })
      .catch(() => console.error('Could not email the failed debit.'));
    if (final) {
      await sendEmail({ to: TREASURER_REPLY_TO, ...treasurerFailureEmail({ ...details, email, subscriptionId, invoiceId: invoice.id, paidUntil }),
        record: { kind: 'treasurer-copy', subscriptionId, invoiceId: invoice.id } })
        .catch(() => console.error('Could not copy the treasurer on the failed debit.'));
      await reference.update({ finalFailureEmailedAt: Timestamp.now(), finalFailedInvoiceId: invoice.id });
    }
  }
  if (final) {
    await attention.raise('invoice-failed', invoice.id, { subscriptionId, email, alert: false,
      detail: `A monthly debit of ${amount} failed ${attempt} time${attempt === 1 ? '' : 's'} and Stripe has stopped retrying, so it cancels the subscription.`
        + (record ? ' The member was emailed links to restart the payments or confirm they are stopping, and the treasurer was copied. The monthly items end at the paid-up date once Stripe cancels.'
          : ' This subscription is not recorded on the website; check it in Stripe.') });
  }
};

/**
 * Emails the member a club receipt for each monthly payment Stripe collects. The checkout receipt covers what was paid
 * at checkout, which is never a subscription invoice; a free trial invoice (£0) is skipped. Subscriptions set up
 * outside this site (e.g. the old Bookwhen ones) have no record here, so their receipt goes to the payer's email on the
 * invoice and names the items from the invoice lines. Stripe can send an event more than once, so each invoice is
 * receipted once.
 */
const recordInvoicePaid = async (invoice) => {
  const subscriptionId = stripeId(invoice.subscription || invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId || !adminDb || !(invoice.amount_paid > 0)) return;
  const reference = adminDb.collection('subscriptions').doc(subscriptionId);
  const claim = await adminDb.runTransaction(async (transaction) => {
    const document = await transaction.get(reference);
    if (!document.exists) return { record: null };
    if ((document.data().receiptedInvoices || []).includes(invoice.id)) return null;
    transaction.update(reference, { receiptedInvoices: FieldValue.arrayUnion(invoice.id), updatedAt: Timestamp.now() });
    return { record: document.data() };
  });
  if (!claim) return;
  const { record } = claim;
  const email = record?.email || invoice.customer_email || '';
  if (!email) return;
  let receipt;
  if (record) {
    // Items are listed under Membership or Additional items as on the checkout receipt, so take each one's category from its order.
    const orderRefs = [...new Set((record.items || []).map((item) => item.orderRef).filter(Boolean))];
    const orders = orderRefs.length ? await adminDb.getAll(...orderRefs.map((orderRef) => adminDb.collection('orders').doc(orderRef))) : [];
    const categories = new Map(orders.flatMap((document) => (document.data()?.items || []).map((item) => [item.lineId, item.category])));
    receipt = subscriptionPaymentReceipt({ invoice, payerEmail: email, recovered: record.lastFailedInvoice?.id === invoice.id, linkedNames: record.names || [],
      items: (record.items || []).map((item) => ({ ...item, category: categories.get(item.lineId) || '' })) });
  } else {
    try {
      await adminDb.collection('invoiceReceipts').doc(invoice.id).create({ subscriptionId, at: Timestamp.now() });
    } catch (error) {
      if (error.code === 6) return;
      throw error;
    }
    const mirror = await adminDb.collection('stripeSubscriptions').doc(`FCC-${invoice.livemode ? 'live' : 'test'}-${subscriptionId}`).get();
    const [linked] = mirror.exists ? await withMemberNames([mirror.data()]) : [{ names: [] }];
    receipt = subscriptionPaymentReceipt({ invoice, payerEmail: email, linkedNames: linked.names });
  }
  try {
    await sendEmail({ to: email, subject: `Your Forth Canoe Club subscription payment receipt - ${receipt.orderRef}`,
      body: [receiptEmailCopy(receipt), '', `Questions about your monthly payments: ${TREASURER_REPLY_TO}.`].join('\n'), html: receiptEmailHtml(receipt, ''),
      record: { kind: 'invoice-paid', subscriptionId, invoiceId: invoice.id, receipt, ...(record ? {} : { setUpOutsideSite: true }) } });
  } catch {
    console.error('Could not email the monthly payment receipt for %s.', invoice.id);
  }
};

/**
 * Subscriptions are cancelled at the club-year end. Stripe stops retrying a failed 1 February debit then, so its
 * unpaid invoice is voided (no later collection) and the subscription is flagged for staff. Any other ending (Stripe
 * giving up on failed payments, or a cancellation outside this site) ends the monthly items at the date
 * they were paid up to, emails the member links to restart or confirm, and is flagged too.
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
  const endedEarly = !atCutoff && data.status === 'active';
  const reason = subscription.cancellation_details?.reason || 'reason not given';
  let paidUntil = null;
  if (endedEarly) {
    const unpaid = [];
    for (const status of ['open', 'uncollectible']) {
      unpaid.push(...((await stripeRequest(`invoices?${new URLSearchParams({ subscription: subscription.id, status, limit: '20' })}`, null, 'GET')).data || []));
    }
    const paidUpSeconds = paidUpTo(unpaid, periodEnd(subscription));
    paidUntil = paidUpSeconds ? Timestamp.fromMillis(paidUpSeconds * 1000) : null;
    const active = activeSubscriptionItems(data);
    // Stripe has already cancelled it, so the cut needs no further Stripe calls.
    const request = (path, body, method, options) => method === 'GET' && path === `subscriptions/${encodeURIComponent(subscription.id)}`
      ? Promise.resolve({ ...subscription, status: 'canceled' }) : stripeRequest(path, body, method, options);
    if (active.length) {
      await stopSubscriptionItems(reference, data, active, { email: 'stripe' }, 'cancel-subscription',
        `Stripe cancelled the monthly payments (${reason})`, request, { paidUntil });
    }
  }
  const now = Timestamp.now();
  await reference.set({
    ...(data.status === 'active' ? { status: 'ended' } : {}),
    endedAt: subscription.ended_at ? Timestamp.fromMillis(subscription.ended_at * 1000) : now, endedAtCutoff: atCutoff, updatedAt: now,
    ...(voided.length ? { voidedInvoices: voided } : {}),
    ...(paidUntil ? { paidUntil } : {}),
    ...((voided.length || endedEarly) ? { needsStaff: true } : {})
  }, { merge: true });
  let emailed = false;
  if (endedEarly && !data.finalFailureEmailedAt && data.email) {
    const links = await subscriptionLinks(reference, data);
    emailed = await sendEmail({ to: data.email, ...subscriptionStoppedEmail({ names: data.names || [], itemNames: subscriptionItemNames(data),
      paidUntil: paidUntil ? paidUntil.seconds : 0, ...links, contact: TREASURER_REPLY_TO }), record: { kind: 'subscription-stopped', subscriptionId: subscription.id } })
      .catch(() => console.error('Could not email the stopped subscription.'));
  }
  if (voided.length || endedEarly) {
    const paidUpText = paidUntil ? ` Its monthly items were ended at the date they were paid up to, ${paidUntil.toDate().toISOString().slice(0, 10)}.` : '';
    await attention.raise('subscription-ended', subscription.id, { subscriptionId: subscription.id, email: data.email || '',
      detail: voided.length
        ? `The club year ended with unpaid monthly debits (${voided.map((invoice) => `£${invoice.amountDue.toFixed(2)}`).join(', ')}); they were voided so the member is not chased later. Decide whether to ask for payment.`
        : `Monthly payments for ${(data.names || []).join(', ') || data.email} ended before the club-year end (${reason}), usually because Stripe gave up on failed debits.${paidUpText}`
          + ((data.finalFailureEmailedAt || emailed) ? ' The member was emailed links to restart the payments or confirm they are stopping.' : '') });
  }
};

const PROCESSING_HOLD_DAYS = 14;

/**
 * A completed Checkout Session that is still unpaid is a bank payment (Bacs) clearing over a few working days. The
 * order stays pending but is marked processing: its stock and single-use code stay held until it clears or fails.
 */
const recordPaymentProcessing = async (session) => {
  const orderRef = session.metadata?.order_ref;
  if (!orderRef || !adminDb) return;
  await adminDb.runTransaction(async (transaction) => {
    const orderDocument = adminDb.collection('orders').doc(orderRef);
    const order = (await transaction.get(orderDocument)).data();
    if (!order || order.stripe?.sessionId !== session.id || order.status !== 'pending' || order.stripe?.processing) return;
    const discountDocument = order.discountCode ? adminDb.collection('discountCodes').doc(order.discountCode) : null;
    const discount = discountDocument ? (await transaction.get(discountDocument)).data() : null;
    const stock = await readStock(transaction, order.stockProductIds || []);
    stock.forEach((snapshot) => transaction.set(snapshot.ref, {
      holds: withHold(snapshot.data()?.holds || {}, orderRef, wantedQuantities(order.items.filter((item) => item.id === snapshot.id)), Date.now(), null)
    }));
    if (discount?.singleUse && discount.reservedByOrder === orderRef && discount.status !== 'used') {
      transaction.update(discountDocument, { reservedUntil: Timestamp.fromMillis(Date.now() + PROCESSING_HOLD_DAYS * 24 * 60 * 60 * 1000) });
    }
    transaction.update(orderDocument, { 'stripe.processing': true, 'stripe.processingSince': Timestamp.now(), 'stripe.paymentIntentId': stripeId(session.payment_intent) });
  });
};

const personKey = (person) => `${normaliseName(person.firstName)}|${normaliseName(person.lastName)}`;

/** Where an earlier order covers one of the same people and items as this basket, or null. */
const basketOverlap = (orderRef, order, people, selected) => {
  const wanted = new Map(people.map((person) => [personKey(person),
    new Set((person.lineIds || []).map((lineId) => selected.find((line) => line.lineId === lineId)?.id).filter(Boolean))]));
  const overlap = (order.people || []).filter((person) => (person.lineIds || []).some((lineId) => {
    const productId = (order.items || []).find((item) => item.lineId === lineId || item.sourceLineId === lineId)?.id;
    return productId && wanted.get(personKey(person))?.has(productId);
  }));
  if (!overlap.length) return null;
  const keys = new Set(overlap.map(personKey));
  return { orderRef, itemNames: [...new Set((order.items || []).map((item) => item.name))],
    personIds: people.filter((person) => keys.has(personKey(person))).map((person) => person.id) };
};

/** An order from this email that is still clearing and covers one of the same people and items. */
const clearingOrderFor = async (email, people, selected) => {
  const pending = await adminDb.collection('orders').where('email', '==', email).where('status', '==', 'pending').limit(20).get();
  for (const document of pending.docs) {
    const clearing = document.data().stripe?.processing && basketOverlap(document.id, document.data(), people, selected);
    if (clearing) return clearing;
  }
  return null;
};

/**
 * Expires this email's other open Checkout Sessions; any that turn out to be paid are completed instead.
 * Returns the refs of orders that could not be expired, so the caller can check whether they were just paid.
 */
const expireEarlierCheckouts = async (email) => {
  const pending = await adminDb.collection('orders').where('email', '==', email).where('status', '==', 'pending').limit(20).get();
  const unexpired = [];
  for (const document of pending.docs) {
    const order = document.data();
    const sessionId = order.stripe?.sessionId || '';
    if (order.stripe?.processing || !/^cs_(?!free_)/.test(sessionId) || order.createdAt?.toMillis() < Date.now() - 25 * 60 * 60 * 1000) continue;
    try {
      const expired = await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}/expire`, [], 'POST');
      await recordUnsuccessfulCheckout(expired, 'expired');
    } catch (error) {
      unexpired.push(document.id);
      await reconcileCheckout(document.id, sessionId).catch((reconcileError) =>
        console.error('Could not reconcile the earlier checkout %s: %s', document.id, reconcileError.message));
    }
  }
  return unexpired;
};

/** Brings a pending order up to date with its Checkout Session, for when a webhook is late or was missed. */
const reconcileCheckout = async (orderRef, sessionId) => {
  const session = await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`, null, 'GET');
  if (session.metadata?.order_ref !== orderRef) return;
  if (session.status === 'expired') await recordUnsuccessfulCheckout(session, 'expired');
  else if (session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status)) await completeCheckout(session);
  else if (session.status === 'complete') await recordPaymentProcessing(session);
};

const publicSite = (siteUrl) => siteUrl || process.env.PUBLIC_SITE_URL || 'http://localhost:3000';

/**
 * Tells the customer a bank payment failed to clear, with links to retry it (the same basket, checked out again) or
 * cancel the order, and tells staff, once.
 */
const reportPaymentFailed = async (order) => {
  const site = publicSite(order.siteUrl);
  const itemNames = [...new Set((order.items || []).map((item) => item.name))];
  const token = createAccessToken();
  await updateFirestoreOrder(order.orderRef, { retryTokenHash: hashAccessToken(token),
    retryExpiresAt: Timestamp.fromMillis(Date.now() + RETRY_LINK_DAYS * 24 * 60 * 60 * 1000) });
  const key = `${order.orderRef}.${token}`;
  await sendEmail({ to: order.email, ...orderFailureEmail({ orderRef: order.orderRef, itemNames, retryUrl: `${site}/membership?retry=${key}`,
    cancelUrl: `${site}/payment-issue?order=${key}`, retryDays: RETRY_LINK_DAYS, contact: TREASURER_REPLY_TO }),
  record: { orderRef: order.orderRef, kind: 'payment-failed' } })
    .catch((error) => console.error('Could not email the payment failure for %s: %s', order.orderRef, error.message));
  await attention.raise('payment-failed', order.orderRef, { orderRef: order.orderRef, email: order.email, alert: false,
    detail: `The bank payment for ${itemNames.join(', ')} did not clear. The items and any code were released and the customer was emailed links to retry the payment or cancel the order. This clears when they pay again or cancel.` });
};

/**
 * Records a paid Checkout Session, sets up its monthly payments and then emails the receipt. Each step can be
 * repeated safely, so a failure returns an error (Stripe sends the webhook again) and is raised for staff.
 */
const completeCheckout = async (session) => {
  const orderRef = session.metadata?.order_ref;
  let fields;
  try {
    fields = await fulfilOrder({ orderRef, sessionId: session.id, amountTotal: session.amount_total ?? 0, paymentIntent: stripeId(session.payment_intent),
      setupIntent: stripeId(session.setup_intent), receiptToken: successUrlReceiptToken(session) });
  } catch (error) {
    if (!error.busy) {
      await attention.raise('order-unrecorded', orderRef, { orderRef, email: session.customer_details?.email || session.customer_email || '', data: { sessionId: session.id },
        detail: `Stripe took payment for ${orderRef} (Checkout Session ${session.id}) but the order could not be recorded: ${error.message}` });
    }
    throw error;
  }
  await attention.settle('order-unrecorded', orderRef);
  await linkResumedPayment(orderRef).catch(() => console.error('Could not close the payment link for a replaced order.'));
  // Monthly payments go first: a receipt email failing must not stop them being set up.
  const setup = await setUpSubscriptions(orderRef);
  if (fields) {
    try {
      await deliverOrder(orderRef, fields);
    } catch (error) {
      await attention.raise('receipt-email', orderRef, { orderRef, email: fields.email,
        detail: `Order ${orderRef} is paid and recorded but the receipt email could not be sent: ${error.message}` });
      throw error;
    }
  }
  if (setup.retryLater) throw new Error('Monthly payment setup is waiting to be retried.');
};

// Staff retries from the Needs attention list.
const attentionRetry = {
  'order-unrecorded': async (entry) => {
    const session = await stripeRequest(`checkout/sessions/${encodeURIComponent(entry.data?.sessionId || '')}`, null, 'GET');
    if (!['paid', 'no_payment_required'].includes(session.payment_status)) throw failWith(409, 'Stripe does not show this checkout as paid.');
    await completeCheckout(session);
    return 'Order recorded.';
  },
  'subscription-setup': async (entry) => {
    const result = await setUpSubscriptions(entry.orderRef, { force: true });
    const plan = (await adminDb.collection('orders').doc(entry.orderRef).get()).data()?.subscriptionPlan;
    if (result.retryLater) throw failWith(503, `Stripe is not responding (${plan?.error || 'try again shortly'}).`);
    if (result.failed) throw failWith(409, plan?.error || 'Stripe refused the setup.');
    return 'Monthly payments set up.';
  },
  'receipt-email': async (entry) => {
    const reference = adminDb.collection('orders').doc(entry.orderRef);
    const order = (await reference.get()).data();
    if (!order || order.status !== 'paid') throw failWith(409, 'The order is not paid.');
    if (order.fulfilment?.emailSent) return 'The receipt had already been sent.';
    // The plaintext token is not kept, so the resent receipt links with a new one.
    const receiptToken = createAccessToken();
    await reference.update({ receiptTokenHash: hashAccessToken(receiptToken) });
    await deliverOrder(entry.orderRef, { ...order, receiptToken });
    return 'Receipt sent.';
  }
};

app.post('/api/stripe/webhook', rateLimit(100, 60 * 1000), express.raw({ type: 'application/json', inflate: false }), async (req, res) => {
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
    if (event.type === 'checkout.session.expired') {
      await recordUnsuccessfulCheckout(event.data.object, 'expired');
      return res.json({ received: true });
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      const order = await recordUnsuccessfulCheckout(event.data.object, 'payment_failed');
      if (order) await reportPaymentFailed(order);
      return res.json({ received: true });
    }
    if (event.type === 'invoice.payment_failed') {
      await recordInvoiceFailed(event.data.object);
      return res.json({ received: true });
    }
    if (event.type === 'invoice.paid') {
      await attention.settle('invoice-failed', event.data.object.id, 'stripe', 'The debit was paid.');
      await recordInvoicePaid(event.data.object);
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
      const orderRef = session.metadata?.order_ref;
      if (!orderRef || !adminDb) return res.status(400).send('Order metadata is missing.');
      if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
        await recordPaymentProcessing(session);
        return res.json({ received: true });
      }
      // Setup-mode sessions (nothing due now, monthly payments to come) have no amount.
      await completeCheckout(session);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    res.status(500).send('Payment processing could not complete.');
  }
});

// Reject compressed bodies until a published body-parser release fixes GHSA-27r3-jxmh-p828.
// Page content carries each uploaded image's size links and preview (about 3 KB per image), so pages with many
// photos or supporter logos need a larger limit. The route still requires an admin and validates every field.
app.use('/api/admin/publish-page', express.json({ limit: '512kb', inflate: false }));
app.use(express.json({ limit: '100kb', inflate: false }));

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
const tokenMatches = (token, expectedHash) => {
  if (typeof token !== 'string' || !token || typeof expectedHash !== 'string' || !expectedHash) return false;
  const actualHash = hashAccessToken(token);
  return actualHash.length === expectedHash.length && crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
};
/** The receipt token checkout put in the Stripe success URL, so the receipt email can link with the same one. */
const successUrlReceiptToken = (session) => {
  try { return new URL(session?.success_url || '').searchParams.get('receipt_token') || ''; }
  catch { return ''; }
};
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
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Stripe request failed.'), {
    stripeCode: data.error?.code, stripeStatus: response.status
  });
  return data;
};

/** Names for staff come from the member records a mirrored subscriber pays for; erased or missing ones are left out. */
const withMemberNames = async (records) => {
  const ids = [...new Set(records.flatMap((record) => record.membershipIds || []))];
  const members = ids.length ? await adminDb.getAll(...ids.map((id) => adminDb.collection('memberships').doc(id))) : [];
  const names = new Map(members.filter((document) => document.exists)
    .map((document) => [document.id, `${document.data().firstName || ''} ${document.data().lastName || ''}`.trim()]));
  return records.map((record) => ({ ...record, names: (record.membershipIds || []).map((id) => names.get(id)).filter(Boolean) }));
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
      const { payerEmails, ...result } = await loadStripeSubscribers(stripeReportRequest(secret), cursor);
      const records = await withMemberNames(await importStripeSubscribers(adminDb, result.records, mode, result.checkedAt, payerEmails));
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
    const listed = req.query.kind === 'members' ? documents.map((document) => document.id) : [];
    const orders = req.query.kind === 'members' ? new Map()
      : new Map((await resolveOrderPeople(adminDb, documents.map((document) => ({ id: document.id, ...document.data() })))).map((order) => [order.id, order]));
    const [entitlements, purchases] = listed.length ? await Promise.all([loadEntitlements(adminDb, listed), loadPurchases(adminDb, listed)]) : [new Map(), new Map()];
    const records = documents.filter((document) => req.query.kind !== 'members' || document.data().contactOnly !== true).map((document) => (req.query.kind === 'members'
      ? membershipReport(document.id, { ...document.data(), entitlements: entitlements.get(document.id) || [], purchases: purchases.get(document.id) || [] }, now, households.get(document.data().householdId) || {}, justgoSync)
      : orderReport(document.id, orders.get(document.id), members)));
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
    const stored = text('orderRef') ? (await adminDb.collection('orders').doc(text('orderRef')).get()).data() : null;
    const order = stored ? await resolveOrderPeople(adminDb, stored) : null;
    const plan = order?.subscriptionPlan;
    // Lines that did reach Stripe are listed with their subscription above, so only the rest show as failed.
    const settled = new Set((plan?.groups || []).flatMap((group) => group.recorded ? group.lineIds : group.partialLineIds || []));
    const failedLineIds = (plan?.lineIds || []).filter((lineId) => !settled.has(lineId));
    res.json({ subscriptions: snapshot.docs.map(subscriptionView), volunteerCancellableLineIds,
      failed: plan?.status === 'failed' && failedLineIds.length ? [{ key: text('orderRef'), lineIds: failedLineIds, error: plan.error,
        names: [...new Set(failedLineIds.flatMap((lineId) => lineHolders(lineId, order.people).names))],
        itemNames: failedLineIds.map((lineId) => order.items.find((item) => item.lineId === lineId)?.name).filter(Boolean) }] : [] });
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
  const reason = requiredReason(req.body);
  if (!reason) return res.status(400).json({ error: REASON_REQUIRED });
  const reference = adminDb.collection('subscriptions').doc(String(req.params.id).slice(0, 100));
  const document = await reference.get();
  if (!document.exists) return res.status(404).json({ error: 'Subscription not found.' });
  const record = document.data();
  const active = activeSubscriptionItems(record);
  const ending = pick(active);
  if (!ending.length) return res.status(409).json({ error: 'Those monthly payments are already cancelled.' });
  const result = await stopSubscriptionItems(reference, record, ending, admin, action, reason);
  res.json(result);
};

/**
 * Stops monthly items and ends what they pay for. A membership paid by the whole subscription ends at the date it was
 * paid up to: the end of the current period, or `paidUntil` when given (Stripe cancelled it with debits unpaid).
 */
const stopSubscriptionItems = async (reference, record, ending, admin, action, reason, request = stripeRequest, { paidUntil: paidUntilGiven = null } = {}) => {
  const document = { id: reference.id };
  const active = activeSubscriptionItems(record);
  const stripeSubscription = await request(`subscriptions/${encodeURIComponent(document.id)}`, null, 'GET');
  const paidUntil = paidUntilGiven || (periodEnd(stripeSubscription) ? Timestamp.fromMillis(periodEnd(stripeSubscription) * 1000) : null);
  const wholeSubscription = ending.length === active.length;
  // A schedule (a volunteer's pending change) would add cancelled items back at its next phase, so it is edited instead.
  const scheduleId = stripeId(stripeSubscription.schedule);
  const endingPrices = ending.map((item) => stripeId(stripeSubscription.items?.data?.find((entry) => entry.id === item.stripeItemId)?.price));
  if (scheduleId && !wholeSubscription && stripeSubscription.status !== 'canceled' && endingPrices.some((price) => !price)) {
    throw new Error('A scheduled monthly item could not be matched in Stripe. Reconcile the schedule before cancelling so other members are not affected.');
  }
  const scheduleParams = scheduleId && !wholeSubscription && stripeSubscription.status !== 'canceled'
    ? scheduleWithoutPrices(await request(`subscription_schedules/${encodeURIComponent(scheduleId)}`, null, 'GET'),
      endingPrices)
    : null;
  if (scheduleId && !wholeSubscription && stripeSubscription.status !== 'canceled' && !scheduleParams) {
    throw new Error('Removing these scheduled items would stop other members too. Reconcile the Stripe schedule before cancelling.');
  }
  if (wholeSubscription) {
    if (stripeSubscription.status !== 'canceled') {
      if (scheduleId) await request(`subscription_schedules/${encodeURIComponent(scheduleId)}/cancel`, [['prorate', 'false']], 'POST');
      else await request(`subscriptions/${encodeURIComponent(document.id)}`, null, 'DELETE');
    }
  } else if (scheduleParams) {
    await request(`subscription_schedules/${encodeURIComponent(scheduleId)}`, scheduleParams, 'POST');
  } else {
    for (const item of ending) {
      if (!item.stripeItemId) throw new Error(`No Stripe item is recorded for ${item.name}.`);
      try {
        await request(`subscription_items/${encodeURIComponent(item.stripeItemId)}?proration_behavior=none`, null, 'DELETE');
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
  const terms = await loadTerms(adminDb, memberIds);
  for (const member of members.filter((entry) => entry.exists)) {
    const data = member.data();
    const linkedMembership = endsMembership && data.stripeMembershipSubscriptionId === document.id;
    endTermItems(batch, terms.get(member.id) || [], (item) => isEnding(item), paidUntilGiven && paidUntilGiven.toMillis() < now.toMillis() ? paidUntilGiven : now);
    const cutShort = linkedMembership && paidUntil && (!data.validUntil || data.validUntil.toMillis() > paidUntil.toMillis());
    if (cutShort) {
      for (const term of terms.get(member.id) || []) {
        if (term.data().source && term.data().end?.toMillis() > paidUntil.toMillis()) {
          batch.update(term.ref, { end: term.data().start?.toMillis() > paidUntil.toMillis() ? term.data().start : paidUntil, updatedAt: now });
        }
      }
    }
    batch.update(member.ref, {
      subscriptionItems: (data.subscriptionItems || []).map((item) => isEnding(item) && item.status === 'active'
        ? { ...item, status: 'cancelled', cancelledAt: now } : item),
      ...(linkedMembership ? { stripeMembershipSubscriptionId: '', monthlyPaymentsCancelledAt: now,
        ...(cutShort ? { validUntil: paidUntil } : {}) } : {}),
      updatedAt: now
    });
  }
  batch.set(adminDb.collection('auditLog').doc(), auditEntry({ kind: 'subscription', action: wholeSubscription ? 'cancel-subscription' : action,
    reason, actor: admin, at: now, stripeSubscriptionId: document.id, orderRefs, lineIds: [...endingLines] }));
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
    const reason = requiredReason(req.body);
    if (!reason) return res.status(400).json({ error: REASON_REQUIRED });
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
    const [record] = await withMemberNames(await importStripeSubscribers(adminDb, [result.record], mode, checkedAt));
    const batch = adminDb.batch();
    batch.set(registry, { immediateCancellationConfirmedAt: checkedAt, immediateCancellationConfirmedBy: admin.uid }, { merge: true });
    batch.set(adminDb.collection('auditLog').doc(`subscription_immediate-${mode}-${id}`), auditEntry({ kind: 'subscription', action: 'cancel-immediately',
      reason, actor: admin, at: new Date(checkedAt), stripeSubscriptionId: id, clubCustomerId, mode, changed: result.changed }), { merge: true });
    await batch.commit();
    res.json({ ...result, record, checkedAt });
  } catch (error) {
    console.error('Immediate subscription cancellation failed:', error.message);
    res.status(502).json({ error: 'Could not finish confirming and recording immediate cancellation. Check Stripe and refresh the report before retrying; Stripe may already have accepted the change.' });
  }
});

/**
 * Monthly items still being collected for an order or member, with the cancel action for each subscription.
 * Deleting the record would leave those debits running with nothing on the website to stop them.
 */
const activeMonthlyPaymentsFor = async (kind, id) => {
  const query = kind === 'orders' ? adminDb.collection('subscriptions').where('orderRefs', 'array-contains', id)
    : adminDb.collection('subscriptions').where('membershipIds', 'array-contains', id);
  const snapshot = await query.limit(50).get();
  return snapshot.docs.filter((document) => document.data().status === 'active').flatMap((document) => {
    const items = activeSubscriptionItems(document.data()).filter((item) => kind === 'orders'
      ? (item.orderRef || document.data().orderRef) === id : (item.membershipIds || document.data().membershipIds || []).includes(id));
    if (!items.length) return [];
    const base = `/api/admin/subscriptions/${encodeURIComponent(document.id)}`;
    return [{ id: document.id, email: document.data().email || '', itemNames: [...new Set(items.map((item) => item.name))],
      names: [...new Set(items.flatMap((item) => item.names || []))],
      cancelPaths: kind === 'orders' ? items.map((item) => `${base}/items/${encodeURIComponent(item.lineId)}/cancel`) : [`${base}/members/${encodeURIComponent(id)}/cancel`] }];
  });
};

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
    if (req.body.confirmId !== req.params.id) return res.status(400).json({ error: 'Tick the box to confirm deleting this record.' });
    const reason = requiredReason(req.body);
    if (!reason) return res.status(400).json({ error: REASON_REQUIRED });
    const activeMonthly = await activeMonthlyPaymentsFor(req.params.kind, req.params.id);
    let stoppedMonthly = [];
    if (activeMonthly.length && req.params.kind === 'members') {
      if (req.body.acknowledgeStripe !== true) {
        return res.status(409).json({ requiresStripeAcknowledgement: true,
          error: 'Check Stripe for any other subscription before deleting this record. Deleting website data does not stop payments.' });
      }
      // Stops this member's monthly items now, without a refund; others on the same subscription keep paying.
      try {
        for (const entry of activeMonthly) {
          const reference = adminDb.collection('subscriptions').doc(entry.id);
          const record = (await reference.get()).data();
          const ending = record ? activeSubscriptionItems(record).filter((item) => (item.membershipIds || record.membershipIds || []).includes(req.params.id)) : [];
          if (ending.length) await stopSubscriptionItems(reference, record, ending, admin, 'cancel-member', `Member record deleted: ${reason}`);
        }
      } catch (error) {
        return res.status(502).json({ error: `Stripe did not stop the monthly payments, so the record was not deleted: ${error.message}` });
      }
      stoppedMonthly = activeMonthly;
    } else if (activeMonthly.length) {
      return res.status(409).json({ code: 'active_monthly_payments', activeMonthly,
        error: 'This record still has monthly payments being collected. Cancel them first; deleting the record would not stop them.' });
    }
    const auditSecret = process.env.AUDIT_LOOKUP_SECRET || (localFirebase ? 'local-audit-secret' : '');
    if (!auditSecret) return res.status(503).json({ error: 'Deletion audit is not configured. Set AUDIT_LOOKUP_SECRET.' });
    const reference = collection.doc(req.params.id);
    const result = await adminDb.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return { status: 404, error: 'Record not found.' };
      const fields = document.data();
      if (fields.itemActionPending) return { status: 409, error: 'An item action is unfinished. Use Resume unfinished action under Purchased item actions before deleting this order.' };
      const orderPeople = req.params.kind === 'orders' ? (await resolveOrderPeople(adminDb, fields)).people : undefined;
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
      transaction.create(adminDb.collection('auditLog').doc(), auditEntry({ kind: 'deletion', action: 'delete-record', reason, actor: admin, at: Timestamp.now(),
        ...deletionAuditEntry({ kind: req.params.kind, id: req.params.id, fields, orderPeople, secret: auditSecret, stripeAcknowledged: req.body.acknowledgeStripe === true }) }));
      return { status: 200, success: true };
    });
    res.status(result.status).json({ ...result, ...(result.success ? { stoppedMonthly } : {}) });
  } catch (error) {
    console.error('Admin deletion failed:', error.message);
    res.status(500).json({ error: 'Could not delete record.' });
  }
});

registerGdprRoutes(app, { requireAdmin, db: () => adminDb, stripeReportRequest, localFirebase, normalizeEmail, isValidEmail,
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))),
  stopSubscriptionItems: async (subscriptionId, items, admin, stripeAdminRequest, reason) => {
    const reference = adminDb.collection('subscriptions').doc(subscriptionId);
    const record = (await reference.get()).data();
    if (!record) throw new Error('Subscription record disappeared during erasure. Reload the preview and retry.');
    const keys = new Set(items.map((item) => `${item.orderRef}/${item.lineId}`));
    const ending = activeSubscriptionItems(record).filter((item) => keys.has(`${item.orderRef || record.orderRef || ''}/${item.lineId}`));
    const request = (path, params, method = 'POST') => stripeAdminRequest(path, {
      method, ...(params ? { body: new URLSearchParams(params) } : {})
    });
    if (ending.length) await stopSubscriptionItems(reference, record, ending, admin, 'gdpr-erasure', `GDPR erasure: ${reason}`, request);
  } });
registerPolicyRoutes(app, { requireAdmin, db: () => adminDb, distDirectory: join(__dirname, 'dist'), siteUrl: process.env.PUBLIC_SITE_URL, live: isLive() });
registerNoticeRoutes(app, { requireAdmin, db: () => adminDb });
const { settleKeyAccess, notifyKeyAccess } = registerKeyAccessRoutes(app, { requireAdmin, db: () => adminDb, sendEmail: (message) => sendEmail(message) });
const { settleVolunteersFor, loadVolunteerBenefits, volunteerRenewalContent, sendVolunteerRenewals } = registerVolunteerRoutes(app, { requireAdmin, db: () => adminDb, sheets: () => sheets,
  toMembershipRecord, stripeSubscriptionIsActive, settleKeyAccess, sendEmail: (message) => sendEmail(message), requestNow,
  adjustVolunteerSubscriptions: (membershipId) => adjustVolunteerSubscriptions(membershipId),
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerContactRoutes(app, { sendEmail: (message) => sendEmail(message) });
registerBoathouseRoutes(app, { requireAdmin, db: () => adminDb, onCodeChanged: notifyKeyAccess });
const emailCodes = registerEmailCodeRoutes(app, { db: () => adminDb, sendEmail: (message) => sendEmail(message) });
registerMyDetailsRoutes(app, { db: () => adminDb, sendEmail: (message) => sendEmail(message), emailCodes, stripeRequest, live: () => isLive(),
  raiseAttention: (kind, key, details) => attention.raise(kind, key, details) });
const { sendDueRosters, canViewEventRosters } = registerEventRosterRoutes(app, { requireAdmin, db: () => adminDb, sendEmail: (message) => sendEmail(message),
  emailCodes, requestNow,
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerClubNightRoutes(app, { requireAdmin, db: () => adminDb, emailCodes, requestNow, live: () => isLive(), canViewEventRosters,
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerAttentionRoutes(app, { requireAdmin, db: () => adminDb, retry: attentionRetry });
registerItemActionRoutes(app, { requireAdmin, db: () => adminDb, stripeRequest,
  stopMonthlyItem: async (orderRef, item, admin, reason, action = 'revoke-item') => {
    const subscriptions = await orderSubscriptions(adminDb, orderRef);
    for (const document of subscriptions) {
      const record = document.data();
      const ending = activeSubscriptionItems(record).filter((entry) => entry.lineId === item.lineId && (entry.orderRef || record.orderRef) === orderRef);
      if (ending.length) await stopSubscriptionItems(document.ref, record, ending, admin, action, reason);
    }
  } });
registerAdminAccessRoutes(app, { requireAdmin, auth: () => adminAuth, db: () => adminDb, localFirebase });
registerMemberCheckRoutes(app, { requireAdmin, db: () => adminDb });
const { loadReceiptPersonFields, receiptPeopleWithRecords } = registerReceiptEmailRoutes(app, { requireAdmin, db: () => adminDb });
const { loadTripDiscounts } = registerTripDiscountRoutes(app, { requireAdmin, db: () => adminDb,
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))) });
registerRenewalRoutes(app, { requireAdmin, db: () => adminDb, sendEmail: (...args) => sendEmail(...args), requestNow: (req) => requestNow(req),
  volunteerRenewalContent, sendVolunteerRenewals, live: () => isLive(),
  loadCatalogue: async () => resolveCatalogue(PRODUCTS, (await adminDb.collection('products').get()).docs.map((document) => ({ ...document.data(), id: document.id }))),
  siteUrl: () => (process.env.PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '') });

app.get('/api/admin/page-drafts', rateLimit(30, 60 * 1000), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!await requireAdmin(req, res)) return;
    const token = process.env.GITHUB_CONTENT_TOKEN;
    if (!token) return res.status(503).json({ error: 'GitHub publishing is not configured on the API server.' });
    const repository = process.env.GITHUB_REPOSITORY || 'Riotshielder21/ForthCCWebsite';
    const branch = process.env.GITHUB_CONTENT_BRANCH || 'live/web-admin-edit';
    const base = process.env.GITHUB_BRANCH || 'main';
    const pages = await readContentDrafts(createGitHubClient(repository, token), branch, base);
    res.json({ branch, pages });
  } catch (error) {
    console.error('Could not check saved page drafts:', error.message);
    res.status(500).json({ error: error.message || 'Could not check saved page drafts.' });
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

    let publishedContent;
    try {
      publishedContent = validatePageFields(pageId, content);
    } catch (error) {
      return res.status(400).json({ error: error.message });
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
    if (BANNER_PAGES.includes(pageId) && content.banner !== undefined) {
      try {
        publishedContent.banner = validateBanner(pageId, content.banner);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    const github = createGitHubClient(repository, token);
    await ensureGitHubBranch(github, branch);
    const base = process.env.GITHUB_BRANCH || 'main';
    const rebase = await rebaseBranch(github, branch, base, CONTENT_COMMITTER());
    if (rebase.status === 'failed') console.warn('Content branch rebase failed:', rebase.reason);
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
        committer: CONTENT_COMMITTER()
      })
    });
    const result = await update.json();
    if (!update.ok) throw new Error(result.message || 'GitHub could not save the page file.');

    res.json({ success: true, branch, commit: result.commit.sha, url: result.content.html_url, rebase: rebase.status, warning: rebaseWarning(rebase, branch, base) });
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
    const rebase = await rebaseBranch(github, head, base, CONTENT_COMMITTER());
    if (rebase.status === 'failed') console.warn('Content branch rebase failed:', rebase.reason);
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
    res.json({ success: true, number: pullRequest.number, url: pullRequest.html_url, branch: head, assignee, notificationSent, rebase: rebase.status, warning: rebaseWarning(rebase, head, base) });
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
    const raw = buildRawEmail({ fromName: 'Forth Canoe Club Website', from: sender, to: recipient, replyTo: CLUB_REPLY_TO,
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

const CONTENT_COMMITTER = () => ({ name: 'FCC Website Content Manager', email: process.env.GITHUB_COMMIT_EMAIL || 'website@forthcanoeclub.co.uk' });

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

const publicDiscount = (discount) => ({
  label: discount.label || 'Discount', type: discount.type,
  discountValue: discount.discountValue, allowsAnnualStacking: discount.allowsAnnualStacking === true,
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
    if (action === 'retry' && !justgoUploadCanRetry(document.data().justgoUpload)) {
      return res.status(409).json({ error: 'This JustGo operation needs confirmation or staff reconciliation, not another upload. Check JustGo first, then mark it manually added once the correct coverage is confirmed.' });
    }
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
    const entitlements = await loadEntitlements(adminDb, allMembers.map((document) => document.id));
    res.json({
      email,
      vouchers: voucherDocs.map((document) => {
        const data = document.data();
        return {
          code: data.code, value: data.discountValue, orderRef: data.orderRef, usedByOrder: data.usedByOrder || '',
          status: discountDisplayStatus(data, now),
          createdAt: data.createdAt?.toMillis() || 0, expiresAt: data.expiresAt?.toMillis() || 0, usedAt: data.usedAt?.toMillis() || 0
        };
      }).sort((a, b) => b.createdAt - a.createdAt),
      memberships: allMembers.map((document) => {
        const data = document.data();
        return {
          id: document.id, name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.name || 'Unnamed',
          membershipTier: data.membershipTier || '', status: data.status === 'active' && data.validUntil?.toMillis() <= now ? 'expired' : data.status || 'unknown',
          validUntil: data.validUntil?.toMillis() || 0, affiliationNumber: data.affiliationNumber || '', membershipNumber: data.membershipNumber || '',
          privileges: (entitlements.get(document.id) || []).filter((item) => !item.endedAt).map((item) => item.name)
        };
      }),
      orders: orderSnapshot.docs.map((document) => {
        const data = document.data();
        return { orderRef: document.id, status: data.status, total: toPounds(data.totalPence), createdAt: data.createdAt?.toMillis() || 0, items: (data.items || []).map((item) => item.name) };
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
      status: data.status, expiresAt: data.expiresAt?.toMillis() || 0
    })), now);
    const codes = snapshot.docs.map((document) => document.data()).filter((data) => !data.orderRef).map((data) => ({
      code: data.code, label: data.label || '', type: data.type,
      discountValue: data.discountValue, productIds: Array.isArray(data.productIds) ? data.productIds : [],
      singleUse: data.singleUse === true, status: data.status,
      expired: data.expiresAt?.toMillis() <= now, expiresAt: data.expiresAt?.toMillis() || 0, createdAt: data.createdAt?.toMillis() || 0
    })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
    res.json({ codes, vouchers });
  } catch (error) {
    console.error('Could not list discount codes:', error.message);
    res.status(500).json({ error: 'Could not load discount codes.' });
  }
});

const parseDiscountFields = (body, { requireFutureExpiry }) => {
  const { label, type } = body;
  const discountValue = Number(body.discountValue);
  const expiry = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const productIds = Array.isArray(body.productIds) ? body.productIds : [];
  if (typeof label !== 'string' || !label.trim() || label.length > 120 ||
      !DISCOUNT_TYPES.includes(type) || !Number.isFinite(discountValue) || discountValue <= 0 ||
      (type === 'multiplier' && discountValue > 1) || !Number.isFinite(expiry.getTime()) || (requireFutureExpiry && expiry <= new Date())) {
    return { error: 'Enter a valid label, discount value and expiry.' };
  }
  if (productIds.length > 50 || productIds.some((id) => typeof id !== 'string' || id.length > 100)) {
    return { error: 'Choose valid products for this code.' };
  }
  return { fields: {
    label: label.trim(), type, discountValue, productIds: [...new Set(productIds)],
    singleUse: type === 'credit' || body.singleUse === true, expiresAt: Timestamp.fromDate(expiry)
  } };
};

app.patch('/api/admin/discount-codes/:code', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    if (!adminDb) return res.status(503).json({ error: 'Discount storage is not configured.' });
    const document = await findDiscountCode(String(req.params.code).toUpperCase());
    if (!document || document.data().orderRef) return res.status(404).json({ error: 'Discount code not found.' });
    if ('status' in req.body && Object.keys(req.body).length === 1) {
      if (!['active', 'disabled'].includes(req.body.status)) return res.status(400).json({ error: 'A code can only be turned on or off.' });
      if (document.data().status === 'used') return res.status(409).json({ error: 'This code has been used.' });
      await document.ref.update({ status: req.body.status });
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
      code, ...fields, status: 'active',
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
    ))).flatMap((snapshot) => snapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
    const records = [...new Map([...legacy.docs.map((document) => ({ ...document.data(), id: document.id })), ...householdMembers]
      .filter(({ firstName, lastName }) => firstName && lastName)
      .map((record) => [`${record.firstName} ${record.lastName}|${record.dob || ''}`, record])).values()];
    const names = new Map();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      const matched = records.filter((record) => record.dob === dob);
      // Checkout ticks in advance only what a matched person agreed to the current wording; the server still checks on payment.
      const [policies, noticeVersions, entitlements, volunteerTiers, tripRules] = matched.length
        ? await Promise.all([currentCheckoutPolicies(adminDb, isLive()), loadNotices(adminDb).then(noticeVersionMap),
          loadEntitlements(adminDb, matched.map((record) => record.id)), loadVolunteerBenefits(), loadTripDiscounts()]) : [];
      const now = requestNow(req);
      for (const record of matched) {
        const { firstName, lastName, volunteer } = record;
        // Only the products that discount single-day trips, so checkout can show the price the server will charge.
        const tripHeld = [...new Set(currentPrivilegeIds([...(entitlements.get(record.id) || []), ...volunteerPrivileges(record, volunteerTiers, now)], now))]
          .filter((id) => lockedProductIds(tripRules).includes(id));
        names.set(`${firstName} ${lastName}`.toLowerCase(), { firstName, lastName, ...(tripHeld.length ? { tripHeld } : {}),
          ...(volunteer?.inducted ? { volunteer: { inducted: true, years: Object.fromEntries(Object.entries(volunteer.years || {})
            .map(([year, value]) => [year, { active: value.active === true, tier: value.tier }])) } } : {}),
          prefill: consentPrefill(record, policies, noticeVersions) });
      }
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
    const find = () => adminDb.collection('orders').where('stripe.sessionId', '==', sessionId).limit(1).get();
    let snapshot = await find();
    if (snapshot.empty) return res.status(404).json({ error: 'Checkout order not found.' });
    const order = snapshot.docs[0].data();
    // If the webhook is late or missing, ask Stripe directly (at most every 15 seconds per order).
    if (order.status === 'pending' && !order.stripe?.processing && !sessionId.startsWith('cs_free_')
      && Date.now() - order.createdAt.toMillis() > 10 * 1000 && !(order.stripe?.reconciledAt?.toMillis() > Date.now() - 15 * 1000)) {
      await snapshot.docs[0].ref.update({ 'stripe.reconciledAt': Timestamp.now() });
      await reconcileCheckout(snapshot.docs[0].id, sessionId).catch((error) => console.error('Could not reconcile %s: %s', snapshot.docs[0].id, error.message));
      snapshot = await find();
    }
    const current = snapshot.docs[0].data();
    return res.json({ status: current.status === 'pending' && current.stripe?.processing ? 'processing' : current.status || 'pending' });
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
    const snapshot = await adminDb.collection('orders').where('stripe.sessionId', '==', sessionId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ error: 'Receipt not found.' });
    const document = snapshot.docs[0];
    const order = document.data();
    if (!tokenMatches(token, order.receiptTokenHash)) return res.status(404).json({ error: 'Receipt not found.' });
    if (order.status !== 'paid') return res.status(409).json({ status: order.status || 'pending' });
    const receipt = buildReceiptSummary(document.id, await resolveOrderPeople(adminDb, order));
    return res.json({ receipt, copy: receiptEmailCopy(receipt) });
  } catch (error) {
    console.error('Could not load checkout receipt:', error.message);
    return res.status(503).json({ error: 'Receipt service is unavailable.' });
  }
});

/**
 * Validates, prices and records a basket. A checkout then goes to Stripe; a staff credit (`credit` holds how it was
 * paid outside the website) runs the same checks and fulfilment with no Stripe payment.
 */
const startCheckout = async (req, res, credit = null) => {
  let reservedDocument;
  let reservedStockIds = [];
  let createdSessionId = '';
  let orderCreated = false;
  // One reference for the whole request, so a failure releases exactly what this attempt reserved.
  const orderRef = generateOrderRef();
  try {
    const email = normalizeEmail(req.body.email);
    const { items: requestedItems } = req.body;
    // Credits are priced as one payment: there is no Stripe subscription to take monthly debits.
    const billingMode = credit ? 'annual' : req.body.billingMode ?? 'annual';
    if (!credit && !process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe test mode is not configured.' });
    if (!isValidEmail(email) || !Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 20 || !['annual', 'monthly'].includes(billingMode)) {
      return res.status(400).json({ error: 'Enter a valid email address and include at least one item.' });
    }

    if (!adminDb) return res.status(503).json({ error: 'Order storage is not configured.' });
    // A retry or restart link's checkout records what it replaces, and is refused once that has been paid again.
    const retried = !credit && req.body.retryOf ? await linkedOrder(req.body.retryOf) : null;
    if (retried?.order.retriedAs) {
      return res.status(409).json({ code: 'already_paid', error: `Your payment for this order already went through as order ${retried.order.retriedAs}, so you do not need to pay again.` });
    }
    const restarted = !credit && req.body.restartOf ? splitLinkKey(req.body.restartOf) : null;
    const restartRecord = restarted ? (await adminDb.collection('subscriptions').doc(restarted.id).get()).data() : null;
    const restartOf = restartRecord && tokenMatches(restarted.token, restartRecord.restartTokenHash) ? restarted.id : '';
    if (restartOf && restartRecord.restartedAs) {
      return res.status(409).json({ code: 'already_paid', error: `Your monthly payments were already restarted with order ${restartRecord.restartedAs}, so you do not need to pay again.` });
    }
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
      if (eventShopState(item) !== 'open') return res.status(400).json({ error: `Bookings for ${item.name} have closed. Remove it from your basket.` });
    }
    if (!Array.isArray(req.body.people) || req.body.people.length > 20) {
      return res.status(400).json({ error: 'Add the details for each person in your basket.' });
    }
    const rawPersonErrors = personInputErrors(req.body.people);
    if (rawPersonErrors.length) return res.status(400).json({ error: rawPersonErrors[0], details: rawPersonErrors });
    const sanitized = req.body.people.map(sanitizePerson);
    const people = sanitized
      .map((person) => ({ ...person, junior: resolvedKind(person, sanitized, selected) === 'junior' }))
      .map((person) => person.returning
        ? { ...person, email: person.email || email, guardian: { ...person.guardian, email: person.guardian.email || email } }
        : person);
    const detailErrors = validateCheckout({ lines: selected, people, now });
    if (detailErrors.length) return res.status(400).json({ error: detailErrors[0], details: detailErrors });
    // Answers are recorded against the wording version current here, so a page still showing older wording must reload.
    if (people.length && !wordingMatches(req.body.wording)) {
      return res.status(409).json({ code: 'wording_changed',
        error: 'The disclaimer or photo consent wording has changed since this page loaded. Reload the page, then read and tick them again.' });
    }
    const notices = checkNoticeAgreement(await loadNotices(adminDb), req.body.noticeVersions);
    if (notices.error) return res.status(400).json({ code: notices.code, error: notices.error });
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
    // Only the newest checkout for an email can be paid, so going back and starting again cannot charge twice.
    // This runs before the overlap checks so an earlier checkout that turns out to be paid or clearing is seen by them.
    for (const earlierRef of await expireEarlierCheckouts(email)) {
      const stored = (await adminDb.collection('orders').doc(earlierRef).get()).data();
      const earlier = stored && await resolveOrderPeople(adminDb, stored);
      const paid = earlier && ['paid', 'partially_refunded'].includes(earlier.status) && basketOverlap(earlierRef, earlier, people, selected);
      if (paid) {
        return res.status(409).json({ code: 'already_paid', personIds: paid.personIds,
          error: `Your earlier payment for ${paid.itemNames.join(', ')} (order ${paid.orderRef}) has gone through, so you do not need to pay again. Your receipt is on its way by email. Questions: secretary@forthcanoeclub.co.uk.` });
      }
    }
    // Club-year items cannot be bought twice for the same person and club year.
    const existingIds = [...new Set(storedPeople.filter((person) => person.existingMember).map((person) => person.membershipId))];
    const heldEntitlements = await loadEntitlements(adminDb, existingIds);
    const memberData = new Map(existingIds.length ? (await adminDb.getAll(...existingIds.map((id) => adminDb.collection('memberships').doc(id))))
      .filter((document) => document.exists).map((document) => [document.id, { ...document.data(), entitlements: heldEntitlements.get(document.id) || [] }]) : []);
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
    const clearing = await clearingOrderFor(email, people, selected);
    if (clearing) {
      return res.status(409).json({ code: 'payment_processing', personIds: clearing.personIds,
        error: `A payment for ${clearing.itemNames.join(', ')} (order ${clearing.orderRef}) is still clearing. Bank payments take a few working days and you will get a receipt by email when it clears, so you do not need to pay again. If it fails we will email you. Questions: secretary@forthcanoeclub.co.uk.` });
    }
    let promo = null;
    const code = !credit && typeof req.body.discountCode === 'string' ? req.body.discountCode.trim().toUpperCase() : '';
    const discountDocument = code ? await findDiscountCode(code) : null;
    if (code) {
      const message = discountFailure(discountDocument?.data());
      if (message) return res.status(400).json({ error: message });
      promo = publicDiscount(discountDocument.data());
    }
    // Single-day trips are discounted for attendees holding a qualifying product this club year, or buying one now.
    const tripPrivileges = new Map();
    const [volunteerTiers, tripRules] = await Promise.all([loadVolunteerBenefits(), loadTripDiscounts()]);
    if (selected.some(isTripEvent)) {
      for (const person of storedPeople) if (memberData.has(person.membershipId)) {
        const data = memberData.get(person.membershipId);
        tripPrivileges.set(person.id, [...data.entitlements, ...volunteerPrivileges(data, volunteerTiers, now)]);
      }
    }
    const volunteerLines = applyVolunteerBenefits(lines, storedPeople, memberData, volunteerTiers, now);
    const pricing = calculateCart(applyTripDiscounts(volunteerLines, storedPeople, tripPrivileges, now, tripRules), billingMode === 'annual', promo, now);
    if (promo && pricing.promoDiscountValue <= 0) return res.status(400).json({ error: 'This code does not apply to the items in your basket.' });
    const siteUrl = checkoutSiteOrigin(req);
    const receiptToken = createAccessToken();
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
      id: item.id, lineId: item.lineId, name: item.name, category: item.category, type: item.type, pricingMode: item.pricingMode, pricePence: toPence(item.displayPrice),
      monthly: Boolean(item.monthlyBilling && item.monthlyAmount > 0),
      ...(item.volunteerBenefit ? { volunteerBenefit: true } : {}),
      ...(item.clubYear ? { clubYear: item.clubYear, clubYearPart: item.clubYearPart, label: item.label } : {}),
      ...(item.sourceLineId !== item.lineId ? { sourceLineId: item.sourceLineId } : {}),
      ...(item.monthlyBilling ? { monthlyPence: toPence(item.monthlyAmount), debits: item.debits,
        ...(item.debits ? { firstDebitAt: Timestamp.fromDate(item.firstDebit), cutoffAt: Timestamp.fromDate(item.subscriptionEnd) } : {}) } : {}),
      ...(lineMembershipRule(item) && item.category !== 'MERCHANDISE' && item.category !== 'VOUCHERS' ? { membershipRule: lineMembershipRule(item) } : {}),
      ...(item.tripSaving > 0 ? { tripDiscountPence: toPence(item.tripSaving), tripDiscountReasons: item.tripDiscountReasons } : {}),
      ...(item.size ? { size: item.size } : {}),
      ...(item.membershipTier ? { membershipTier: item.membershipTier } : {}),
      ...(item.type === 'voucher' ? { voucherValue: item.basePrice, voucherScope: voucherScope(item) } : {}),
      ...(item.category === 'EVENTS' ? {
        eventSchedule: validateEventSchedule(item.eventSchedule),
        ...(storedPeople.some((person) => person.lineIds.includes(item.lineId) && person.ownKitLineIds.includes(item.lineId)) ? { ownKit: true } : {}),
        ...(typeof item.imageUrl === 'string' && item.imageUrl ? { imageUrl: item.imageUrl } : {})
      } : {})
    }));
    const totalPence = toPence(pricing.total);
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
    // Stripe will not take a £0 payment, so a fully discounted basket with no monthly payments is completed here instead.
    const free = !credit && !subscriptionPlan && totalPence === 0;
    const freeSessionId = free ? `cs_free_${crypto.randomBytes(16).toString('hex')}` : '';
    const creditId = credit ? `credit_${crypto.randomBytes(16).toString('hex')}` : '';
    await createFirestoreOrder({ orderRef, email, items, totalPence, discountPence: toPence(pricing.promoDiscountValue), status: 'pending',
      discountCode: discountDocument?.id || '', stripeSessionId: freeSessionId || creditId,
      people: storedPeople, siteUrl, billingMode: hasRecurringItem ? 'monthly' : 'annual', receiptTokenHash: hashAccessToken(receiptToken), stockProductIds: reservedStockIds, policyVersions,
      noticeAgreement: notices.versions.length ? { versions: notices.versions, agreedAt: Timestamp.now(), ...(credit ? { recordedBy: credit.creditedBy } : {}) } : null, subscriptionPlan,
      photoConsentAsked: people.length > 0, payment: credit,
      retryOf: retried && retried.order.status === 'payment_failed' ? retried.reference.id : '', restartOf });
    orderCreated = true;
    if (credit) {
      const fields = await fulfilOrder({ orderRef, sessionId: creditId, amountTotal: totalPence, receiptToken });
      await adminDb.collection('auditLog').add(auditEntry({ kind: 'item', action: 'credit-items', reason: credit.note || creditPaymentWording(credit),
        actor: { uid: credit.creditedByUid, email: credit.creditedBy }, at: Timestamp.now(), orderRef, email,
        membershipIds: [...new Set(storedPeople.map((person) => person.membershipId))], method: credit.method, amountPence: credit.amountPence,
        lineIds: items.map((item) => item.lineId) }));
      let receiptEmailed = true;
      try { if (fields) await deliverOrder(orderRef, fields); }
      catch (error) {
        receiptEmailed = false;
        console.error('Credited order completed but the receipt email failed:', error.message);
        await attention.raise('receipt-email', orderRef, { orderRef, email, detail: `The receipt for credited order ${orderRef} could not be emailed: ${error.message}` });
      }
      return res.json({ success: true, credited: true, orderRef, receiptEmailed });
    }
    if (free) {
      const fields = await fulfilOrder({ orderRef, sessionId: freeSessionId, amountTotal: 0, receiptToken });
      await updateFirestoreOrder(orderRef, { paymentMethod: 'free' });
      await linkResumedPayment(orderRef).catch((error) => console.error('Could not close what order %s replaces: %s', orderRef, error.message));
      try { if (fields) await deliverOrder(orderRef, fields); }
      catch (error) {
        console.error('Free order completed but the receipt email failed:', error.message);
        await attention.raise('receipt-email', orderRef, { orderRef, email, detail: `The receipt for free order ${orderRef} could not be emailed: ${error.message}` });
      }
      const params = new URLSearchParams({ session_id: freeSessionId, receipt_token: receiptToken });
      return res.json({ success: true, free: true, orderRef, sessionId: freeSessionId, checkoutUrl: `${siteUrl}/payment-success?${params}` });
    }
    const dateLabel = (timestamp) => timestamp.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
    const money = (value) => `£${Number(value).toFixed(2)}`;
    const debitText = groups.map((group) => {
      const monthly = debited.filter((item) => item.clubYear === group.clubYear).reduce((sum, item) => sum + toPounds(item.monthlyPence), 0);
      return `${money(monthly)} a month by direct debit on the 1st from ${dateLabel(group.firstDebitAt)} through February (club year ${clubYearLabel(group.clubYear)})`;
    }).join('; ');
    // Nothing due now but monthly payments to come: Checkout only saves the payment details.
    const setupOnly = totalPence === 0;
    const charged = items.filter((item) => item.pricePence > 0);
    const lineItems = setupOnly ? [] : charged.flatMap((item, index) => [
      [`line_items[${index}][price_data][currency]`, 'gbp'],
      [`line_items[${index}][price_data][product_data][name]`, item.clubYear ? `${itemLabel(item)} – ${item.label}` : itemLabel(item)],
      [`line_items[${index}][price_data][product_data][metadata][line_id]`, item.lineId],
      [`line_items[${index}][price_data][unit_amount]`, String(item.pricePence)],
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
      ['success_url', `${siteUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&receipt_token=${receiptToken}`],
      ['cancel_url', `${siteUrl}/membership`],
      ['metadata[order_ref]', orderRef],
      ['metadata[total]', String(toPounds(totalPence))],
      ['metadata[billing_mode]', hasRecurringItem ? 'monthly' : 'annual']
    ], 'POST', { idempotencyKey: `${orderRef}-checkout` });
    createdSessionId = session.id;
    await updateFirestoreOrder(orderRef, { 'stripe.sessionId': session.id, 'stripe.mode': session.livemode ? 'live' : 'test' });

    res.json({ success: true, orderRef, sessionId: session.id, checkoutUrl: session.url });
  } catch (error) {
    if (reservedDocument) {
      try {
        await adminDb.runTransaction(async (transaction) => {
          const document = await transaction.get(reservedDocument);
          if (document.data()?.reservedByOrder === orderRef && document.data()?.status !== 'used') {
            transaction.update(reservedDocument, { reservedByOrder: null, reservedUntil: null });
          }
        });
      } catch (releaseError) {
        console.error('Could not release voucher reservation:', releaseError.message);
      }
    }
    console.error('Error creating Stripe Checkout session:', error.message);
    // The customer is told checkout failed, so a session Stripe already made must not stay payable.
    if (createdSessionId) {
      await stripeRequest(`checkout/sessions/${encodeURIComponent(createdSessionId)}/expire`, [], 'POST')
        .catch((expireError) => console.error('Could not expire the abandoned Checkout Session %s: %s', createdSessionId, expireError.message));
    }
    let paid = false;
    if (orderCreated) {
      const orderDocument = adminDb.collection('orders').doc(orderRef);
      await adminDb.runTransaction(async (transaction) => {
        paid = (await transaction.get(orderDocument)).data()?.status === 'paid';
        if (!paid) transaction.update(orderDocument, { status: 'failed',
          paymentFailure: paymentFailureRecord(null, { at: Timestamp.now(), message: String(error.message).slice(0, 300) }) });
      }).catch((updateError) => console.error('Could not mark the failed checkout %s: %s', orderRef, updateError.message));
    }
    // A free order that was completed keeps what it took.
    if (paid) return res.status(500).json({ error: credit
      ? `The items were credited as order ${orderRef}, but something went wrong afterwards. Check the order before trying again.`
      : 'Your order is complete, but something went wrong afterwards. Check your email for the receipt.' });
    try { await releaseStock(orderRef, reservedStockIds); }
    catch (releaseError) { console.error('Could not release stock hold:', releaseError.message); }
    if (error.soldOut) return res.status(409).json({ code: 'sold_out', productId: error.productId, error: error.message });
    res.status(500).json({ error: credit ? 'Could not credit the items.' : 'Could not start secure checkout.' });
  }
};

app.post('/api/checkout-session', rateLimit(10, 60 * 1000), (req, res) => startCheckout(req, res));

// Staff credit items paid for outside the website (or given free) through the same checks and fulfilment as checkout.
app.post('/api/admin/credits', rateLimit(10, 60 * 1000), async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const payment = validateCreditPayment(req.body?.payment, requestNow(req));
  if (payment.error) return res.status(400).json({ error: payment.error });
  return startCheckout(req, res, { ...payment.value, receivedAt: Timestamp.fromDate(payment.value.receivedAt),
    creditedBy: admin.email || admin.uid, creditedByUid: admin.uid, creditedAt: Timestamp.now() });
});

/** Sends email through Workspace; the emulator stack writes it to `testMail` instead. */
const sendEmail = async ({ to, subject, body, html, replyTo: requestedReplyTo, record = {} }) => {
  const coordinatorEmail = isVolunteerEmail(record) && adminDb
    ? (await adminDb.collection('settings').doc('volunteerCoordinator').get()).data()?.email || ''
    : '';
  const replyTo = requestedReplyTo || emailReplyTo(record, coordinatorEmail);
  if (localFirebase) {
    await adminDb.collection('testMail').add({ email: to, subject, body, ...(html ? { html } : {}), ...record, replyTo, createdAt: Timestamp.now() });
    return true;
  }
  const sender = process.env.GOOGLE_WORKSPACE_SENDER || process.env.GOOGLE_WORKSPACE_DELEGATED_USER;
  if (!gmailApi || !sender) {
    console.error('Email not sent: set GOOGLE_WORKSPACE_DELEGATED_USER (and a service account with domain-wide delegation).');
    return false;
  }
  const raw = buildRawEmail({ fromName: 'Forth Canoe Club', from: sender, to, subject, body, html, replyTo });
  await gmailApi.users.messages.send({ userId: 'me', requestBody: { raw } });
  return true;
};

const sendOrderEmail = async ({ email, orderRef, receiptToken, items, people = [], totalPence, vouchers = [], siteUrl = '', billingMode = 'annual', payment = null }) => {
  const orderSiteUrl = siteUrl || process.env.PUBLIC_SITE_URL || 'http://localhost:3000';
  // Admin-chosen person details go in the email only, never the shareable receipt link.
  const personFields = await loadReceiptPersonFields();
  const receiptPeople = personFields.length ? await receiptPeopleWithRecords(people, email) : people;
  const receipt = buildReceiptSummary(orderRef, { email, items, people: receiptPeople, totalPence, vouchers, billingMode, payment }, { personFields });
  const retrievalUrl = `${orderSiteUrl}/order/${orderRef}.${receiptToken}`;
  const body = [receiptEmailCopy(receipt), '', `Retrieve your receipt and subscription information: ${retrievalUrl}`, '',
    `For help, contact ${TREASURER_REPLY_TO}.`].join('\n');
  return sendEmail({ to: email, subject: `Your Forth Canoe Club receipt - ${orderRef}`, body, html: receiptEmailHtml(receipt, retrievalUrl),
    record: { kind: 'order-receipt', orderRef, items, people, totalPence, receipt, retrievalUrl, vouchers } });
};

app.get('/api/orders/:accessKey', rateLimit(30, 60 * 1000), async (req, res) => {
  try {
    const separator = req.params.accessKey.indexOf('.');
    const orderRef = separator === -1 ? '' : req.params.accessKey.slice(0, separator);
    const receiptToken = separator === -1 ? '' : req.params.accessKey.slice(separator + 1);
    if (!adminDb || !orderRef || !receiptToken) return res.status(404).json({ error: 'Order not found.' });

    const document = await adminDb.collection('orders').doc(orderRef).get();
    if (!document.exists) return res.status(404).json({ error: 'Order not found.' });
    const fields = document.data();
    if (!tokenMatches(receiptToken, fields.receiptTokenHash)) return res.status(404).json({ error: 'Order not found.' });
    if (fields.expiresAt?.toDate() < new Date()) return res.status(410).json({ error: 'This receipt link has expired.' });

    res.json({
      ...buildLinkedReceipt(orderRef, await resolveOrderPeople(adminDb, fields)),
      createdAt: fields.createdAt?.toDate?.() || null,
      expiresAt: fields.expiresAt?.toDate?.() || null
    });
  } catch (error) {
    if (error.code === 404) return res.status(404).json({ error: 'Order not found.' });
    console.error('Error retrieving order:', error);
    res.status(500).json({ error: 'Could not retrieve order.' });
  }
});

/** The order an emailed retry/cancel link (`ORDERREF.TOKEN`) is for, or null. */
const linkedOrder = async (key) => {
  const parts = splitLinkKey(key);
  if (!parts || !adminDb) return null;
  const reference = adminDb.collection('orders').doc(parts.id);
  const document = await reference.get();
  return document.exists && tokenMatches(parts.token, document.data().retryTokenHash) ? { reference, order: document.data() } : null;
};
/** Why a failed order can no longer be retried or cancelled, or null. */
const retryRefusal = (orderRef, order) => {
  if (order.retriedAs) return { status: 410, code: 'order_retried', error: `Your payment for this order went through as order ${order.retriedAs}, so there is nothing more to do.` };
  if (order.status === 'cancelled') return { status: 410, code: 'order_cancelled', error: `Order ${orderRef} was cancelled. Add what you need to your basket to buy it again.` };
  if (order.status !== 'payment_failed') return { status: 409, code: 'order_not_failed', error: `Order ${orderRef} has no failed payment to retry.` };
  if (order.retryExpiresAt && order.retryExpiresAt.toMillis() < Date.now()) return { status: 410, code: 'link_expired', error: 'This link has expired. Add what you need to your basket to buy it again.' };
  return null;
};
const orderSummary = (orderRef, order) => ({ orderRef, itemNames: [...new Set((order.items || []).map((item) => item.name))], totalPence: order.totalPence || 0 });
/** A failed order's people for its retry basket, with the consent answers checkout may tick again in `prefill`. */
const retryPeople = async (order, people) => {
  if (!people.length) return people;
  const stored = new Map((order.people || []).map((person) => [person.id, person]));
  const memberIds = [...new Set(people.map((person) => stored.get(person.id)?.membershipId).filter(Boolean))];
  const [policies, noticeVersions, documents] = await Promise.all([currentCheckoutPolicies(adminDb, isLive()), loadNotices(adminDb).then(noticeVersionMap),
    memberIds.length ? adminDb.getAll(...memberIds.map((id) => adminDb.collection('memberships').doc(id))) : []]);
  const members = new Map(documents.filter((document) => document.exists).map((document) => [document.id, document.data()]));
  return people.map((person) => ({ ...person, disclaimerAccepted: false, photoConsent: false,
    prefill: retryConsentPrefill({ person, order, member: members.get(stored.get(person.id)?.membershipId), policies, noticeVersions }) }));
};

/** The basket a retry link fills: the failed order's items and details, checked out again as a new order. */
app.get('/api/orders/:key/retry', rateLimit(20, 60 * 1000), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const linked = await linkedOrder(req.params.key);
    if (!linked) return res.status(404).json({ error: 'This link is not valid.' });
    const { reference, order } = linked;
    const refusal = retryRefusal(reference.id, order);
    if (refusal) return res.status(refusal.status).json({ code: refusal.code, error: refusal.error, ...orderSummary(reference.id, order) });
    const basket = retryBasket(order, clubYearOf(requestNow(req)));
    if (!basket.items.length) return res.status(410).json({ code: 'link_expired', error: 'What this order was for is no longer on sale.', ...orderSummary(reference.id, order) });
    res.json({ ...orderSummary(reference.id, order), email: order.email, billingMode: order.billingMode === 'monthly' ? 'monthly' : 'annual',
      discountCode: order.discountCode || '', ...basket, people: await retryPeople(order, basket.people) });
  } catch (error) {
    console.error('Could not load a retry link:', error.message);
    res.status(500).json({ error: 'Could not load this order.' });
  }
});

/** Closes a failed order. Its stock and any discount code were released when the payment failed; this makes sure. */
app.post('/api/orders/:key/cancel', rateLimit(10, 60 * 1000), async (req, res) => {
  try {
    const linked = await linkedOrder(req.params.key);
    if (!linked) return res.status(404).json({ error: 'This link is not valid.' });
    const orderRef = linked.reference.id;
    const result = await adminDb.runTransaction(async (transaction) => {
      const order = (await transaction.get(linked.reference)).data();
      if (order.status === 'cancelled') return { order, already: true };
      const refusal = retryRefusal(orderRef, { ...order, retryExpiresAt: null });
      if (refusal) return { order, refusal };
      const discountDocument = order.discountCode ? adminDb.collection('discountCodes').doc(order.discountCode) : null;
      const discount = discountDocument ? (await transaction.get(discountDocument)).data() : null;
      const stock = await readStock(transaction, order.stockProductIds || []);
      stock.forEach((snapshot) => dropHold(transaction, snapshot, orderRef));
      if (discount?.reservedByOrder === orderRef && discount.status !== 'used') transaction.update(discountDocument, { reservedByOrder: null, reservedUntil: null });
      transaction.update(linked.reference, { status: 'cancelled', cancelledAt: Timestamp.now(), cancelledBy: 'customer' });
      return { order };
    });
    if (result.refusal) return res.status(result.refusal.status).json({ code: result.refusal.code, error: result.refusal.error });
    await attention.settle('payment-failed', orderRef, result.order.email, 'The customer cancelled the order.');
    res.json({ cancelled: true, ...orderSummary(orderRef, result.order) });
  } catch (error) {
    console.error('Could not cancel an order:', error.message);
    res.status(500).json({ error: 'Could not cancel this order. Please try again.' });
  }
});

/** The subscription an emailed restart/cancel link (`SUBSCRIPTIONID.TOKEN`) is for, brought up to date with Stripe, or a refusal. */
const linkedSubscription = async (key) => {
  const parts = splitLinkKey(key);
  if (!parts || !adminDb) return { refusal: { status: 404, error: 'This link is not valid.' } };
  const reference = adminDb.collection('subscriptions').doc(parts.id);
  let document = await reference.get();
  if (!document.exists || !tokenMatches(parts.token, document.data().restartTokenHash)) return { refusal: { status: 404, error: 'This link is not valid.' } };
  // The link is sent with the final failed debit; Stripe cancels the subscription straight after, which may not be recorded yet.
  if (document.data().status === 'active') {
    const live = await stripeRequest(`subscriptions/${encodeURIComponent(parts.id)}`, null, 'GET');
    if (!['canceled', 'incomplete_expired'].includes(live.status)) {
      return { refusal: { status: 409, code: 'payments_running', error: 'These monthly payments are still running, so there is nothing to restart. If a debit failed, Stripe will try it again.' } };
    }
    await recordSubscriptionEnded(live);
    document = await reference.get();
  }
  const record = document.data();
  const summary = { subscriptionId: parts.id, names: record.names || [], itemNames: subscriptionItemNames(record),
    paidUntil: record.paidUntil?.toDate?.().toISOString() || null, decision: record.memberDecision || (record.restartedAs ? 'restarted' : '') };
  return { reference, record, summary };
};

/** The basket a restart link fills: the stopped items again, monthly, for the same people. */
app.get('/api/subscriptions/:key/restart', rateLimit(20, 60 * 1000), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { refusal, record, summary } = await linkedSubscription(req.params.key);
    if (refusal) return res.status(refusal.status).json(refusal);
    if (record.restartedAs) return res.status(410).json({ code: 'payments_restarted', error: `Your monthly payments were restarted with order ${record.restartedAs}.`, ...summary });
    if (record.memberDecision === 'cancelled') return res.status(410).json({ code: 'payments_cancelled', error: 'You confirmed these monthly payments are stopping. Add what you need to your basket to buy it again.', ...summary });
    const memberIds = [...new Set(record.membershipIds || [])];
    const members = memberIds.length ? (await adminDb.getAll(...memberIds.map((id) => adminDb.collection('memberships').doc(id))))
      .filter((document) => document.exists).map((document) => ({ ...document.data(), id: document.id })) : [];
    let index = 0;
    const now = requestNow(req);
    const stopped = { ...record, items: (record.items || []).filter((item) => item.cancelledBy === 'stripe') };
    const [policies, noticeVersions] = await Promise.all([currentCheckoutPolicies(adminDb, isLive()), loadNotices(adminDb).then(noticeVersionMap)]);
    const basket = restartBasket(stopped, members, clubYearOf(now), () => `restart-${++index}`, now,
      (member) => ({ prefill: consentPrefill(member, policies, noticeVersions) }));
    if (!basket?.items.length) return res.status(410).json({ code: 'link_expired', error: 'The club year these payments were for has ended. Add what you need to your basket instead.', ...summary });
    res.json({ ...summary, email: record.email, billingMode: 'monthly', items: basket.items, people: basket.people });
  } catch (error) {
    console.error('Could not load a restart link:', error.message);
    res.status(500).json({ error: 'Could not load these monthly payments.' });
  }
});

/** The member confirms stopped monthly payments are not to be restarted, which closes them for staff. */
app.post('/api/subscriptions/:key/cancel', rateLimit(10, 60 * 1000), async (req, res) => {
  try {
    const { refusal, reference, record, summary } = await linkedSubscription(req.params.key);
    if (refusal) return res.status(refusal.status).json(refusal);
    if (record.restartedAs) return res.status(409).json({ code: 'payments_restarted', error: `Your monthly payments were restarted with order ${record.restartedAs}. Contact ${TREASURER_REPLY_TO} to cancel them.` });
    if (record.memberDecision !== 'cancelled') {
      await reference.update({ memberDecision: 'cancelled', memberDecisionAt: Timestamp.now(), updatedAt: Timestamp.now() });
      const note = 'The member confirmed the monthly payments are stopping.';
      if (record.finalFailedInvoiceId) await attention.settle('invoice-failed', record.finalFailedInvoiceId, record.email, note);
      await attention.settle('subscription-ended', reference.id, record.email, note);
    }
    res.json({ cancelled: true, ...summary, decision: 'cancelled' });
  } catch (error) {
    console.error('Could not record a cancellation:', error.message);
    res.status(500).json({ error: 'Could not record this. Please try again.' });
  }
});

/** A paid retry or restart closes the failed order or stopped subscription it replaces. */
const linkResumedPayment = async (orderRef) => {
  const order = (await adminDb.collection('orders').doc(orderRef).get()).data();
  if (!order || order.status !== 'paid') return;
  const note = `Paid again as order ${orderRef}.`;
  if (order.retryOf) {
    await adminDb.collection('orders').doc(order.retryOf).update({ retriedAs: orderRef, retriedAt: Timestamp.now() });
    await attention.settle('payment-failed', order.retryOf, order.email, note);
  }
  if (order.restartOf) {
    const reference = adminDb.collection('subscriptions').doc(order.restartOf);
    const record = (await reference.get()).data();
    if (!record) return;
    await reference.update({ restartedAs: orderRef, restartedAt: Timestamp.now() });
    if (record.finalFailedInvoiceId) await attention.settle('invoice-failed', record.finalFailedInvoiceId, order.email, `Restarted as order ${orderRef}.`);
    await attention.settle('subscription-ended', order.restartOf, order.email, `Restarted as order ${orderRef}.`);
  }
};

const SAFEGUARDING_PDF_MAX_BYTES = 20 * 1024 * 1024;

app.get('/api/safeguarding-documents/:id', rateLimit(30, 60 * 1000), async (req, res) => {
  const policy = findSafeguardingPolicy(req.params.id);
  if (!policy) return res.status(404).json({ error: 'Document not found.' });
  try {
    const upstream = await fetch(policy.sourceUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) throw new Error(`Upstream responded ${upstream.status}.`);
    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > SAFEGUARDING_PDF_MAX_BYTES) throw new Error('Document is too large.');
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length > SAFEGUARDING_PDF_MAX_BYTES || !isPdf(bytes)) throw new Error('Upstream did not return a PDF.');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(policy.filename, req.query.download === '1'),
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(Buffer.from(bytes));
  } catch (error) {
    console.error(`Safeguarding document ${policy.id} unavailable:`, error.message);
    res.status(502).json({ error: 'This document is temporarily unavailable. Please email safeguarding@forthcanoeclub.co.uk for a copy.' });
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

// The website is served by Firebase Hosting (or Vite locally); this server only answers API routes.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Error handling
app.use((err, req, res, next) => {
  if (err.type === 'encoding.unsupported') return res.status(415).json({ error: 'Compressed request bodies are not supported. Send uncompressed JSON.' });
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
    // The privacy notice and retention policy are written on the Notices page, under these notice IDs.
    for (const notice of await loadNotices(adminDb)) {
      if (!notice.archived && notice.currentVersion > 0) currentVersions[notice.id] = Math.max(currentVersions[notice.id] || 0, notice.currentVersion);
    }
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
  console.log(`FCC API running at http://127.0.0.1:${PORT}`);
});
