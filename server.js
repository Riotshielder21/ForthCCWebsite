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
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore';
import { PAGE_CONTENT } from './src/constants/pageContent.js';

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
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Stripe request failed.');
  return data;
};

const createFirestoreOrder = async ({ orderRef, email, items, total, status, stripeSessionId = '' }) => {
  if (!adminDb) throw new Error('Firebase Admin SDK is not configured.');
  await adminDb.collection('orders').doc(orderRef).create({
    email: email.toLowerCase(),
    items,
    total: String(total),
    status,
    stripeSessionId,
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
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderRef = session.metadata?.order_ref;
      if (!orderRef || !adminDb) return res.status(400).send('Order metadata is missing.');
      const document = await adminDb.collection('orders').doc(orderRef).get();
      if (!document.exists) return res.status(404).send('Order not found.');
      const fields = document.data();
      if (fields.status === 'paid' && fields.emailSent === true) {
        return res.json({ received: true });
      }
      const accessToken = createAccessToken();
      const items = fields.items || [];
      const total = fields.total || '0';
      await updateFirestoreOrder(orderRef, {
        status: 'paid',
        accessTokenHash: hashAccessToken(accessToken),
        stripePaymentIntentId: session.payment_intent || '',
        stripeSubscriptionId: session.subscription || '',
        paidAt: Timestamp.now()
      });
      const emailSent = await sendOrderEmail({ email: fields.email, orderRef, accessToken, items, total });
      await updateFirestoreOrder(orderRef, { emailSent, ...(emailSent ? { emailSentAt: Timestamp.now() } : {}) });
      console.log(`Stripe payment confirmed: ${session.id}; receipt email sent: ${emailSent}`);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    res.status(400).send('Invalid webhook.');
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
try {
  const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(__dirname, 'google-service-account.json');
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (credentialsJson || fs.existsSync(credentialsPath)) {
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

app.post('/api/checkout-session', rateLimit(10, 60 * 1000), async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { items, total, billingMode = 'annual' } = req.body;
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe test mode is not configured.' });
    if (!isValidEmail(email) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Enter a valid email address and include at least one item.' });
    }

    const orderRef = `FCC-${Date.now().toString(36).toUpperCase()}`;
    if (!adminDb) return res.status(503).json({ error: 'Order storage is not configured.' });
    await createFirestoreOrder({ orderRef, email, items, total, status: 'pending' });
    const lineItems = items.flatMap((item, index) => [
      [`line_items[${index}][price_data][currency]`, 'gbp'],
      [`line_items[${index}][price_data][product_data][name]`, item.name],
      [`line_items[${index}][price_data][unit_amount]`, String(Math.round(Number(item.price) * 100))],
      [`line_items[${index}][quantity]`, '1'],
      ...(billingMode === 'monthly' && item.type === 'subscription'
        ? [[`line_items[${index}][price_data][recurring][interval]`, 'month']]
        : [])
    ]);
    const hasRecurringItem = billingMode === 'monthly' && items.some((item) => item.type === 'subscription');
    const session = await stripeRequest('checkout/sessions', [
      ...lineItems,
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
    console.error('Error creating Stripe Checkout session:', error.message);
    res.status(500).json({ error: 'Could not start secure checkout.' });
  }
});

const sendOrderEmail = async ({ email, orderRef, accessToken, items, total }) => {
  const sender = process.env.GOOGLE_WORKSPACE_SENDER || process.env.GOOGLE_WORKSPACE_DELEGATED_USER;
  if (!gmailApi || !sender) return false;

  const retrievalUrl = `${process.env.PUBLIC_SITE_URL || 'http://localhost:3000'}/order/${orderRef}.${accessToken}`;
  const itemLines = items.map((item) => `- ${item.name}: £${Number(item.price).toFixed(2)}`).join('\n');
  const body = [
    'Thank you for your purchase from Forth Canoe Club.',
    '',
    `Order reference: ${orderRef}`,
    `Total: £${Number(total).toFixed(2)}`,
    '',
    itemLines,
    '',
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
    const { db, addDoc, collection, serverTimestamp, verifyMember, generateDiscountCode, saveDiscountCode } = await import('./src/utils/firebase.js');
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
      verificationResult = await verifyMember(name);
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
