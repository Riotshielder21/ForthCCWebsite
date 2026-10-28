# TODO

## Club years, monthly payments and renewals

- **Stripe test mode:** card-based Test Clocks verify twelve full monthly payments when subscriptions end on 1 March, no extra March invoice, no cancellation credit, stopping automatic failed-payment retries at cancellation, and one delayed December catch-up charge. Still test actual Bacs mandate/settlement delays and webhook-driven voiding and membership updates through real checkout. Turn off Stripe's trial-ending reminder emails (new subscriptions are *trialing* until their first 1st).
- **Renewal job deployment:** create a `renewal-job-token` secret, pass it to Cloud Run as `RENEWAL_JOB_TOKEN` in `.github/workflows/firebase-hosting.yml`, and install `config/fcc-renewals.{service,timer}` on the server with `RENEWAL_JOB_TOKEN` and `RENEWAL_JOB_URL` in its `.env`. Until then staff can send renewal emails from the admin page.
- **Renewal email wording:** the email uses template text for now; agree the final wording with the club (`renewalEmail` in `src/utils/renewals.js`).
- GDPR erasure cancels the person's subscriptions but does not blank the payer email and names on `subscriptions/{id}` records.

## Email and receipts

- Add inline/CID event-image attachments, calendar invitations and downloadable/PDF receipts. Hosted HTTPS event images are already supported, but email clients may block them; historical orders without saved images remain text-only.

## Retention and long-term statistics (needs its own design)

- No per-record "keep until" date for now. Retention has to be decided together with long-term statistics: which anonymised aggregates are kept after personal data is erased or expires, and for how long.
- Retention periods for personal data are written into the retention policy (see the policy records work) once agreed.

## Data model migration (approved, remaining work)

1. **`membershipTerms`.** One document per person per club year (tier, start, end, order, source). `status` and `validUntil` stay on the member as the current term. Replaces `history[]` and `privileges[]`.
2. **Orders.** Money in whole pence; subtotal, discount and discount code; top-level `membershipIds`; one receipt token; grouped fulfilment, Stripe and payment-failure fields; people reduced to references once the purchase is recorded; remove the legacy `receipt`. Item refunds and separate revocation now retain the order and release stock only on revocation.
3. **Other collections.** Remove `customers` (`lists` stays: it holds form submissions and volunteer induction state); discount codes get one `status`, a `type` and `sourceProductId`; products get `active` and `sortOrder`, with existing records backfilled for the implemented `pricingMode` and `allowMonthly` fields; the Stripe mirror gets `membershipIds` and drops copied names and emails; one audit log with a reason.
4. Extend `scripts/migrate-schema.js` with a step for each remaining change above, tested against old-shape records, and take a Firestore export before running it with `--apply`.

## Security review (outstanding)

1. Add analytics consent controls.
2. Switch the full Content-Security-Policy from report-only to enforced (Firebase Hosting and the API) once the browser console shows no violations on every page, including admin sign-in, image upload and Stripe checkout.
3. HTTPS certificate

## Check-ins and My details (follow-ups)

- **Wishlist:** extend Check-ins beyond club night. When events overlap, offer an event selector showing only sessions the signed-in volunteer or leader is authorised to access. Event leaders can retrieve booked attendee details on the event day until midnight Europe/London; club-night volunteers can see that day's check-ins. Keep the attendee list and event selector mobile-first.
- Print the `/check-ins` QR code (`/club-night` still works) for the boathouse and set the weekly sessions in **Reports & records → Volunteers → Check-in sessions**.
- Add Firestore TTL policies on `expiresAt` for `emailCodes` and `emailSessions`; expired ones are already rejected, but the documents stay until removed.
- Decide retention for `clubNightCheckins`, `clubNightAccessLog` and `selfServiceChanges` with the retention work above (GDPR erasure already removes them per person).
- When a member changes their contact email in My details, the Stripe customer email is not updated; update it there if monthly-payment emails should follow.

## Flow test failures (pre-existing)

`scripts/test-checkout-flow.js` fails these eight scenarios (still failing identically with and without the receipt email changes), most likely expectations left over from before households were split out:

- adult membership plus boat hire is recorded on the membership, customer and order;
- consent and policy wording is recorded as numbered versions that follow changes;
- a returning member can add an add-on with only name and date of birth (address is now on the household, not the member);
- multiple copies of shop services in one mixed basket (the per-member item list now includes every item bought);
- family membership emergency contact (`undefined` instead of `false`);
- reports: orders list (a row is missing, reading `status` of `undefined`);
- reports: member register count (23 records where 19 are expected);
- replaying a webhook (`shared.family` is unset because the family scenario failed first).

On an emulator that has run the flow test many times, the report-based scenarios (junior household, JustGo sync and uploads, event tickets, merchandise, reports) also fail: the admin reports return the first 100 records ordered by document id, so this run's records can fall onto a later page. Restart the emulators without imported data before relying on them.


## PRe Flight checks
- Committee Content Review
- Committee sanction publishing
- Test member review
- Test admin side
- MOST IMPORTANT, MOVING AWAY FROM BOOKWHEN, EVENTBIRTE, HUMANITIX
- GDPR NOTICE
- DISCLAIMER for all activities
- PHOTO CONSENT POLICY
- Media content
- COPYRIGHT NOTICE

## Final DEPLOY TODO
 - Import existing members (if before March)
 - Import all current subscribers, and probably transition away from bookwhen strip setup 
 - Import all current payments for boathire, and keyhire and the current volunteer list.

## For Website
- Make all domain token / sanitisation and fix name fields where possible, a file and secrets foir a repo to allow forking for commercialisation