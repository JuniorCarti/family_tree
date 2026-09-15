# Firebase cutover plan

Current state: Hosting, Functions, Firestore configuration, Storage rules, and Web config are deployed. Historical data cutover is **not approved** because the PostgreSQL source is unavailable.

Approved sequence after source recovery: immutable dump and inventory; staging Auth/Firestore/Storage migration; short read-only final delta; production migration with zero unexplained differences; deploy Functions then Hosting; two-account smoke test; observation; only then retire Cloud Run/Render.
