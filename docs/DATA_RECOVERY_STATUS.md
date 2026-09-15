# Data recovery status

Assessment: 2026-09-14 UTC. Migration is BLOCKED at source recovery.

## Source classification

**STATUS UNKNOWN**. No authenticated Render provider response is available to classify the original database as ACTIVE, EXPIRED / RECOVERABLE BY UPGRADE, or DELETED.

The previous incident proved PostgreSQL connection failure during Cloud Run startup. It did not prove Render expiration or deletion. Secret Manager version creation on August 5 is not evidence of database creation on that date. Historical logs show a successful start on August 21 and failures by August 28. Those facts do not establish the Render plan, expiration deadline, or recoverability.

| Required provider field | Evidence/state |
| --- | --- |
| Database name | Unknown |
| Candidate instance identifier | `dpg-d9g8863tqb8s73b7e6c0-a` hostname label from earlier connection diagnosis; provider identity must be verified |
| Creation date, plan, size | Unknown |
| Status, expiry, grace period | Unknown |
| Region | Host indicates Oregon; provider metadata not obtained |
| Last known successful application start | August 21, 2026, from prior Cloud Run logs |
| Current API target | `lineage-api-00025-hng`, verified again during this task |
| Database secret binding | `lineage-database-url:1`, verified again; contents not printed |

No Render CLI or RENDER-named environment credential was found. Available connector tools include no Render connection. Plugin-management instructions were inspected, but their discovery/suggestion tools are unavailable in this session. No billing change, database replacement, secret rotation, or production write was performed.

## Recovery search

| Location | Result | Limitations |
| --- | --- | --- |
| Repository backup/export filename scan | No dump/backup candidate found | Ignored dependency and Git internals |
| Local Desktop, Documents, Downloads | One candidate Excel export in Downloads | Filename-based search; not proof that no other copy exists elsewhere |
| GitHub Actions artifacts | API reports total_count = 0 | Expired/deleted artifacts and other repositories unavailable |
| `family-tree-a4c4f-media` | Five live object paths; no backup/export filename matches | Object contents, generations, soft-deleted objects and SQL mapping not inventoried |
| `family-tree-a4c4f_cloudbuild` | Fifteen live object paths; no backup/export filename matches | Source archives are not established database backups; archive contents not searched in this turn |
| `run-sources-family-tree-a4c4f-us-central1` | Five live object paths; no backup/export filename matches | Same limitations |
| Render exports/snapshots, other machines/test systems | Unknown | Requires owner/provider access |

The Excel export contains one People data row and zero Relationships data rows. Its columns represent names, dates, gender, birthplace, notes and relationship display labels. It contains no user identities/password hashes, stable source IDs, approval/payment records, photo mapping, or proof of completeness. It cannot support a zero-data-loss migration.

A byte-identical copy was preserved under `migration-private/recovery/`, marked read-only and SHA-256 verified. Its manifest is private. This is a partial recovery artifact, not an immutable PostgreSQL snapshot or a rollback backup. The original file was left unchanged.

## Source safety and next gate

1. Obtain authenticated Render status for the original instance, including plan, expiration/recovery status and available exports. Do not interpret a 404 without checking account/workspace access.
2. If recoverable, recover the existing instance in place. Verify `SELECT 1` using a database-only client. Do not start the legacy application as a connectivity test: importing its database modules executes schema migrations.
3. Before restoring source connectivity, prepare an approved write freeze: the existing Cloud Run revision may resume automatically and accept writes once the database is available. Use a controlled maintenance window or provider access restriction, then obtain a consistent snapshot and backup before inventory.
4. Create private custom-format and schema-only dumps, exact counts and a catalog inventory from a consistent source snapshot. Hash and verify artifacts, restrict access and copy to immutable backup storage. Preserve the source.
5. If the provider confirms deletion, search owner backups, provider recovery, exports and retained object generations before deciding whether complete recovery is possible. Do not import this partial spreadsheet as the production dataset.

No source freeze, successful SQL query, PostgreSQL backup, actual schema inventory, Firebase Auth import, Firestore write, Storage migration, Functions deployment or cutover has occurred. Recovery requires the owning Render workspace connection or a verified complete backup supplied through a private local path; never paste passwords, hashes or database URLs into chat.
