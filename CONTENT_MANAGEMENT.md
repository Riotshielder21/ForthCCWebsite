# Content and services

## Firebase

1. Copy `.env.example` to `.env`.
2. Add Firebase web-app values.
3. Enable Google sign-in, Firestore, and Storage.
4. Deploy the rules:

```bash
firebase deploy --only firestore:rules,storage
```

## Admin editor

1. Add `localhost` and the production domain to Firebase authorized domains.
2. Give approved editors `{ "admin": true }` as a Firebase custom claim.
3. Open `/admin`.
4. Sign in with a `@forthcanoeclub.co.uk` Google account.
5. Select **Copy starter catalog** once.

The editor manages products, prices, descriptions, categories, discounts, and images.

## Workspace email

Give the service account domain-wide delegation for:

```text
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/datastore
```

Place the JSON file at `google-service-account.json` and set:

```env
GOOGLE_WORKSPACE_DELEGATED_USER=website@forthcanoeclub.co.uk
GOOGLE_WORKSPACE_SENDER=website-noreply@forthcanoeclub.co.uk
PUBLIC_SITE_URL=http://localhost:3000
```

Support: `secretary@forthcanoeclub.co.uk`.

## Stripe test mode

1. Add `sk_test_...` as `STRIPE_SECRET_KEY` in `.env`.
2. Run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

3. Add the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET`.
4. Use `4242 4242 4242 4242` at checkout.

The server creates Checkout sessions. Monthly subscription items use Stripe recurring prices; annual and one-off items remain one-time charges. The webhook confirms payment and records the Stripe payment or subscription ID in Firebase.

## Product fallback

`src/constants/products.js` is used only when Firestore has no products. After the first catalog copy, use `/admin` for updates.

## Data ownership

Firebase is the website system of record:

- `products`: shop catalogue, prices, descriptions, images, and display settings
- `orders`: customer email, items, total, order status, Stripe IDs, receipt access hash, and timestamps
- `lists`: volunteer, equipment, and other form submissions
- `discountCodes`: generated voucher and volunteer discount codes
- `artifacts/.../members`: synced member verification data

Stripe stores payment-processing data:

- Checkout sessions and payment intents
- Payment status, amount, currency, refunds, and disputes
- Stripe customer/payment-method data where Stripe creates it

The site stores only the Stripe IDs and payment status needed for reconciliation. It does not store card numbers or CVV data. Stripe does not replace Firebase as the catalogue, customer receipt, membership-information, or form-submission store.

Customer access uses a 90-day emailed link. Firebase stores a hash of the link token, not the token itself; the original token exists only in the email URL.