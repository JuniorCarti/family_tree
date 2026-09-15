# Production Blank Page Incident Report

Incident date: 2026-09-14 (Africa/Nairobi)
Production URL: https://family-tree-a4c4f.web.app/

## Executive Summary

The production page was blank because all three top-level UI screens ship with the `hidden` class and the frontend bootstrap caught the failed `GET /api/auth/session` request without revealing any screen. The API failure is upstream of the route handler: Firebase Hosting correctly rewrites `/api/**` to Cloud Run service `lineage-api`, but Cloud Run revision `lineage-api-00025-hng` cannot start because PostgreSQL terminates the initial connection in `db.js:10`. Cloud Run therefore returns 500/503 Google Frontend HTML before Express listens.

The database URL is present, syntactically valid, and points to Render PostgreSQL. DNS and TCP/5432 are reachable, but both Cloud Run and an independent read-only `SELECT 1` probe fail at the PostgreSQL connection layer. Logs show successful schema initialization through 2026-08-21 and the first observed connection-termination failures on 2026-08-28. Render documents that free PostgreSQL instances expire after 30 days and then have a limited recovery window. This timing and behavior strongly indicate an expired or suspended Render database, but the exact Render control-plane state cannot be confirmed without access to the owning Render dashboard. The proven technical root cause is database unavailability; expiration is the most likely infrastructure cause.

Firebase Hosting was safely updated on 2026-09-14 with a visible recovery state. Production no longer remains blank: a clean, extension-free Chrome profile displays the sign-in page, a generic connection message, and a Retry action. Authentication and tree operations remain unavailable until the existing Render database is recovered.

## User-visible symptom

The page at https://family-tree-a4c4f.web.app/ showed only its parchment background. An extension-free Chrome 152 capture reproduced the blank page before the Hosting repair.

## Confirmed first-party errors

- `GET /api/auth/session` returned HTTP 500, `Content-Type: text/html`, `Server: Google Frontend`, with a generic Google 500 page.
- `GET /api/auth/me` and `GET /api/tree` returned the identical Google Frontend 500 response. The problem was therefore not specific to the session route.
- Direct requests to Cloud Run returned 503 for `/` or 500 for API requests.
- Cloud Run logs for revision `lineage-api-00025-hng` state `Server startup failed: Error: Connection terminated unexpectedly`, originating at `/app/db.js:10:18`, followed by a failed startup TCP probe and container exit 1.
- The frontend catch block at the former `public/app.js:2028` only logged the error. Because `authScreen`, `approvalScreen`, and `app` were all initially hidden in `public/index.html`, the page had no visible state.

## Browser-extension noise

| Console source/message | Classification | Reason |
| --- | --- | --- |
| `/api/auth/session` HTTP 500 | NETWORK/API | Same-origin first-party request, reproduced with curl and clean Chrome. |
| `content.js ... useCache` | BROWSER EXTENSION | Generic content-script filename; absent from the application source and not served by Hosting. |
| `globals-front.js ... Receiving end does not exist` | BROWSER EXTENSION | Extension message-port failure; file is absent from the release. |
| `adblock-picreplacement.js` | BROWSER EXTENSION | Explicit ad-blocker content script; file is absent from the release. |
| `csspeeper-inspector-tools... GF_GET_POPUP_CONFIG` | BROWSER EXTENSION | CSS inspection extension/background-worker failure; file is absent from the release. |
| `Unchecked runtime.lastError: Could not establish connection` | BROWSER EXTENSION | Chrome extension runtime messaging error, not an application API error. |

The application still reproduced as blank in a fresh headless Chrome profile with extensions disabled, proving that extension noise was not causal.

## Production architecture

```text
Browser
  |
  | HTTPS, same origin, __session cookie
  v
Firebase Hosting site: family-tree-a4c4f
  |-- static files from public/
  `-- /api/** rewrite
        v
Cloud Run: lineage-api (us-central1)
  |-- revision lineage-api-00025-hng, 100% traffic
  |-- Express + connect-pg-simple
  `-- DATABASE_URL secret (Secret Manager version 1)
        v
Render PostgreSQL
  `-- unavailable at PostgreSQL protocol layer
```

This is a same-origin browser/API architecture. Credentialed cross-origin CORS is neither required nor added.

## Repository/deployment mismatch

The checked-out `main` branch was commit `377746c` and did not contain the Firebase/Cloud Run deployment configuration or newer approval, verification, payment, archive, and exploration work.

The previous live Hosting release time was 2026-08-06 13:08:14 EAT. Its HTML and assets matched commit `21f6b3f890008a8c6021001ef5d5b4e5b79f24bd` on `origin/feature/tree-exploration-system`, committed at 13:07:34 EAT. The exact Cloud Build source archive for the active backend image digest matched commit `288e2e9fe679938844595344fe56d5aaccfe8064` across all 58 files. Commit `21f6b3f` differs from `288e2e9` only in `public/style.css` and `public/sw.js`, so the deployed frontend JavaScript and backend API were from the same contract revision.

| Component | Production behavior/source | `main` | Other branch/PR | Match? |
| --- | --- | --- | --- | --- |
| `index.html` | `21f6b3f`, 2026-08-06 release | Older 15 KB auth UI | PR #4 / tree-exploration, 81 KB | Production matches branch, not main |
| JS entrypoint | `app.js?v=exploration3` from `288e2e9` | Older `app.js` | PR #4 | Production matches branch |
| `/api/auth/session` | Frontend calls it; backend implements it | Not present on main | Present from `757672b` onward | Contract matches in production |
| `/api/auth/me` | Implemented and used after invitation acceptance | Canonical bootstrap on main | Present on PR #4 | Present in both, different bootstrap role |
| Payment flow | Manual M-Pesa plus optional Daraja foundation | Absent | Present on PR #4 | Production matches branch |
| Email verification | Token-based verification | Absent | Present on PR #4 | Production matches branch |
| Approval flow | Payment submission and superadmin review | Absent | Present on PR #4 | Production matches branch |
| API backend | Cloud Run image source exactly `288e2e9` | Older Express app | PR #4 ancestry | Not main |

The 2026-09-14 Hosting repair is an uncommitted working-tree release based on `21f6b3f`; it must be committed and merged to avoid another source/deployment mismatch.

## Root Cause

1. `db.js` creates a PostgreSQL pool and `initDB()` immediately calls `pool.connect()`.
2. The Render PostgreSQL endpoint terminates or times out the PostgreSQL connection.
3. `db.ready` rejects. Dependent schema promises reject, and `server.js` intentionally refuses to call `app.listen()`.
4. Cloud Run's startup TCP probe cannot connect to port 8080, the container exits with code 1, and Google Frontend returns 500/503 before any Express route executes.
5. Firebase Hosting forwards `/api/auth/session` to that unavailable Cloud Run service and returns Google Frontend HTML 500.
6. The frontend catches that failure but previously left every top-level screen hidden, producing the blank page.

The session handler itself did not throw. No request reached it. Schema drift, cookie flags, route order, CORS, and endpoint aliases cannot cause a pre-listen startup-probe failure.

## Contributing Factors

- Production depends on an external Render PostgreSQL instance. Its behavior and the outage timing are consistent with Render's documented free-database expiry policy; the repository had no availability guardrail for that external lifecycle.
- `main` is far behind the deployed feature branch, and three release PRs remain open in a chain. Production provenance required Cloud Build artifact forensics rather than a main-branch commit.
- The frontend bootstrap silently swallowed its only rendering decision failure.
- The old service worker used `caches.match()` across every cache without deleting previous shell caches. It also cached `/api/tree`, which is authenticated family data and should never enter the application shell cache.
- `.firebaserc` is absent. Commands require an explicit project, increasing wrong-target risk.
- Backend and frontend deploy independently without a committed release manifest tying Hosting release, Cloud Run digest, migrations, and environment requirements together.

## Hypothesis Results

| Hypothesis | Result | Evidence |
| --- | --- | --- |
| A: production is not current `main` | PROVEN | Hosting is `21f6b3f`; backend source is `288e2e9`; main is `377746c`. |
| B: frontend/backend API mismatch | DISPROVEN | The deployed `app.js` calls `/auth/session`; the exact backend source implements it. |
| C: Firebase rewrite is wrong | DISPROVEN as root cause | Config targets `lineage-api` in `us-central1`; emulator and live traces reach that service. |
| D: backend environment is incomplete | DISPROVEN for required startup variables | `DATABASE_URL` and `SESSION_SECRET` are bound to enabled secret versions; the database target itself is unavailable. |
| E: schema is older than backend | DISPROVEN as current trigger | Failure is at `pool.connect()` before SQL; the same revision completed all startup migrations on 2026-08-21. Current schema cannot be re-queried while the DB is unavailable. |
| F: proxy/session cookies are wrong | DISPROVEN as current trigger | Proven topology matches `trust proxy = 1`, secure/lax/httpOnly same-origin cookie configuration. No route is reached. |
| G: extensions generated console noise | PROVEN for named scripts | Files are absent from release; blank page reproduced with extensions disabled. |
| H: frontend turns API failure into blank UI | PROVEN | All root screens hidden; catch block only warned. |
| I: stale cached frontend | NOT the live root cause; risk confirmed | Live HTML matched latest release, but old service worker retained old caches and used cross-cache lookup. |
| J: backend fails database initialization | PROVEN | Cloud Run stack trace points to `db.js:10`; startup probe fails afterward. |

## Authentication and Session Review

- Session storage uses `connect-pg-simple` with the shared PostgreSQL pool, not Express `MemoryStore`.
- Cookie name is `__session`, required for Firebase Hosting forwarding. It is `HttpOnly`, `Secure` in production, `SameSite=Lax`, path default `/`, and has a 24-hour lifetime.
- `app.set('trust proxy', 1)` is appropriate for the proven Firebase Hosting → Cloud Run proxy chain.
- The frontend and API are same-origin. No `credentials: include` or credentialed CORS configuration is needed.
- Production validates that `SESSION_SECRET` exists and is at least 32 characters before listening. The repository fallback is reachable only outside production.
- Login calls `req.session.regenerate()` before establishing the authenticated session; logout destroys the session and clears `__session`.
- Passwords use bcrypt. Password reset uses a random 32-byte, hashed, single-use, expiring token, invalidates other tokens, and removes active sessions. No identifier-only password takeover flow was found.
- SQL uses parameter placeholders in reviewed auth/session paths.
- The generic error middleware previously returned raw internal error messages. It now logs method, path, error class/message, and stack server-side while returning `{ "error": "Server error" }` to clients. That backend change is not deployed yet.

## Environment Configuration

No local `.env` exists. Values below intentionally report state only.

| Variable | Required? | Referenced by | Present locally? | Production state/need | Safe default? |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Yes | `db.js` | Missing | Present, valid URL, target unavailable | No |
| `SESSION_SECRET` | Yes in production | `server.js` | Missing | Present via enabled secret version; startup validation passed | Development only |
| `NODE_ENV` | Yes for secure behavior | `server.js` | Missing | Present | No production default |
| `PORT` | Platform-provided | `server.js` | Missing | Supplied by Cloud Run as 8080 | Local 4000 |
| `DATABASE_SSL` | Optional | `db.js` | Missing | Missing; TLS defaults on | Yes (`rejectUnauthorized: false`) |
| `SUPERADMIN_UID` | Required only for explicit Firebase superadmin bootstrap | `scripts/bootstrap-superadmin.js` | Not set in repository | Operator supplied | Never use an email string as runtime authorization |
| `ACCOUNT_UNLOCK_FEE_KES` | Optional | `platform-access.js` | Missing | Present | 500 |
| `MPESA_PAYMENT_PHONE` | Optional | `platform-access.js` | Missing | Present | Repository default exists |
| `PUBLIC_APP_URL` | Required for correct email links | `trust-access.js`, `memory-access.js` | Missing | Present | Request-origin fallback |
| `APP_BASE_URL` | Optional | `exploration-access.js` | Missing | Missing | Forwarded request origin |
| `MEDIA_BUCKET` | Required for durable Cloud Run media | `media-storage.js` | Missing | Present | Local disk only; unsafe for production durability |
| `MEDIA_LOCAL_DIR` | Local only | `media-storage.js` | Missing | Missing/not applicable | `public/uploads` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `EMAIL_FROM` | Required for production email delivery | `trust-access.js` | Missing | Present | Partial defaults exist but are insufficient for delivery |
| `SMTP_PASSWORD` | Required when SMTP auth is used | `trust-access.js` | Missing | Present via enabled secret version | No |
| `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_CALLBACK_URL` | Optional; only for STK Push | `payment-access.js` | Missing | Missing; manual payment remains enabled | Feature disables itself |
| `DARAJA_ENV` | Optional | `payment-access.js` | Missing | Missing | `sandbox` |

## Database Schema Drift Review

The active backend source owns idempotent startup migrations, serialized where multi-step legacy data conversion is required. Production logs prove the full startup set succeeded on 2026-08-21. Current catalog verification and `SELECT 1` cannot succeed while the database is unavailable.

| Query/feature | Required table/column | Schema contains/migration exists? |
| --- | --- | --- |
| Core auth | `users(id,email,password_hash,family_name,created_at)` | Yes, `db.js` |
| Session persistence | `session` table | Yes, `connect-pg-simple(createTableIfMissing: true)` |
| Session/user context | `families`, `family_memberships`; user approval fields | Yes, `family-access.js` and `platform-access.js` |
| Email verification/reset | `users.email_verified_at`, `auth_tokens` | Yes, `trust-access.js`; hashed expiring tokens |
| Account approval | `users.account_status/is_superadmin/approved_*`, `account_payment_submissions` | Yes, `platform-access.js` |
| Payment foundation | `payment_transactions`, status history, receipts, gifts; access fields | Yes, `payment-access.js` |
| Family tree | `persons`, `relationships`, family and creator columns | Yes, `db.js` plus `family-access.js` |
| Privacy/deletion | person life status, visibility and deletion fields | Yes, `privacy-access.js` |
| Archive | life events, stories, people, comments; coordinates | Yes, `archive-access.js` |
| Evidence/GEDCOM/memories/collaboration/discovery | Feature-specific tables and person localization fields | Yes, corresponding `*-access.js` initializers |

No destructive migration or production data change was performed.

## Changes Made

- `public/boot-state.js`: added a small testable helper that reveals a safe startup-failure state.
- `public/index.html`: added the generic connection message and Retry action; loaded the boot helper.
- `public/app.js`: routes session/bootstrap failures, including unexpected pre-session failures, to the visible recovery state.
- `public/style.css`: styled the Retry action.
- `public/sw.js`: bumped the shell cache, deletes superseded shell caches, uses network-first navigation, and excludes every `/api/**` response from caching.
- `server.js`: logs safe diagnostic request/error context and stops leaking internal 500 messages to users.
- `tests/boot-state.test.js`: verifies failed bootstrap reveals auth/error UI while protected app UI stays hidden.
- `tests/service-worker.test.js`: verifies API responses are not cached and stale shells are removed.
- `package.json`: includes the new targeted tests in the test chain.
- `docs/PRODUCTION_BLANK_PAGE_INCIDENT_REPORT.md`: this report.

## Database Changes

None. No tables, columns, records, secret values, or Render resources were changed. The existing database must be recovered in place to preserve family and payment data.

## Testing Performed

| Check | Result |
| --- | --- |
| `npm ci` | PASS; 329 packages installed. Audit reports 10 moderate and 2 high dependency findings, not modified during this incident. |
| `npm run test:boot-state` | PASS, 1/1 |
| `npm run test:service-worker` | PASS, 2/2 |
| `npm run test:tree-layout` | PASS, 10/10 |
| `node --check public/boot-state.js` | PASS |
| `node --check public/app.js` | PASS |
| `node --check public/sw.js` | PASS |
| `node --check server.js` | PASS |
| `git diff --check` | PASS (line-ending notices only) |
| Full `npm test` baseline | BLOCKED/FAIL: local PostgreSQL is absent (`ECONNREFUSED` on localhost:5432); the database-backed suite cannot run. Docker is unavailable, so a disposable local PostgreSQL container could not be started. |
| `npm run lint` / `npm run build` | NOT RUN: scripts do not exist. Frontend has no build step. |
| Clean Chrome against Hosting emulator with real failing rewrite | PASS: sign-in screen, generic error, Retry visible. |
| Clean Chrome against deployed production Hosting | PASS for graceful failure: same visible recovery state; extensions disabled. |

Authentication success, persistence, logout, and tree data loading cannot be tested until PostgreSQL is recovered. No production login or records were used.

## Production Verification

After the Hosting-only deployment completed at 2026-09-14 14:48:16 EAT:

| Request | Result |
| --- | --- |
| `GET /` | 200, `text/html`, new 83,113-byte Hosting release |
| `GET /api/auth/session` | 500, Google Frontend HTML; backend still cannot start |
| `GET /api/auth/me` | 500, Google Frontend HTML; backend still cannot start |
| `GET /api/tree` | 500, Google Frontend HTML; backend still cannot start |
| Direct Cloud Run `/` | 503, `Service Unavailable` |

No `Set-Cookie` is emitted because Express never starts. Firebase's rewrite is functioning; the target service is not ready.

## Remaining Risks

- The existing Render PostgreSQL instance may be expired, suspended, or already beyond its recovery window. Only its owner dashboard can establish this final provider state.
- If the free instance has already been deleted and no export exists, production data recovery may require Render support and might be impossible. Do not create an empty replacement and call the incident fixed.
- The backend remains unavailable; the current production improvement is graceful degradation, not restored authentication.
- Backend logging/error-response changes remain undeployed.
- Current work is not committed, and `main` still does not represent production.
- Database-backed test coverage needs a disposable PostgreSQL service in CI.
- Dependency audit findings need a separate, scoped remediation.

## Recovery and Deployment Steps

1. In the owning Render dashboard, locate the existing PostgreSQL instance referenced by `lineage-database-url`. Resume or upgrade that same instance immediately if Render offers recovery. Preserve it; do not recreate it.
2. Confirm `SELECT 1` and inspect the expected tables before changing Cloud Run. If Render reports deletion, stop and locate a database export or contact Render support before provisioning a replacement.
3. If the recovered instance keeps the same external URL, Cloud Run requires no configuration change; request `/api/auth/session` to trigger a fresh instance.
4. If Render rotates the URL, add a new Secret Manager version without exposing it in shell history, then pin Cloud Run to that numeric version:

   ```powershell
   gcloud secrets versions add lineage-database-url --data-file=- --project family-tree-a4c4f
   gcloud run services update lineage-api --region us-central1 --project family-tree-a4c4f --update-secrets DATABASE_URL=lineage-database-url:NEW_VERSION_NUMBER
   ```

5. Verify the new Cloud Run revision is Ready and then run the four production smoke requests. An unauthenticated session request must return controlled JSON such as `200 {"authenticated":false}`, never Google HTML 500.
6. With a disposable test account, verify signup/verification as policy permits, login, cookie persistence across reload, authenticated session, tree load, logout, and post-logout access denial.
7. Commit this incident branch, merge the release PR chain deliberately, and make `main` (or a documented production branch) the only deployment source.

## Prevention

- Use a durable paid PostgreSQL plan or a managed database with backups and alerting; free 30-day stores are not production infrastructure.
- Add scheduled external smoke checks for `/` and `/api/auth/session`; alert on non-JSON or 5xx.
- Run database-backed tests in CI with disposable PostgreSQL.
- Record frontend commit, Cloud Run image digest, schema migration status, and Hosting release together for every deployment.
- Keep Firebase configuration on the canonical production branch and add `.firebaserc` only if the team wants a committed default project; otherwise require `--project family-tree-a4c4f` in scripts.
- Deploy migrations/backend first, validate readiness, then deploy a frontend that uses that API contract.
- Retain the visible boot failure state and never cache authenticated API data in the service worker.
