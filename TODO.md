# TODO

## Club years, monthly payments and renewals

- **Stripe test mode:** card-based Test Clocks verify twelve full monthly payments when subscriptions end on 1 March, no extra March invoice, no cancellation credit, stopping automatic failed-payment retries at cancellation, and one delayed December catch-up charge. Still test actual Bacs mandate/settlement delays and webhook-driven voiding and membership updates through real checkout. Turn off Stripe's trial-ending reminder emails (new subscriptions are *trialing* until their first 1st).
- **Renewal job deployment:** create a `renewal-job-token` secret, pass it to Cloud Run as `RENEWAL_JOB_TOKEN` in `.github/workflows/firebase-hosting.yml`, and install `config/fcc-renewals.{service,timer}` on the server with `RENEWAL_JOB_TOKEN` and `RENEWAL_JOB_URL` in its `.env`. Until then staff can send renewal emails from the admin page.
- **Renewal email wording:** the email uses template text for now; agree the final wording with the club (`renewalEmail` in `src/utils/renewals.js`).
- **Stripe erasure verification:** check customer deletion/redaction and shared-item cancellation with a real Stripe test-mode customer, including a failed-delete retry. The website now cancels the erased person's billing and removes identifying subscription fields automatically; Stripe can retain historical invoices, payments and mandates that require a separate dashboard/privacy-support review. A customer still paying for other members retains its payment method until a replacement payer is arranged.
- **Stripe webhook events:** add `invoice.payment_failed` and `invoice.paid` to the live and test webhook endpoints (Needs attention uses them), and turn on Stripe's customer emails for failed payments. Set `STAFF_ALERT_EMAIL` if alerts should go somewhere other than the club reply-to address.
- **Subscription schedules:** cancelling an item on a volunteer-scheduled subscription edits the schedule's phases. Check this against a real Stripe test-mode schedule; the flow-test mock has no schedules.

## Email and receipts

- Add inline/CID event-image attachments, calendar invitations and downloadable/PDF receipts. Hosted HTTPS event images are already supported, but email clients may block them; historical orders without saved images remain text-only.

## Retention and long-term statistics (needs its own design)

- No per-record "keep until" date for now. Retention has to be decided together with long-term statistics: which anonymised aggregates are kept after personal data is erased or expires, and for how long.
- Retention periods for personal data are written into the retention policy (see the policy records work) once agreed.

## Security review (outstanding)

1. Add analytics consent controls.
2. Switch the full Content-Security-Policy from report-only to enforced (Firebase Hosting and the API) once the browser console shows no violations on every page, including admin sign-in, image upload and Stripe checkout.
3. Recheck npm for patched body-parser, qs and ip-address releases (see **Dependency security** in DEVELOPMENT.md). Compressed request bodies are rejected as the body-parser workaround; the remaining qs comma-format and ip-address advisories are not fixed upstream in the available npm releases. Keep the alerts open until patched dependencies are installed and tested.


## Check-ins and My details (follow-ups)

- **Wishlist:** extend Check-ins beyond club night. When events overlap, offer an event selector showing only sessions the signed-in volunteer or leader is authorised to access. Event leaders can retrieve booked attendee details on the event day until midnight Europe/London; club-night volunteers can see that day's check-ins. Keep the attendee list and event selector mobile-first.
- Print the `/check-ins` QR code (`/club-night` still works) for the boathouse and set the weekly sessions in **Reports & records → Volunteers → Check-in sessions**.
- Add Firestore TTL policies on `expiresAt` for `emailCodes` and `emailSessions`; expired ones are already rejected, but the documents stay until removed.
- Decide retention for `clubNightCheckins`, `clubNightAccessLog` and `selfServiceChanges` with the retention work above (GDPR erasure already removes them per person).
- When a member changes their contact email in My details, the Stripe customer email is not updated; update it there if monthly-payment emails should follow.

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