import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import compression from 'compression';
import cors from 'cors';
import { google } from 'googleapis';
import fs from 'fs';
import crypto from 'crypto';

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

const firestoreDocumentName = (orderRef) => `projects/${googleProjectId}/databases/(default)/documents/orders/${orderRef}`;
const createFirestoreOrder = async ({ orderRef, email, items, total, status, stripeSessionId = '' }) => {
  await firestoreApi.projects.databases.documents.createDocument({
    parent: `projects/${googleProjectId}/databases/(default)/documents`,
    collectionId: 'orders',
    documentId: orderRef,
    requestBody: {
      fields: {
        email: firestoreString(email.toLowerCase()),
        items: firestoreString(JSON.stringify(items)),
        total: firestoreString(total),
        status: firestoreString(status),
        stripeSessionId: firestoreString(stripeSessionId),
        createdAt: { timestampValue: new Date().toISOString() },
        expiresAt: { timestampValue: new Date(Date.now() + ORDER_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString() }
      }
    }
  });
};
const updateFirestoreOrder = async (orderRef, fields) => {
  const updateFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'object' && value.timestampValue ? value : firestoreString(value)]));
  await firestoreApi.projects.databases.documents.patch({
    name: firestoreDocumentName(orderRef),
    updateMask: { fieldPaths: Object.keys(updateFields) },
    requestBody: { fields: updateFields }
  });
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
      if (!orderRef || !firestoreApi) return res.status(400).send('Order metadata is missing.');
      const document = await firestoreApi.projects.databases.documents.get({ name: firestoreDocumentName(orderRef) });
      const fields = document.data.fields || {};
      if (fields.status?.stringValue === 'paid' && fields.emailSent?.stringValue === 'true') {
        return res.json({ received: true });
      }
      const accessToken = createAccessToken();
      const items = JSON.parse(fields.items?.stringValue || '[]');
      const total = fields.total?.stringValue || '0';
      await updateFirestoreOrder(orderRef, {
        status: 'paid',
        accessTokenHash: hashAccessToken(accessToken),
        stripePaymentIntentId: session.payment_intent || '',
        stripeSubscriptionId: session.subscription || '',
        paidAt: { timestampValue: new Date().toISOString() }
      });
      const emailSent = await sendOrderEmail({ email: fields.email?.stringValue, orderRef, accessToken, items, total });
      await updateFirestoreOrder(orderRef, { emailSent: String(emailSent), emailSentAt: emailSent ? { timestampValue: new Date().toISOString() } : '' });
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
let firestoreApi;
let gmailApi;
let googleProjectId;
try {
  const credentialsPath = join(__dirname, 'google-service-account.json');
  if (fs.existsSync(credentialsPath)) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    googleProjectId = credentials.project_id;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheets = google.sheets({ version: 'v4', auth });
    const workspaceAuth = new google.auth.GoogleAuth({
      credentials,
      subject: process.env.GOOGLE_WORKSPACE_DELEGATED_USER || undefined,
      scopes: [
        'https://www.googleapis.com/auth/datastore',
        'https://www.googleapis.com/auth/gmail.send'
      ]
    });
    firestoreApi = google.firestore({ version: 'v1', auth: workspaceAuth });
    gmailApi = google.gmail({ version: 'v1', auth: workspaceAuth });
    console.log('âœ… Google Sheets API initialized');
  } else {
    console.warn('âš ï¸  Google service account key not found. Google Sheets integration disabled.');
  }
} catch (error) {
  console.error('âŒ Error initializing Google Sheets API:', error.message);
}

const createAccessToken = () => crypto.randomBytes(32).toString('hex');
const hashAccessToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const firestoreString = (value) => ({ stringValue: String(value ?? '') });
const ORDER_ACCESS_DAYS = 90;

app.post('/api/checkout-session', rateLimit(10, 60 * 1000), async (req, res) => {
  try {
    const { email, items, total, billingMode = 'annual' } = req.body;
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe test mode is not configured.' });
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'A valid email and at least one item are required.' });
    }

    const orderRef = `FCC-${Date.now().toString(36).toUpperCase()}`;
    if (!firestoreApi || !googleProjectId) return res.status(503).json({ error: 'Order storage is not configured.' });
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
      ['customer_email', email.toLowerCase()],
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
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'A valid email and at least one item are required.' });
    }
    if (!firestoreApi || !googleProjectId) {
      return res.status(503).json({ error: 'Order storage is not configured.' });
    }

    const orderRef = `FCC-${Date.now().toString(36).toUpperCase()}`;
    const accessToken = createAccessToken();
    await firestoreApi.projects.databases.documents.createDocument({
      parent: `projects/${googleProjectId}/databases/(default)/documents`,
      collectionId: 'orders',
      documentId: orderRef,
      requestBody: {
        fields: {
          email: firestoreString(email.toLowerCase()),
          accessTokenHash: firestoreString(hashAccessToken(accessToken)),
          receipt: firestoreString(JSON.stringify(receipt || {})),
          items: firestoreString(JSON.stringify(items)),
          total: firestoreString(total),
          createdAt: { timestampValue: new Date().toISOString() },
          expiresAt: { timestampValue: new Date(Date.now() + ORDER_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString() }
        }
      }
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
    if (!firestoreApi || !googleProjectId || !orderRef || !accessToken) return res.status(404).json({ error: 'Order not found.' });

    const document = await firestoreApi.projects.databases.documents.get({
      name: `projects/${googleProjectId}/databases/(default)/documents/orders/${orderRef}`
    });
    const fields = document.data.fields || {};
    if (fields.accessTokenHash?.stringValue !== hashAccessToken(accessToken)) return res.status(404).json({ error: 'Order not found.' });
    if (fields.expiresAt?.timestampValue && new Date(fields.expiresAt.timestampValue) < new Date()) return res.status(410).json({ error: 'This receipt link has expired.' });

    res.json({
      orderRef,
      receipt: JSON.parse(fields.receipt?.stringValue || '{}'),
      items: JSON.parse(fields.items?.stringValue || '[]'),
      total: fields.total?.stringValue || '0',
      createdAt: fields.createdAt?.timestampValue || null,
      expiresAt: fields.expiresAt?.timestampValue || null
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
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`ðŸŽ¯ FCC Website running at http://127.0.0.1:${PORT}`);
  console.log(`ðŸ“ Serving from: ${__dirname}/dist`);
  console.log(`ðŸ›‘ To stop the server, press Ctrl+C`);
});
