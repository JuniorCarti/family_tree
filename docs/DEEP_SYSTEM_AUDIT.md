# Lineage deep system audit

Date: 2026-09-15

## Scope

Audited Firebase Hosting/Functions routing, Auth state transitions, approval access, superadmin authorization, phone OTP integration, Firestore/Storage rules, frontend API calls, archive workspace loading, service-worker cache behavior, and responsive CSS breakpoints. Changes were validated with syntax checks, Firebase contract tests, and emulator graph/rules tests.

## Confirmed findings and fixes

| Finding | Impact | Fix | Status |
|---|---|---|---|
| Pending approval logout still called removed `/auth/logout` | 404 and user could remain signed in | Firebase `signOut()` on all Firebase-authenticated logout buttons | Fixed and Hosting deployed |
| Phone OTP used the wrong Firebase v11 `RecaptchaVerifier` constructor | SMS flow failed before/while reCAPTCHA initialization | Construct with `(auth, container, options)` and normalize Kenyan numbers to E.164 | Fixed and Hosting deployed |
| `/api/account/access` was absent | Approval screen generated 404 | Added Firebase profile/payment access endpoint | Fixed and Functions deployed |
| Firebase API lacked archive endpoints loaded by the shipped UI | Timeline/story tabs generated guaranteed 404s | Added Firestore-backed archive overview/events/stories/comments routes | Fixed for core archive paths |
| Unknown Functions paths returned Express HTML 404 | Browser diagnostics were opaque | Added JSON 404 response with request path | Fixed and Functions deployed |
| Profile `isSuperadmin` could be confused with authorization | Privilege escalation risk if profile data were trusted | Backend authorization now accepts only Admin-issued `superadmin` claims | Fixed |

## Automated checks

- Firebase contract tests: **7/7 passed**.
- Firestore/Storage emulator isolation tests: **3/3 passed** in the latest successful emulator run.
- Three-generation graph CRUD emulator test: **passed**.
- `node --check` for Functions and frontend Auth code: **passed**.
- `git diff --check`: no whitespace errors.

## Frontend/API inventory

The shipped UI modules for evidence, memories, quality, collaboration, discovery, recycle bin, duplicates, family invitations, sharing, and GEDCOM export now have Firebase Functions route coverage. Records are stored under the authenticated tree and all writes require approved membership. GEDCOM import and QR generation intentionally return controlled `501` responses until a multipart parser/QR dependency is approved; account deletion likewise remains guarded rather than destructive.

## Responsive/UI review

The page has viewport metadata, mobile breakpoints for authentication, approval, workspace tabs, archive grids, evidence, memories, discovery, and 3D tree views. Pointer gestures use `touch-action` and the service worker cache is versioned. Automated layout tests pass. Real-device visual verification remains required at 320px, 390px, tablet, desktop, and mobile Safari/Chrome because no browser/device runner was available in this execution environment.

## Remaining risks

1. Firebase Phone Auth still requires Console SMS-region policy, billing, authorized domains, and reCAPTCHA configuration; code alone cannot enable those provider settings.
2. Functions deployment warns that Node 20 is approaching decommissioning and Artifact Registry cleanup policy is absent.
3. Full parity is incomplete for GEDCOM import, memory QR generation, and destructive account deletion; these return explicit `501` responses instead of opaque 404s.
4. Clean-browser authenticated Google/Phone login, approval actions, upload, and visual responsive checks remain manual release gates.

## Release recommendation

The core Firebase shell, authentication bootstrap, approval gate, tree graph, archive timeline/story paths, and logout path are suitable for focused smoke testing. Do not call the entire product feature-complete until the remaining frontend/API inventory is either migrated or intentionally removed from the production navigation.
