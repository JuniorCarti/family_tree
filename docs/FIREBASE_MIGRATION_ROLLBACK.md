# Firebase migration rollback

Rollback remains available through the retained Cloud Run revision and any recovered PostgreSQL dump. Trigger rollback if authentication fails systemically, tree/relationship counts diverge, cross-user access is possible, uploads fail, or Functions/Firestore errors are systemic.

1. Stop Firebase Hosting release promotion and preserve logs/reconciliation artifacts.
2. Restore the last known-good Hosting release and Cloud Run rewrite only after confirming its database endpoint is available.
3. Keep Firebase documents; do not delete them while investigating.
4. Reconcile the failed release against the immutable source backup before another cutover.

There is currently no complete PostgreSQL backup, so historical-data rollback readiness is **not available** until source recovery succeeds.
