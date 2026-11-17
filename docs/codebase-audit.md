# Codebase audit and first readability pass

Date: 17 November 2026.

## Scope and conclusion

This is a maintainability and architecture audit, with a focused production-code refactor. It covers the repository
layout, build and test setup, deployment boundaries, and sampled high-impact browser, server and shared modules.
It is not a line-by-line review of every file, a penetration test, or a legal/compliance certification.
No live member records or production services were used to reproduce the findings.

The existing structure is workable. Keep colocated unit tests: moving them away would not address the main problems.
The biggest improvements are clearer feature ownership, less compressed validation code, and better handling of
partial failures and content freshness. There is no need for a framework replacement or a wholesale folder migration.

## Findings, in priority order

### 1. Consent wording and its policy version are saved separately

**Priority: high. Behavioral follow-up; not changed in this refactor.**

[publishConsentWording](../src/server/consentWording.js) writes the new wording before calling
[syncPolicies](../src/server/policies.js). If versioning fails, the wording remains changed even though publishing
returns an error. Repeating the same save takes the unchanged-wording return and does not retry versioning.
Until a later sync succeeds, checkout can show new wording while recording an older policy version.

An in-memory failure-injection check confirmed both the persisted wording and the skipped retry. A separate fix
should make wording publication and version assignment consistent, including retries and concurrent publishers.

### 2. Public page content remains cached for the lifetime of an open tab

**Priority: medium. Behavioral follow-up; not changed in this refactor.**

[publicContent.js](../src/utils/publicContent.js) keeps successful fetch promises in a module-level map with no
expiry or refresh path. Revisiting a page reuses the first result rather than fetching it again. The network-first
service worker cannot help when the application does not issue another request.

An isolated browser-module check loaded a page, changed the simulated server response, then loaded it again:
the application returned the original text and made only one request. Define a refresh policy separately, preserving
offline behavior and in-flight request deduplication.

### 3. Some fallback paths hide whether data is current

**Priority: medium. Behavioral follow-up; not changed in this refactor.**

[refreshAvailability](../src/App.jsx) discards rejected requests, and
[refreshConsentWording](../src/utils/consentWordingClient.js) suppresses both network and HTTP failures.
Keeping offline data is reasonable, but callers cannot distinguish a current result from a failed refresh.
In particular, an admin wording save awaits a refresh that cannot report failure.

Use explicit refresh outcomes and appropriately scoped user feedback rather than removing offline fallbacks.
Expected offline/storage limitations should remain distinguishable from server errors.

### 4. Feature ownership is inconsistent

**Priority: medium. Partly addressed in this pass.**

At the start of this audit, [server.js](../server.js) contained about 3,200 lines spanning payment processing,
content publishing, reports, integrations, mail delivery and startup. [App.jsx](../src/App.jsx) combines routing,
catalogue loading, basket persistence, emailed basket links and checkout orchestration. The
[volunteer server module](../src/server/volunteers.js) also combines several related but substantial workflows.

Extract cohesive features incrementally, following the existing route-registration pattern. Avoid a new generic
service/controller/repository hierarchy unless a concrete feature actually needs it.

This pass moves the three page-publishing endpoints and their GitHub helpers into
[pagePublishing.js](../src/server/pagePublishing.js). Authentication and notification delivery remain explicit
dependencies, while the entry point registers the feature.

### 5. Compressed validation makes business rules harder to inspect

**Priority: medium. Addressed for two representative areas.**

Several modules combine multiple object fields, conditionals and normalizations on single lines. This makes changes
harder to review, especially for nested person and guardian data.

This pass expands [person sanitization](../src/utils/checkout.js) into clearly grouped fields and reuses small
phone/postcode helpers. It also makes the guards in [adminAccess.js](../src/utils/adminAccess.js) easier to follow.
Existing output fields, normalization fallbacks, validation messages and authentication outcomes are preserved.
Simple expressions remain simple; extra layers and explanatory comments are not added just for appearance.

### 6. Test organization is sound, but browser-level verification is missing from CI

**Priority: medium. Follow-up.**

[CI](../.github/workflows/checks.yml) runs unit tests, a production build, a server syntax check and emulator
integration tests. These are useful protections. The workflow does not run a dedicated browser/component suite.
Pure logic and API checks cannot fully verify tab controls, form interaction or an already-open page after an update.

Keep unit tests beside their modules. Add a few browser scenarios for those interactions when changing them,
rather than broadly chasing coverage. Separating the integration suites from operational
[scripts](../scripts/) would improve navigation but is lower priority than those missing scenarios.

### 7. Development tooling and module boundaries could be clearer

**Priority: low. Follow-up.**

[package.json](../package.json) has no lint or type-check command. The
[utils directory](../src/utils/) contains shared business rules alongside browser storage, hooks and monitoring
configuration. New nested test directories would also need an update to the current unit-test command's globs.

Consider a small ESLint baseline and explicit browser/shared boundaries as those areas change. TypeScript can help,
but a repository-wide conversion is not required for readable or reliable code. Tests remain development inputs;
Vite's module graph determines browser-bundle inclusion, not proximity to production files.

## First-pass verification

- 87 existing focused unit tests passed for admin access, checkout, personal details, page tiles, saved drafts
  and GitHub rebasing.
- 19 mocked before/after route scenarios matched HTTP status, headers, response bodies, GitHub requests,
  notifications and warning behavior. Cases included authentication, missing configuration, malformed page input,
  new/existing branches and files, rebase failure, save failure, and new/existing review requests.
- 210 before/after person-sanitization cases matched, including malformed inputs and boundary lengths.
- Production build passed, with the existing bundle-size warning.
- The complete emulator integration runner passed, including the JustGo Python suites using the existing virtual
  environment and all 83 checkout scenarios. No external Stripe or Workspace calls were needed.

## Next steps

1. Make consent publication/versioning consistent under failure and retry.
2. Specify public-content refresh behavior and make failed refreshes visible without breaking offline use.
3. Add browser coverage alongside those fixes.
4. Continue one feature extraction at a time; keep payment and erasure changes separate from readability-only work.
