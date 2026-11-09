# Website hosting cost plan, 2026–27

Forth Canoe Club SCIO: annual running-cost estimate for the club website (`new.forthcanoeclub.co.uk`).

Prepared 6 November 2026. Prices are Google's published list prices on that date, in US dollars, converted at £1 = $1.28 (£0.78 per $1). Google bills the club's Cloud billing account monthly. The figures are estimates for budgeting, not quotes.

## Summary for the committee

| | Per year | Per day | Per visitor |
| --- | --- | --- | --- |
| **Expected total bill (all services)** | **about £6 ($7.80)** | about 2p | under 0.1p |
| The same, after clearing old server copies (keeping required secrets) | **about £1.12 ($1.44)** | 0.3p | 0.01p |
| Recommended budget (covers 10× growth) | **£60 ($77)**, with an alert at £5/month | | |

- The website is built to stay within Google's free allowances. At expected traffic (about 8,700 visits a year), photos, pages, the database and the server all cost **£0**.
- The estimated charges today are for old server copies (about £4.90 a year) and required secret keys beyond the free allowance (about £1.10 a year). Clearing old server copies brings the expected bill to **about £1.12 a year**. The Stripe test keys are currently used by checkout and must not be deleted to save this charge.
- With the new image handling, each visit uses about **3.3 MB** of photo downloads instead of **60 MB**. The free photo-download allowance of 100 GB a month therefore covers about **30,000 visits a month**, compared with about 1,700 if full-size photos were sent every time.
- **Workspace for Nonprofits does not cover this.** It covers Gmail, Drive and other Workspace tools only. Firebase and Google Cloud are billed separately on the club's pay-as-you-go account. The free allowances below apply to every Google Cloud customer.

## What was checked

These settings were read from the live Google Cloud project `fccwebsite-23cfc` on 6 November 2026.

| Service | Location | Notes |
| --- | --- | --- |
| Firestore database | europe-west2 (London) | As expected |
| Website server (Cloud Run `fcc-website-api`) | europe-west2 (London) | 1 vCPU, 512 MB, scales to zero, up to 20 instances |
| **Photo storage** (`fccwebsite-23cfc.firebasestorage.app`) | **US-WEST1 (Oregon), not London** | This is the only location type that qualifies for the free storage allowance (see below). It currently holds 3.3 MB. |
| Website pages (Firebase Hosting) | Google's global network | Served from a location near each visitor |
| Scheduled jobs (Cloud Scheduler) | europe-west2 | 3 jobs: renewals, JustGo sync and JustGo upload. **Both JustGo jobs are currently paused**; this plan assumes they are switched on. |
| JustGo jobs (Cloud Run jobs) | europe-west2 | 1 vCPU, 512 MB each |
| Secret keys (Secret Manager) | Global | 8 active keys; 6 are free |
| Server copies (Artifact Registry `cloud-run-source-deploy`) | europe-west2 | **5.8 GB** of old server copies, built up by every deployment |
| Deployment uploads (`run-sources-…` bucket) | europe-west2 | 17 MB |

## Traffic assumptions

Taken from Google Search Console for the old site (`forthcanoeclub.co.uk`), last 12 months:

- 2,910 clicks from Google search and 42,300 appearances in search results.
- Devices: 70.5% mobile, 28.2% desktop, 1.2% tablet.
- The old home page showed 12 images, totalling 1.28 MB.

Search Console counts only visits from Google search; people also arrive through links, social media, emails and bookmarks. This plan uses three levels of traffic:

| Scenario | Visits per year | Visits per day |
| --- | --- | --- |
| Low: Google search visits only | 2,910 | 8 |
| **Expected: 3× Google search visits** | **8,730** | **24** |
| High: 10× Google search visits (growth, or a busy event season) | 29,100 | 80 |

The estimates are cautious: **every visit is treated as a first visit with nothing saved in the browser.** In practice, returning visitors reuse photos already saved in their browser for up to a year, so real downloads will be lower.

## How photos are now handled

1. **Upload:** an admin can choose a photo of **up to 25 MB**.
2. **Resizing on the admin's device:**
   - The admin's browser turns the photo the right way up.
   - It saves copies at several widths:
     - Banners: 640 px to 3840 px.
     - Tiles and shop products: 320 px to 1920 px.
     - Supporter logos: 160 px to 640 px.
   - The copies are in WebP, a modern compressed format.
   - The original is not stored, and no copy can exceed 5 MB.
   - This takes about 3 seconds for a large photo. It uses no server time.
3. **Display:**
   - The website measures the space each photo fills on the visitor's screen and multiplies it by the screen's sharpness (pixel density, counted up to 2×). It then downloads the smallest copy that is still sharp.
   - A tiny blurred preview (about 1 KB) appears instantly, and the sharp copy replaces it.
   - If a window is enlarged, a larger copy loads.

   Typical choices for a banner:

   | Screen | Banner copy downloaded |
   | --- | --- |
   | Phone | 1600 px |
   | 1366×768 laptop | 1600 px |
   | 1080p desktop | 1920 px |
   | 1440p desktop | 2560 px |
   | 4K screen | 3840 px |

4. **Caching:** photo copies never change once uploaded. Browsers can therefore keep them for a year without asking the server again.
5. **Offline reading:** the site saves one plain copy of each page's photos so that pages can be read without a connection. This happens once per new visitor.

On a 24-inch monitor, a banner looks sharp only if the photo uploaded was at least 2560 px wide. The editor now warns when a narrower photo is uploaded. The current home banner is only 1152 px wide and should be replaced with a larger original.

## Photo download costs: comparing the two approaches

These are the approaches the committee was asked to compare.

- **A. Always full resolution, with a quick preview first:** every visitor downloads every photo at full size (up to 5 MB each; modelled at 5 MB each), after a blurred preview.
- **B. Selective size, with a quick preview first (implemented):** every visitor downloads only the size their screen needs, as described above. This is the approach that has been built.

| Downloaded per visit | A. Always full size | B. Selective size |
| --- | --- | --- |
| The 12 photos on the page | 60 MB | 1.17 MB |
| Offline copies (once per new visitor) | not counted* | 2.15 MB |
| **Total** | **60 MB** | **3.32 MB** |

\* Under approach A the offline copies would also be full size, adding about 155 MB per new visitor. That cost is left out so that A is not overstated.

How the selective-size figure was worked out:

- **Content assumed for the finished site:** 6 page banners, 15 tile photos, 10 supporter logos and 20 shop photos.
- **Photos seen in a typical visit:** 1 banner, 6 tiles or products, and 5 logos.
- **Copy sizes:** about 0.2 bytes per pixel for WebP. The current home banner measures 0.217.

**Storage** (Cloud Storage, US-WEST1):

- Free allowance: 100 GB of downloads a month, 5 GB stored, and 50,000 file reads a month.
- Beyond the free allowance: $0.12 per GB downloaded.

| Approach | Scenario | GB per year | GB per month | **Cost per year (with free allowance)** | Cost per year if there were no free allowance | Per day (no free allowance) | Per visitor (no free allowance) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Low | 174.6 | 14.6 | **£0** | $20.96 (£16.35) | $0.057 | $0.0072 (0.56p) |
| A | Expected | 523.9 | 43.7 | **£0** | $62.87 (£49.04) | $0.172 | $0.0072 (0.56p) |
| A | High | 1,746 | 145.5 | **$65.56 (£51.14)** | $209.56 (£163.46) | $0.574 | $0.0072 (0.56p) |
| **B** | Low | 9.7 | 0.8 | **£0** | $1.16 (£0.90) | $0.003 | $0.0004 (0.03p) |
| **B** | **Expected** | **29.0** | **2.4** | **£0** | $3.48 (£2.71) | $0.010 | $0.0004 (0.03p) |
| **B** | High | 96.6 | 8.1 | **£0** | $11.60 (£9.04) | $0.032 | $0.0004 (0.03p) |

**Visits covered by the free allowance before any photo charge applies:**

- A: about 1,700 visits a month (54 a day).
- B: about 30,000 visits a month (990 a day).

**Saving from approach B compared with A:**

- £0 at low or expected traffic, because both approaches fit in the free allowance.
- £51 a year at high traffic.
- If Google ever withdrew the free allowance, the saving would be 94% at every level of traffic.

**Other differences:**

- **Speed:** a 5 MB photo on a typical 4G phone connection (about 10 Mbit/s) takes about 4 seconds; the 1600 px banner takes about 0.3 seconds.
- **Visitors' mobile data:** approach B uses about 18 times less.

**File reads:**

- Expected traffic needs about 31,000 a month, which is free.
- High traffic needs about 104,000 a month, which costs about $0.26 (20p) a year.

**Photo storage:**

- About 65 MB for the finished site's photos, even allowing for replaced uploads.
- This is well within the 5 GB free.

## Full annual cost plan: all services, expected traffic, approach B

| Service | What it does | Expected use | Free allowance | **Cost per year** |
| --- | --- | --- | --- | --- |
| Cloud Storage (photos) | Stores and delivers uploaded photos | 29 GB downloaded a year; under 1 GB stored | 100 GB a month downloaded, 5 GB stored | **£0** |
| Firebase Hosting | Delivers the website's pages, code and built-in images | About 0.6 MB per new visitor (measured from the current build), so about 14 MB a day | 360 MB a day transferred, 10 GB stored | **£0** |
| Cloud Run: website server | Shop, checkout, members' area, admin | Under 10,000 requests a month | 2 million requests and 180,000 vCPU-seconds a month | **£0** |
| Cloud Run: JustGo jobs | Hourly upload and daily sync | 750 runs a month: about 45,000 vCPU-seconds at 1 minute each, or 225,000 at 5 minutes each | 240,000 vCPU-seconds a month | **£0**, if each run takes under 5 minutes |
| Cloud Scheduler | Starts the 3 scheduled jobs | 3 jobs | 3 jobs | **£0** (a 4th job would cost $0.10 a month) |
| Firestore database | Products, members, orders, settings | About 1,000–2,000 reads a day | 50,000 reads and 20,000 writes a day; 1 GB stored | **£0** |
| Secret Manager | Keeps payment and API keys secret | 8 active keys | 6 keys and 10,000 reads a month | **$1.44 (£1.12)** |
| Artifact Registry | Copies of the server kept by each deployment | 5.78 GB, and growing with each deployment | 0.5 GB | **$6.34 (£4.94)**, and rising |
| Cloud Build and deployment uploads | Builds the server when deploying | A few builds a month; 17 MB stored | 2,500 build-minutes a month | **under 1p** |
| Logging and monitoring | Error logs and outage alerts | Low volume | 50 GB of logs a month | **£0** |
| **Total** | | | | **about $7.78 (£6.07) a year: about 2p a day, or 0.07p per visitor** |

The same total at other levels of traffic, using approach B:

| Scenario | Cost per year | Per day | Per visitor |
| --- | --- | --- | --- |
| Low (2,910 visits) | £6.07 | 1.7p | 0.21p |
| Expected (8,730 visits) | £6.07 | 1.7p | 0.07p |
| High (29,100 visits) | £6.28 | 1.7p | 0.02p |
| Expected, after clearing old server copies (keeping required secrets) | **£1.12** | 0.3p | 0.01p |

With approach A at high traffic, the total would rise to about **£57 a year**.

**Not included:** domain-name renewal, Stripe card fees (charged on each payment, not for hosting), Workspace accounts, and staff or volunteer time.

## Recommended actions

1. **Delete old server copies.** Add a clean-up policy to the Artifact Registry repository `cloud-run-source-deploy` that keeps the latest 3 copies of each image. The latest 3 website copies (about 125 MB each) plus the JustGo job copy (81 MB) total about 0.46 GB, inside the 0.5 GB free allowance. This saves about £4.90 a year now and stops the cost growing with each deployment.
2. **Keep required secret keys.** There are 8 active keys and 6 are free. The deployed server currently uses the Stripe *test* secret key and webhook secret; deleting them would break checkout. Keep the £1.10 yearly allowance. Review genuinely unused secret versions separately; replacing test credentials with live credentials does not itself reduce the number of required secrets.
3. **Set a budget alert.** In Google Cloud Billing, add a budget of **£5 a month** with email alerts at 50%, 90% and 100%. After clearing old server copies, the website should normally cost about 10p a month.
4. **Upload large banner photos.** Use originals at least 2560 px wide, up to 25 MB, so banners look sharp on large monitors. Replace the current 1152 px home banner.
5. **Keep photo storage in US-WEST1.** It keeps photo delivery free.
   - The trade-off: photos travel from Oregon, which adds about 0.15 seconds before each photo starts to arrive in the UK. The instant preview, the small copy sizes and year-long browser caching hide most of this delay.
   - The alternative: moving photo storage to London (europe-west2) would make photos start to arrive slightly sooner, but it has no free allowance. It would cost about **£2.85 a year** at expected traffic, or £9.20 at high traffic. It would also need every uploaded photo to be moved and every saved photo link to be updated.
6. **Review once a year.** Compare the actual Google Cloud bill and Search Console traffic with this plan.

## Sources

- Firebase pricing: <https://firebase.google.com/pricing>
- Cloud Storage free allowance and pricing: <https://cloud.google.com/storage/pricing> and <https://cloud.google.com/free/docs/free-cloud-features#storage>
- Cloud Run pricing: <https://cloud.google.com/run/pricing>
- Artifact Registry pricing: <https://cloud.google.com/artifact-registry/pricing>
- Secret Manager pricing: <https://cloud.google.com/secret-manager/pricing>
- Cloud Scheduler pricing: <https://cloud.google.com/scheduler/pricing>
- Google Workspace for Nonprofits: <https://www.google.com/nonprofits/offerings/workspace/>
