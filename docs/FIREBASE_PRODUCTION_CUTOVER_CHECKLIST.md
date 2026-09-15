# Firebase production cutover checklist

| Gate | Result | Evidence / blocker |
|---|---|---|
| Firebase project confirmed | PASS | `family-tree-a4c4f`, Hosting site matches |
| Hosting rewrite points to Functions | PASS deployed | `firebase.json`; Hosting release deployed 2026-09-15 |
| Firestore created | PASS | `(default)` Native database created and verified |
| Firestore location documented | PASS | Actual location `us-central1`; aligns with Functions and existing Storage |
| Auth web configuration | PASS configuration / VERIFY provider | `Lineage` Web App registered; official config in `public/firebase-config.js`; Email/Password provider still requires Console verification |
| Functions source/dependencies | PASS | `functions/`, `npm test` pass |
| Firestore Rules tests | PASS locally | Two-user owner/non-member/anonymous emulator tests pass |
| Storage Rules tests | PASS locally | Anonymous, cross-user, wrong-tree, MIME, and authorized upload cases pass |
| Production Storage enabled | PASS | `gs://family-tree-a4c4f.firebasestorage.app`; `storage.rules` deployed |
| Frontend ID-token integration | PASS code deployed | `firebase-client.js` signs in/up/out, reset/verify, and injects bearer tokens |
| Tree CRUD against Firestore | PASS locally | Three-generation create/read/reload/delete-edge scenario passed in emulator |
| Photo upload | PARTIAL | Firebase Storage upload path implemented; authenticated browser upload not yet executed |
| Feature parity | PARTIAL | Core auth/profile/tree/person/relationship paths migrated; sharing, approvals, payments, memories, evidence, imports/exports remain unmigrated |
| No Render/Cloud Run browser calls | PASS deployed | Hosting rewrite targets Functions; legacy Cloud Run retained only for rollback |
| Production smoke tests | PARTIAL | Anonymous health/session probes verified; clean-browser authenticated smoke test remains |
| Cloud Run retirement | NOT SAFE | Keep `lineage-api` until all gates pass |

## Required controlled sequence

1. Create Firestore in `us-central1` after confirming billing/region approval.
2. Obtain the Firebase Web SDK configuration and integrate Auth in `public/`.
3. Run Auth, Firestore, Functions, Storage, and Hosting emulators with cross-user tests.
4. Complete feature parity and upload integration.
5. Deploy rules/indexes, Functions, then Hosting.
6. Smoke-test with two disposable accounts; only then classify Cloud Run as safe to retire.

## Latest execution evidence

- Temurin JDK 21.0.12.1 is installed and verified.
- `firebase emulators:exec --project family-tree-a4c4f "npm run test:firebase"` completed with exit code 0 after clearing stale emulator processes.
- The Functions emulator loaded `api` and Hosting/Firestore/Auth/Storage emulators started successfully.
- The test suite currently proves configuration/token/rule-contract invariants; it does not yet prove authenticated Firestore or Storage behavior.
- Firebase Web App `Lineage` registration and official SDK config retrieval completed.
- Storage bucket initialization and `storage.rules` deployment completed.
- Live probes: `GET /` 200; `GET /api/health?probe=...` 200; unauthenticated `GET /api/auth/session?probe=...` 401 JSON (not 500).
- Three-generation Firestore CRUD/persistence scenario passed in the Emulator Suite.
