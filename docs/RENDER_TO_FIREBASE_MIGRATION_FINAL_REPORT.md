# Render to Firebase migration — production cutover report

Status: **PARTIAL / NOT ZERO-DATA-LOSS COMPLETE** (2026-09-15 UTC). Firebase runtime cutover is deployed, but the original PostgreSQL source has not been recovered or reconciled, so Cloud Run/Render remain rollback dependencies.

## Revision baseline

| Component | Revision |
| --- | --- |
| Migration branch | `migration/firebase-native` |
| Migration base | `21f6b3f890008a8c6021001ef5d5b4e5b79f24bd` plus preserved incident changes |
| Frontend | Firebase Hosting release deployed 2026-09-15 |
| Backend | Firebase Functions 2nd gen `api`, `us-central1`, deployed 2026-09-15 |
| Legacy rollback | Cloud Run `lineage-api` retained; not retired |

## Source database status

**STATUS UNKNOWN / NOT RECOVERED.** Prior evidence established PostgreSQL connection failure, but no owning Render confirmation, complete dump, or usable password-hash export was available. The partial Excel artifact contains one person and zero relationships and is not a source-of-truth replacement. No Firebase data was fabricated and no production source was deleted.

## Original and Firebase counts

| Entity | Source | Firebase target | Result |
| --- | ---: | ---: | --- |
| Users | Unknown | 0 imported | Blocked by source recovery |
| Persons | Unknown (partial export: 1) | 0 historical imports | Blocked by source recovery |
| Relationships | Unknown (partial export: 0) | 0 historical imports | Blocked by source recovery |
| Trees | Unknown | 0 historical imports | Blocked by source recovery |
| Payments/approval/verification | Unknown | 0 historical imports | Blocked by source recovery |
| Photos | Unknown | 0 historical migrations | Blocked by source inventory |
| Unexplained differences | Unknown | N/A | Cannot claim zero |

## Firebase deployment

- Project `family-tree-a4c4f`; Hosting `https://family-tree-a4c4f.web.app/` returns 200.
- Web app `Lineage`: `1:662162914072:web:79b26ab06e887807ea3c6d`.
- Firestore Native `(default)` in `us-central1`; rules/indexes deployed.
- Storage bucket `gs://family-tree-a4c4f.firebasestorage.app`; rules deployed.
- Functions `api` 2nd gen in `us-central1`; Hosting `/api/**` rewrite deployed.
- Live probes: `/` → 200; `/api/health?probe=20260915` → 200 JSON; unauthenticated `/api/auth/session?probe=20260915` → controlled 401 JSON, not 500.

## Authentication and security

The browser bridge uses Firebase Auth ID tokens for sign-in, sign-up, sign-out, password reset, email verification, and bearer API calls. Functions verify tokens with Admin SDK. Firestore/Storage emulator isolation tests pass. Existing bcrypt users were **not** imported because source hashes were unavailable; no hashes are stored in Firestore.

## Validation

- `npm run test:firebase`: PASS (4 contract tests).
- Rules emulator suite: PASS (3 tests).
- Three-generation graph CRUD emulator suite: PASS (1 test).
- Functions smoke test and Node syntax checks: PASS.
- Root PostgreSQL integration tests: not runnable without PostgreSQL (`ECONNREFUSED 127.0.0.1:5432`).
- Clean-browser authenticated sign-in, upload, and visual tree verification: not executed in this environment.

## Remaining blockers

1. Recover/upgrade the original Render PostgreSQL instance or locate a complete immutable dump before any historical migration claim.
2. Verify Firebase Email/Password is enabled and run two disposable-account browser smoke tests.
3. Migrate/reconcile legacy sharing, approvals/payments, memories, evidence, import/export, and other non-core routes.
4. Upgrade Functions runtime from Node 20 before its announced decommission date; configure Artifact Registry cleanup policy.

Cloud Run, Render, and `DATABASE_URL` are intentionally **not** retired because zero-data-loss reconciliation and rollback readiness are not proven.
