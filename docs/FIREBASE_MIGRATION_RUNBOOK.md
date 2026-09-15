# Firebase migration runbook

1. Confirm Render source status and obtain a complete read-only `pg_dump` plus SHA-256 manifest. If unavailable, stop; do not create an empty replacement.
2. Freeze writes or capture a final delta. Inventory every table, constraint, row count, legacy ID, photo, payment, approval, and verification record.
3. Run the repository migration validator in dry-run mode and require zero unresolved references before writes.
4. Test Auth import with a disposable sample before importing bcrypt users. Never log hashes.
5. Run Rules/CRUD emulators and reconcile source/target counts and graph edges.
6. Deploy in order: `firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting --project family-tree-a4c4f`.
7. Verify `/`, `/api/health`, unauthenticated session behavior, two-user isolation, login, tree load, CRUD, upload, logout, and reload in a clean browser.
8. Retain PostgreSQL/Cloud Run rollback material through an observation window. Retire only after reconciliation and smoke-test sign-off.
