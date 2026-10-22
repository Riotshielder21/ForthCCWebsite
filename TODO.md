# TODO

## Shop types and vouchers

- Voucher credit eligibility:
  - Configure generated voucher credit eligibility by category or product; retain support for custom fixed discount codes.
- Discount code list:
  - A voucher shop item appears once, under the shop item's name.
  - Code and description get separate columns instead of being stacked.
- Course and shop products need an admin-controlled membership rule: no membership required, membership required, or membership included. Checkout and reports must enforce and show the selected rule.

## Club-year access and renewal

- A held service or subscription blocks buying it again while active.
- Early renewal opens two months before expiry (1 January). Payment is scheduled to start on 1 March.
- Apply consistent club-year expiry to memberships, services and subscriptions using the product's fixed, proration or subscription pricing mode.
- A monthly Stripe subscriber stays blocked while their Stripe subscription is active.
- Adding a product without membership correctly flags it needs membership. BUT when adding it to the cart the error doesnt go away, and then if you remove the membership after adding it, the whole contact details you entered disapear.

## Email and receipts

- Receipt email code is fixed (delegation now applied, UTF-8 encoding, recipient validation, clear log when unconfigured). Still to verify on the live project: domain-wide delegation for the Gmail scope, then send a real test purchase and check the receipt, voucher codes and receipt links.

## Retention and long-term statistics (needs its own design)

- No per-record "keep until" date for now. Retention has to be decided together with long-term statistics: which anonymised aggregates are kept after personal data is erased or expires, and for how long.
- Retention periods for personal data are written into the retention policy (see the policy records work) once agreed.

## Data model migration (approved, remaining work)

1. **`membershipTerms`.** One document per person per club year (tier, start, end, order, source). `status` and `validUntil` stay on the member as the current term. Replaces `history[]` and `privileges[]`.
2. **Orders.** Money in whole pence; subtotal, discount and discount code; refunds as a status (stock released) instead of deleting the order; top-level `membershipIds`; one receipt token; grouped fulfilment, Stripe and payment-failure fields; people reduced to references once the purchase is recorded; remove the legacy `receipt`.
3. **Other collections.** Remove `customers` (`lists` stays: it holds form submissions and volunteer induction state); discount codes get one `status`, a `type` and `sourceProductId`; products get `active`, `sortOrder`, `pricingMode`, `allowMonthly`; the Stripe mirror gets `membershipIds` and drops copied names and emails; one audit log with a reason.
4. Extend `scripts/migrate-schema.js` with a step for each remaining change above, tested against old-shape records, and take a Firestore export before running it with `--apply`.

## Security review (outstanding)

1. Add analytics consent controls.
2. Switch the full Content-Security-Policy from report-only to enforced (Firebase Hosting and the API) once the browser console shows no violations on every page, including admin sign-in, image upload and Stripe checkout.

## Volunteering

- Choose who tells new volunteers about inductions; the form only records the sign-up. Volunteer codes are emailed, so they depend on the email delivery fix above.

## Flow test failures (pre-existing)

`scripts/test-checkout-flow.js` fails these six scenarios on the branch before and after the security work, most likely expectations left over from before households were split out:

- a returning member can add an add-on with only name and date of birth (address is now on the household, not the member);
- multiple copies of shop services in one mixed basket (the per-member item list now includes every item bought);
- family membership emergency contact (`undefined` instead of `false`);
- reports: orders list (a row is missing, reading `status` of `undefined`);
- reports: member register count (23 records where 19 are expected);
- replaying a webhook (`shared.family` is unset because the family scenario failed first).


Feature WishList
