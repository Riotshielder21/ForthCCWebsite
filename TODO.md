# TODO

## Club-year access and renewal

- A held service or subscription blocks buying it again while active.
- Early renewal opens two months before expiry (1 January). Payment is scheduled to start on 1 March.
- Apply consistent club-year expiry to memberships, services and subscriptions using the product's fixed, proration or subscription pricing mode.
- A monthly Stripe subscriber stays blocked while their Stripe subscription is active.
- Adding a product without membership correctly flags it needs membership. BUT when adding it to the cart the error doesnt go away, and then if you remove the membership after adding it, the whole contact details you entered disapear.
- Pre-filled renewal cart: a renewal email to every member with expiring items, with a link carrying enough data to add all their items (membership and monthly items) to the cart. Sent to everyone on 1 February; before then it is optional (on request). Without it, the renewal cart is not pre-filled.

## Payment schedule (agreed in outline, not built)

Everything monthly ends with the club year, and every direct debit is on the 1st of the month. Items marked **Proposal** still need the club's confirmation. This "joining-month charge" is separate from the shop's **Prorated 60%** pricing mode.

- **Bug to fix first:** Stripe subscriptions currently have no end date, so monthly debits would carry on after 1 March, and they are taken on the day of the first checkout rather than the 1st.
- **Checkout** charges everything due now: annual and one-off items in full, plus a joining-month charge for each monthly item on the 20% / 40% / 60% / 80% scale.
- **Proposal, scale:** the share of the month still to run, rounded up to the next 20%, using the real month length. For a 30-day month: 1st–6th 100% (a full month), 7th–12th 80%, 13th–18th 60%, 19th–24th 40%, 25th onwards 20%.
- **"Pay up front" prices** use the same scale for the current month, then full months to 1 March.
- **Subscriptions** are anchored to the 1st (`billing_cycle_anchor`, no proration), so the first direct debit is the next 1st. Items added later get their own joining-month charge and join the existing debit from the next 1st. This replaces the current "charge to the payer's usual date" logic and its 30p and renewal-race cases.
- **Memberships and monthly items lapse on 1 March**, and no payment is taken in the last two weeks of February.
- **Proposal, February cut-off:** the last debit is 1 February. Every subscription is set to stop at the start of 15 February (`cancel_at` with `proration_behavior=none`, set by the webhook just after Checkout because Checkout cannot set it). A failed 1 February debit can be retried only until then; any invoice still unpaid at the cut-off is voided and flagged for staff. Cover still runs to 1 March in our records. Check in Stripe test mode that cancellation stops retries and creates no credit or 1 March invoice.
- **Buying in February (agreed):** checkout asks, for each membership and monthly item, whether it is for **this club year**, **next club year** or **both**.
  - **This year** (1st–14th only): no subscription; the joining-month charge is the only payment.
  - **Next year:** next year's membership and up-front items are charged at checkout; monthly items get a subscription scheduled to start on 1 March, with its first debit on 1 March.
  - **Both:** this year's charge as above, plus next year's as above, in one checkout.
  - From 15 February nothing monthly is sold for this year; only **next year** is offered for monthly items.
  - Stripe check: Checkout can delay a subscription's first debit (`subscription_data[trial_end]`) only if it is at least 2 days away, so purchases on 27–28 February (29th in a leap year) need the subscription created by the webhook from the saved payment details instead.
- **Different card or bank details** keep getting their own subscription (also on the 1st, with the same February cut-off).
- Bacs needs a few working days for a new mandate, so someone joining at the end of a month may have their first debit a few days after the 1st.
- No live subscriptions exist yet, so nothing needs migrating.

## Renewals (agreed in outline, not built)

- Early renewal opens on 1 January (matches the access rule above). A membership bought from then covers the next club year, starting 1 March.
- A renewal is a cart that includes a membership for someone who has an active subscription, or one due to stop on 1 March.
- **While the old subscription is still active** (before the 15 February cut-off): extend it by a year (move `cancel_at` to the next year's cut-off) and set its items to the monthly items in the renewal cart. Items not in the cart stop on 1 March. Debits carry on on the 1st with no gap.
- **After it has stopped** (from 15 February, or earlier if cancelled; Stripe cannot restart a cancelled subscription): a new subscription through Checkout, asking for payment details again.
- Only what is in the renewal cart continues; the cart is not pre-filled (see the renewal email item above).
- **Paying for a renewal (agreed):** a renewal bought from 1 January charges next year's membership and up-front items at checkout. Monthly items continue on the 1st as above.
- **Member records (agreed):** every membership and item records the club year it covers, named by the year it starts (1 March 2027 – 28/29 February 2028 is **2027**). A member with a 2028 renewal booked before 1 March 2028 shows **2027, 2028**, and stays **active** with no gap; admins only rely on the active status. This fits the `membershipTerms` (one per person per club year) step of the data model migration below.

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
