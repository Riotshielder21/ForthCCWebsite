import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { emailBlockId, normalEmailBlocked } from '../src/server/emailSuppression.js';
import { annualReplacementCredit } from '../src/server/annualReplacementCredit.js';
import { replacementInvites, replacementSource, replacementTokenHash } from '../src/server/subscriptionReplacement.js';
import { buildRawEmail } from '../src/utils/mail.js';
import { subscriptionReplacementEmail } from '../src/utils/subscriptionReplacementEmail.js';

const fail = message => { throw new Error(message); };
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const day = 86400_000;
const get = name => process.env[name] || fail(`Set ${name}.`);

const testInbox = () => {
  const email = normalize(get('STRIPE_REPLACEMENT_TEST_INBOX'));
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) fail('Set one valid test inbox.');
  return email;
};

async function workspaceMailer() {
  const delegatedUser = get('GOOGLE_WORKSPACE_DELEGATED_USER');
  const from = process.env.GOOGLE_WORKSPACE_SENDER || delegatedUser;
  if (![delegatedUser, from].every(value => /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value))) {
    fail('Set valid Google Workspace delegated-user and sender addresses.');
  }
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || await readFile(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || fileURLToPath(new URL('../google-service-account.json', import.meta.url)), 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials, clientOptions: { subject: delegatedUser }, scopes: ['https://www.googleapis.com/auth/gmail.send']
  });
  const gmail = google.gmail({ version: 'v1', auth });
  return {
    from,
    send: async ({ email, subject, body, html }) => {
      const raw = buildRawEmail({ fromName: 'Forth Canoe Club', from, to: email, subject, body, html });
      let result;
      try {
        result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } }, { retry: false, timeout: 15_000 });
      } catch {
        fail('Gmail did not acknowledge the email. Check the delegated mailbox Sent folder before retrying; delivery may have occurred.');
      }
      if (!result.data?.id) fail('Gmail returned no message ID. Check the delegated mailbox Sent folder before retrying.');
    }
  };
}

async function sendDryRunPreview() {
  const email = testInbox();
  const mailer = await workspaceMailer();
  await mailer.send({
    email,
    ...subscriptionReplacementEmail({})
  });
}

async function sendLocalPreview() {
  const email = testInbox();
  const key = get('STRIPE_REPLACEMENT_PREVIEW_SOURCE_KEY');
  if (!/^rk_live_[A-Za-z0-9]+$/.test(key)) fail('Use a restricted read-only live key in STRIPE_REPLACEMENT_PREVIEW_SOURCE_KEY.');
  const site = new URL(process.env.STRIPE_REPLACEMENT_TEST_URL || 'http://localhost:3000');
  const emulator = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const projectId = process.env.STRIPE_REPLACEMENT_TEST_PROJECT || 'demo-fcc';
  if (!['localhost', '127.0.0.1'].includes(site.hostname) || site.protocol !== 'http:' || site.username || site.password ||
    !/^(?:localhost|127\.0\.0\.1):[0-9]+$/.test(emulator) || !projectId.startsWith('demo-')) {
    fail('Local previews require an HTTP loopback website, a loopback Firestore emulator and a demo- project.');
  }
  const ready = await fetch(site.origin, { signal: AbortSignal.timeout(5_000) })
    .catch(() => fail('Start the local website and Firestore emulator before generating the link.'));
  if (!ready.ok) fail('The local website is not ready.');
  const destinationKey = get('STRIPE_SECRET_KEY');
  if (!/^sk_test_[A-Za-z0-9]+$/.test(destinationKey)) fail('STRIPE_SECRET_KEY must be the sandbox key used by your local API.');
  const readStripe = async (path, secret) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'GET', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${secret}`, 'Stripe-Version': '2025-02-24.acacia' }
    });
    if (!response.ok) fail(`Stripe preview read failed (${response.status}); check the key permissions.`);
    return response.json();
  };
  const destination = await readStripe('account', destinationKey);
  if (!/^acct_[A-Za-z0-9]+$/.test(destination.id || '')) fail('Could not verify the Destination sandbox account.');
  const sourceAccount = await readStripe('account', key);
  if (sourceAccount.id === destination.id) fail('Use a separate Source account and Destination sandbox.');
  const page = await readStripe('subscriptions?status=active&limit=1', key);
  const original = page.data?.[0];
  if (!original || original.livemode !== true || !Array.isArray(original.items?.data) || !original.items.data.length) {
    fail('No active live subscription was found for the preview.');
  }
  if (original.items.has_more) fail('The first subscription has too many items for this preview.');
  const names = [];
  for (const item of original.items.data) {
    const productId = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
    if (!/^prod_[A-Za-z0-9]+$/.test(productId || '')) fail('Could not read the Source subscription product.');
    const product = await readStripe(`products/${productId}`, key);
    if (typeof product.name !== 'string' || !product.name.trim()) fail('The Source product has no name.');
    names.push(product.name);
  }
  const mailer = await workspaceMailer();
  process.env.FIRESTORE_EMULATOR_HOST = emulator;
  const db = getFirestore(initializeApp({ projectId }));
  const id = randomBytes(32).toString('hex');
  const token = `${id}.${randomBytes(32).toString('hex')}`;
  const ref = db.collection(replacementInvites).doc(id);
  // Only the email's product labels come from live Stripe; no live billing identifier reaches the local API.
  await ref.create({
    previewOnly: true, sourceId: 'sub_preview', productIds: [], destinationAccount: destination.id,
    emailHash: emailBlockId(email), tokenHash: replacementTokenHash(token),
    expiresAt: Timestamp.fromMillis(Date.now() + day)
  });
  const link = new URL('/membership', site);
  link.hash = new URLSearchParams({ replace: token }).toString();
  await mailer.send({ email, ...subscriptionReplacementEmail({ names, link: link.href }) });
  console.log(JSON.stringify({ dryRun: true, previewSent: true, checked: 1, localLink: true, liveCancellationEnabled: false }));
}

async function* subscriptions(status) {
  let cursor;
  do {
    const query = new URLSearchParams({ status, limit: '100', 'expand[]': 'data.customer' });
    if (cursor) query.set('starting_after', cursor);
    const page = await replacementSource(`subscriptions?${query}`);
    if (!Array.isArray(page.data)) fail('Invalid Stripe subscription list.');
    yield* page.data;
    const next = page.has_more ? page.data.at(-1)?.id : null;
    if (page.has_more && (!next || next === cursor)) fail('Stripe pagination did not advance.');
    cursor = next;
  } while (cursor);
}

async function main() {
  const [mode, mappingFile, ...extra] = process.argv.slice(2);
  if (mode === '--dry-run' && mappingFile === '--local-link' && !extra.length) {
    await sendLocalPreview();
    return;
  }
  if (!['--dry-run', '--send-test'].includes(mode) || (mode === '--send-test' && !mappingFile) || extra.length) {
    fail('Use: node scripts/invite-subscription-replacements.mjs --dry-run [--local-link | mapping.json] | --send-test mapping.json');
  }
  if (!mappingFile) {
    await sendDryRunPreview();
    console.log(JSON.stringify({ dryRun: true, previewSent: true, checked: 0 }));
    return;
  }
  const sourceAccount = get('STRIPE_SOURCE_ACCOUNT_ID');
  const destinationAccount = get('STRIPE_DEST_ACCOUNT_ID');
  if (![sourceAccount, destinationAccount].every(id => /^acct_[A-Za-z0-9]+$/.test(id)) || sourceAccount === destinationAccount) {
    fail('Set two distinct Stripe account IDs.');
  }
  if ((await replacementSource('account')).id !== sourceAccount) fail('Source key does not match the approved Stripe account.');
  const mapping = JSON.parse(await readFile(mappingFile, 'utf8'));
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length ||
    Object.entries(mapping).some(([id, target]) => !/^price_[A-Za-z0-9]+$/.test(id) ||
      typeof target?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(target.id) ||
      typeof target.name !== 'string' || !target.name.trim() || /[\r\n]/.test(target.name))) fail('Invalid legacy-price to website-product mapping.');
  const sending = mode === '--send-test';
  const report = { dryRun: !sending, checked: 0, mapped: 0, needsReview: 0, notTestInbox: 0, suppressed: 0, alreadySent: 0, sent: 0 };
  const annual = { verified: 0, cardOnly: 0, needsReview: 0, excludedFromInvites: 0 };
  const asOf = Math.floor(Date.now() / 1000);
  let db, sendSettings;
  if (sending) {
    const projectId = get('STRIPE_REPLACEMENT_TEST_PROJECT');
    db = getFirestore(initializeApp({ projectId, credential: applicationDefault() }));
    const site = new URL(get('STRIPE_REPLACEMENT_TEST_URL'));
    if (site.protocol !== 'https:' || site.username || site.password) fail('Use an HTTPS staging URL.');
    const tokenSecret = Buffer.from(get('STRIPE_REPLACEMENT_TOKEN_SECRET'), 'base64url');
    if (tokenSecret.length < 32) fail('Use a base64url token secret of at least 32 bytes.');
    sendSettings = { site, tokenSecret, testInbox: testInbox(), mailer: await workspaceMailer() };
  }
  for (const status of ['active', 'trialing']) {
    for await (const original of subscriptions(status)) {
      report.checked++;
      const email = normalize(original.customer?.email);
      const prices = original.items?.data?.map(item => item.price?.id).sort() || [];
      if (!/^sub_[A-Za-z0-9]+$/.test(original.id) || original.livemode !== false || original.schedule || original.items?.has_more || !prices.length ||
        prices.some(id => !Object.hasOwn(mapping, id)) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        report.needsReview++;
        continue;
      }
      report.mapped++;
      const monthly = original.items.data.every(item => item.price?.recurring?.interval === 'month' && item.price.recurring.interval_count === 1);
      if (!monthly) {
        annual.excludedFromInvites++;
        const invoiceId = typeof original.latest_invoice === 'string' ? original.latest_invoice : original.latest_invoice?.id;
        if (sending || !/^in_[A-Za-z0-9]+$/.test(invoiceId || '') ||
          !original.items.data.some(item => item.price?.recurring?.interval === 'year')) {
          annual.needsReview++;
          continue;
        }
        const invoice = await replacementSource(`invoices/${invoiceId}?expand%5B%5D=charge`);
        const plan = annualReplacementCredit(original, invoice, asOf);
        if (!plan) annual.needsReview++;
        else {
          annual.verified++;
          if (plan.cardOnly) annual.cardOnly++;
        }
        continue;
      }
      if (!sending) continue;
      if (email !== sendSettings.testInbox) { report.notTestInbox++; continue; }
      const targets = [...new Map(prices.map(id => [mapping[id].id, mapping[id]])).values()];
      if (await normalEmailBlocked(db, email, { subscriptionId: original.id })) { report.suppressed++; continue; }
      const id = replacementTokenHash(`${sourceAccount}:${original.id}`);
      const token = `${id}.${createHmac('sha256', sendSettings.tokenSecret).update(`${id}:${destinationAccount}`).digest('hex')}`;
      const ref = db.collection(replacementInvites).doc(id);
      const productIds = targets.map(target => target.id).sort();
      const invite = { sourceId: original.id, sourceAccount, destinationAccount, sourcePriceIds: prices,
        productIds, emailHash: emailBlockId(email), tokenHash: replacementTokenHash(token) };
      const send = await db.runTransaction(async tx => {
        const prior = (await tx.get(ref)).data();
        if (prior?.sent || prior?.orderRef || prior?.stopped) return false;
        if (prior) fail('An earlier invitation send is unresolved. Reconcile Gmail Sent and the invitation record before retrying.');
        tx.create(ref, { ...invite, dispatchAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 21 * day),
          mailSite: sendSettings.site.origin, mailFrom: sendSettings.mailer.from, mailNames: targets.map(target => target.name) });
        return true;
      });
      if (!send) { report.alreadySent++; continue; }
      if (await normalEmailBlocked(db, email, { subscriptionId: original.id })) { report.suppressed++; continue; }
      const link = new URL('/membership', sendSettings.site);
      link.hash = new URLSearchParams({ replace: token }).toString();
      await sendSettings.mailer.send({ email, ...subscriptionReplacementEmail({ names: targets.map(target => target.name), link: link.href }) });
      await ref.update({ sent: true });
      report.sent++;
    }
  }
  if (!sending) await sendDryRunPreview();
  console.log(JSON.stringify({ ...report, annual, ...(!sending ? { previewSent: true } : {}) }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
