# Firebase-native Lineage architecture

```text
Browser -> Firebase Hosting (public/)
        -> Firebase Authentication (ID token)
        -> Hosting /api/** rewrite -> Functions 2nd gen `api`
                                      -> Admin SDK -> Firestore / Storage
```

The Firebase project is `family-tree-a4c4f`; Hosting serves `family-tree-a4c4f.web.app`. The production `(default)` Firestore Native database exists in `us-central1`, aligned with the Functions region. The registered Web app is `Lineage` (`1:662162914072:web:79b26ab06e887807ea3c6d`). The official Storage bucket is `gs://family-tree-a4c4f.firebasestorage.app` in `US-CENTRAL1`, and its rules are deployed.

## Location decision

`africa-south1` was evaluated because the expected user base is in Kenya/East Africa. The current selection remains `us-central1` because Functions and the existing Storage bucket are already there, avoiding a mixed-region deployment and cross-region media latency/cost during the initial cutover. This is a deliberate trade-off, not an arbitrary default; changing to Johannesburg should be a separate latency/cost project before Firestore is provisioned.

The Functions API verifies Firebase ID tokens server-side. Authorization is derived from `trees/{treeId}/members/{uid}` or the server-owned `ownerUid`; browser-supplied owner IDs and roles are not trusted. Firestore and Storage rules provide a second authorization boundary.

## Collections

`users/{uid}` stores profile and account state. `trees/{treeId}` stores tree metadata, with `members`, `persons`, and `relationships` subcollections. Each person and relationship may retain a `legacy*Id` when a recoverable source record exists. Photos use `users/{uid}/trees/{treeId}/persons/{personId}/...` Storage paths.

## Deployment

Deploy rules/indexes/storage rules, then Functions, then Hosting. Firebase project configuration and Web SDK config are public identifiers; Admin credentials are supplied by Application Default Credentials in Functions and are not in the repository. The former Cloud Run rewrite is removed from `firebase.json`. Cloud Run remains available only as rollback protection until authenticated production smoke tests and feature/data reconciliation complete.

Historical PostgreSQL recovery is a separate, unresolved workstream. No unavailable users, passwords, trees, payments, or photos are fabricated.
