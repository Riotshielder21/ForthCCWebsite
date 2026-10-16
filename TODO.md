# TODO

## Shop types and vouchers

- Product Type follows Category and is not free choice:
  - Vouchers: always a voucher.
  - Events: always an event ticket.
  - Subscriptions: always a subscription.
  - Membership: fixed price only (never prorated, never monthly).
  - Services: choose Fixed, Prorated or Subscription.
  - Add a Prorated service price mode; keep Membership fixed and keep Membership and Vouchers excluded from monthly billing.
  - Add an admin-controlled "Allow monthly payments" setting per eligible product.
- Existing products are mapped to the new types automatically and keep their saved prices (`yearly-service` and friends).
  - Configure generated voucher credit eligibility by category or product; retain support for custom fixed discount codes.
- Discount code list:
  - A voucher shop item appears once, under the shop item's name. Individual auto-generated codes are not listed.
  - Code and description get separate columns instead of being stacked.
- Course and shop products need an admin-controlled membership rule: no membership required, membership required, or membership included. Checkout and reports must enforce and show the selected rule.

## Club-year access and renewal

- A held service or subscription blocks buying it again while active.
- Early renewal opens two months before expiry (1 January). Payment is scheduled to start on 1 March.
- Apply consistent club-year expiry to memberships, services and subscriptions using the product's fixed, proration or subscription pricing mode.
- A monthly Stripe subscriber stays blocked while their Stripe subscription is active.

## Email and receipts

- Fix receipt email delivery and verify the full email-sending flow, including voucher codes and receipt links.

## Retention and long-term statistics (needs its own design)

- No per-record "keep until" date for now. Retention has to be decided together with long-term statistics: which anonymised aggregates are kept after personal data is erased or expires, and for how long.
- Retention periods for personal data are written into the retention policy (see the policy records work) once agreed.

## Data model migration (approved, remaining work)

1. **`membershipTerms`.** One document per person per club year (tier, start, end, order, source). `status` and `validUntil` stay on the member as the current term. Replaces `history[]` and `privileges[]`.
2. **Orders.** Money in whole pence; subtotal, discount and discount code; refunds as a status (stock released) instead of deleting the order; top-level `membershipIds`; one receipt token; grouped fulfilment, Stripe and payment-failure fields; people reduced to references once the purchase is recorded; remove the legacy `receipt`.
3. **Other collections.** Remove `customers` and `lists`; discount codes get one `status`, a `type` and `sourceProductId`; products get `active`, `sortOrder`, `pricingMode`, `allowMonthly`; the Stripe mirror gets `membershipIds` and drops copied names and emails; one audit log with a reason.
4. Extend `scripts/migrate-schema.js` with a step for each remaining change above, tested against old-shape records, and take a Firestore export before running it with `--apply`.

## Security review (outstanding)

1. Remove or secure the legacy `/api/orders` endpoint that can create unpaid "paid" orders.
2. Bound the in-memory rate-limit map.
3. Add analytics consent controls.
4. Protect receipt tokens in URLs (no-store, referrer policy, no logging).
5. Restrict CORS and add browser security headers.
6. Restore and secure public list submissions: the volunteering form posts to `/api/lists`, but the server currently has no matching route. Then add form-submit tests and example data for Equipment Needed, Volunteer Sign-ups, Event Participants, Maintenance Tasks and Other.
