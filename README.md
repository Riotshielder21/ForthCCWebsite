# Forth Canoe Club Website

The club website provides information about paddling, membership and volunteering, plus a shop for membership, subscriptions, vouchers and event/course tickets. Approved club admins can edit pages in place, manage the catalogue, create forms and download reports.

The React/Vite frontend runs on Firebase Hosting. An Express API runs on Cloud Run, with Firestore for records, Firebase Storage for uploaded images, Stripe for payments and Google Workspace for forms and email. Bundled images and default page content live in this repository.

## Project Layout

| Location | Purpose |
| --- | --- |
| [src/pages/](src/pages/) | Website, shop, admin and report pages |
| [src/components/](src/components/) | Navigation, forms and in-page editor |
| [src/index.css](src/index.css) | Shared styles and tile/heading templates |
| [src/constants/](src/constants/) | Default page copy and starter products |
| [src/utils/](src/utils/) | Firebase, catalogue, pricing and report logic/tests |
| [src/assets/](src/assets/), [public/](public/) | Default assets and published page JSON |
| [server.js](server.js) | Payments, webhooks, reports and admin API |
| [scripts/](scripts/) | Local emulator fixtures/tests and JustGo sync |
| [firebase.json](firebase.json) | Hosting and emulator configuration |
| [.github/workflows/firebase-hosting.yml](.github/workflows/firebase-hosting.yml) | API, website and Firebase-rules deployment |

## Working On It

- [DEVELOPMENT.md](DEVELOPMENT.md): install, run locally, build and test.
- [DEPLOYMENT.md](DEPLOYMENT.md): deploy and check a release.
- [.env.example](.env.example): configuration names; keep real credentials out of Git.

Page edits are reviewed through GitHub before publishing. Catalogue edits and image uploads save to Firebase directly. Stripe reports refresh on demand; scheduling a subscriber's club-year end requires explicit admin confirmation.

Checkout currently accepts Stripe test keys only. Subscription lifecycle handling and complete customer erasure are not implemented; deleting a website record does not cancel Stripe billing.