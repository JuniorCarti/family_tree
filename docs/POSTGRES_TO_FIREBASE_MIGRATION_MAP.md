# PostgreSQL to Firebase migration map

The current runtime still contains the legacy Express/PostgreSQL implementation for audit and rollback. The Firebase implementation lives under `functions/` and uses Firebase Admin SDK identity (`Authorization: Bearer <ID token>`), Firestore, and Storage paths.

| Legacy area | Current SQL purpose | Firebase replacement | Status |
|---|---|---|---|
| `server.js` auth/session | `users`, `__session`, bcrypt/session cookies | Firebase Auth + verified ID token; `users/{uid}` profile | Implemented in Functions foundation |
| `server.js` tree | family metadata query/update | `trees/{treeId}` and `members/{uid}` | Implemented |
| `server.js` persons | person CRUD and ownership checks | `trees/{treeId}/persons/{personId}` | Implemented |
| `server.js` relationships | graph CRUD and endpoint validation | `trees/{treeId}/relationships/{relationshipId}` | Implemented |
| `family-access.js` | families, memberships, invitations | `trees/{treeId}/members/{uid}` plus invite service | Pending feature parity |
| `platform-access.js` | approval/payment state | `users/{uid}` status and server-only payment collections | Pending feature parity |
| archive/memories/evidence modules | domain tables and joins | dedicated tree subcollections | Pending feature parity |
| media/upload routes | local disk / media rows | Storage object path + Storage Rules | Rules implemented; transfer pending |

No production data was available for destructive migration. The available Excel artifact is explicitly partial (one person, zero relationships) and is retained under `migration-private/recovery` outside source control. It must not be treated as a complete backup.
