# Firebase-native migration report

## Status

**PARTIAL — Firebase Hosting, Functions, Firestore, Storage rules, Web configuration, Auth bridge, and graph CRUD are deployed and verified. Historical PostgreSQL data recovery and several legacy feature migrations remain blocked.**

## Previous and target architecture

Previous: Firebase Hosting → Cloud Run `lineage-api` → Render PostgreSQL.

Target: Firebase Hosting → Firebase Auth / Functions 2nd gen → Firestore and Cloud Storage.

## Implemented

- Functions `api` with ID-token verification, health endpoint, session/me compatibility endpoints, tree/person/relationship CRUD, graph endpoint validation, and tenant checks.
- Firestore and Storage rules, indexes configuration, `.firebaserc`, and Hosting rewrite to the Functions target.
- Dry-run-first user import and reconciliation validation utilities.
- Previous boot error/retry behavior retained.
- Firebase Web bridge, official Web config, Firebase Auth forms, password-reset flow, verification hook, Storage upload helper, and API ID-token injection are deployed in Hosting.
- Feature parity and cutover gates are recorded in `docs/FIREBASE_FEATURE_PARITY_MATRIX.md` and `docs/FIREBASE_PRODUCTION_CUTOVER_CHECKLIST.md`.
- Firebase Web App `Lineage` is registered (`1:662162914072:web:79b26ab06e887807ea3c6d`) and its public SDK configuration is in `public/firebase-config.js`.
- Production Firestore `(default)` Native database was created in `us-central1`; Firestore rules and indexes deployed successfully.
- The official Storage bucket is `gs://family-tree-a4c4f.firebasestorage.app`; Storage rules deployed successfully.
- Three-generation Firestore CRUD/persistence emulator scenario passed, including relationship deletion and reload verification.
- Functions API now supports tree creation/rename, first-tree compatibility for legacy routes, snake_case field normalization, and server-side photo cleanup.
- Functions `api` (2nd gen, `us-central1`) and Hosting were deployed to `family-tree-a4c4f`; `/api/health?probe=...` returns 200 and unauthenticated session requests return controlled 401 JSON.

## Validation performed

- `node --check functions/src/index.js`: pass.
- `node --check scripts/migrate-to-firebase/import-users.js`: pass.
- `node --check scripts/migrate-to-firebase/validate-migration.js`: pass.
- `functions`: `npm test`: pass (Functions entrypoint smoke test).
- Temurin JDK 21.0.12.1 installed; Firebase Emulator Suite started Auth, Firestore, Functions, Storage, and Hosting successfully.
- `npm run test:firebase`: pass (4 contract tests).
- `firebase emulators:exec --project family-tree-a4c4f "node --test tests/firebase-rules.test.js"`: pass (3 adversarial Firestore/Storage tests covering two users and anonymous access).
- `firebase emulators:exec --project family-tree-a4c4f "node --test tests/firebase-crud.test.js"`: pass (three-generation graph persistence and safe edge deletion).
- Storage path upload validation and person-photo cleanup hooks are implemented; browser upload still needs a clean-browser authenticated smoke test.
- Root boot-state, service-worker, and tree-layout tests: pass.
- Legacy PostgreSQL-backed family-sharing test: not runnable without PostgreSQL (`ECONNREFUSED 127.0.0.1:5432`); this is an expected migration blocker, not a Firebase test failure.

## Historical data

The provider database was not recoverable during this implementation window. Only a partial Excel export (one person, zero relationships) is available; no complete users or password-hash source was found. No historical records are claimed as migrated.

## Remaining before cutover

Remaining work is a controlled authenticated browser smoke test, confirmation that Email/Password is enabled in Firebase Auth, and migration/reconciliation of unavailable historical PostgreSQL data and legacy sharing/approval/payment/memory/evidence/import/export features. Keep the legacy Cloud Run service until those gates pass.
