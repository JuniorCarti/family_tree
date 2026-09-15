# Firebase feature parity matrix

This matrix is based on the latest `migration/firebase-native` source. “Implemented” means code exists in the Firebase foundation; “Pending” means it has not been migrated or tested end-to-end.

| Feature | Legacy | Firebase | Frontend | Backend | Tested | Production Ready |
|---|---|---|---|---|---|---|
| Signup/login/logout/session | PostgreSQL sessions | Firebase Auth ID tokens | PASS code deployed | PASS server-side | PASS emulator/contract; browser pending | PARTIAL — provider/browser smoke test pending |
| Password reset/verification | Custom token routes | Firebase Auth | PASS code deployed | PASS client bridge | PASS static integration; browser pending | PARTIAL — provider/browser smoke test pending |
| Account approval/payments | `platform-access.js`, M-Pesa records | Not migrated | FAIL | FAIL | FAIL | FAIL |
| User profile | `users` table | `users/{uid}` | PASS code deployed | PASS endpoint | PASS emulator graph path | PARTIAL — browser pending |
| Tree load/name | `/api/tree` | `/api/tree`, Firestore | PASS code deployed | PASS | PASS CRUD emulator | PARTIAL — browser pending |
| Person CRUD | `/api/persons` | tree persons subcollection | PASS code deployed | PASS | PASS CRUD emulator | PARTIAL — browser pending |
| Relationship CRUD | `/api/relationships` | validated subcollection edges | PASS code deployed | PASS | PASS rules/CRUD/contract | PARTIAL — browser pending |
| Layout/exploration | browser modules | unchanged client modules | PASS | N/A | PASS existing tests | PASS static UI |
| Sharing/invitations | `family-access.js` | Firestore members/invitations/share-links | PASS code | PASS routes | PASS contract | PARTIAL — browser smoke pending |
| Memories/evidence/archive | dedicated legacy modules | Firestore collections + Storage metadata | PASS code | PASS routes | PASS contract | PARTIAL — QR/browser upload smoke pending |
| Imports/exports | GEDCOM/Excel/JSON routes | GEDCOM export; import guarded | PARTIAL | PARTIAL | PASS route contract | PARTIAL — import intentionally unavailable |
| Photos/uploads | local/media storage routes | Storage rules/path convention | PASS upload helper | PASS cleanup/upload path | PASS Storage adversarial rules | PARTIAL — browser upload pending |
| Error/retry boot UI | incident patch | retained | PASS | N/A | PASS | PASS |

The old Cloud Run service remains untouched as rollback protection. No production cutover is claimed while any required row is “No”.
