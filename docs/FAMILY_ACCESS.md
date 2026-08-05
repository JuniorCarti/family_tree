# Family Access and Sharing

Lineage uses one account per person. Relatives never need the tree creator's password. Access is granted through a single-use invitation link and is scoped to one family tree.

## How joining a family works

1. An owner or administrator opens **Family access**.
2. They enter the relative's email, choose a role, and create an invitation.
3. They send the generated link privately to that relative.
4. The relative opens the link and either signs in to an existing account or creates an account with the invited email address.
5. The invitation is consumed and that family tree becomes available in the relative's family selector.

Invitation links expire after seven days, can be revoked before use, are single-use, and only work for the normalized email address entered by the inviter. Only a SHA-256 hash of the invitation token is stored in PostgreSQL.

## Roles

| Role | View and export | Add/edit people and relationships | Rename tree | Invite/remove members | Manage administrators |
| --- | --- | --- | --- | --- | --- |
| Viewer | Yes | No | No | No | No |
| Contributor | Yes | Yes | No | No | No |
| Administrator | Yes | Yes | Yes | Yes | No |
| Owner | Yes | Yes | Yes | Yes | Yes |

The API enforces every permission. Hiding controls in the browser is only a usability aid and is not the security boundary.

## Multiple family trees

An account can belong to multiple family trees and can create additional trees. The active tree is stored in the server-side session. Every person, relationship, member query, merge, and export is filtered by the active `family_id`.

## Data model

| Table or column | Purpose |
| --- | --- |
| `families` | A shared tree and its owner |
| `family_memberships` | One user's role in one family |
| `family_invitations` | Expiring, single-use invitations with hashed tokens |
| `persons.family_id` | Family that owns the person record |
| `relationships.family_id` | Family that owns the relationship record |
| `created_by_user_id` | Account that originally added a record |

The legacy `user_id` columns remain as nullable creator attribution for backward compatibility. Family ownership is now represented by `family_id`, not by the account that inserted a row.

## Migration of existing data

Startup performs an idempotent migration under a PostgreSQL advisory lock:

- each existing user without a membership receives an owner family;
- the family's name comes from the user's existing `family_name`;
- that user's existing people and relationships move into the new family;
- required indexes and foreign keys are created;
- `family_id` becomes required after the backfill succeeds.

The server waits for both base-schema and family-schema initialization before listening. A failed migration fails startup, allowing Cloud Run to reject the revision rather than serve partially migrated data.

## API

All routes use the `/api` prefix.

| Method | Endpoint | Minimum access | Purpose |
| --- | --- | --- | --- |
| GET | `/invitations/:token` | Public | Inspect a valid invitation without exposing the full email |
| POST | `/invitations/:token/accept` | Signed in | Accept an invitation for the signed-in email |
| GET | `/families` | Signed in | List accessible family trees |
| POST | `/families` | Signed in | Create a family tree owned by the user |
| POST | `/families/:id/select` | Member | Select the active family tree |
| GET | `/family/members` | Viewer | List members of the active family |
| GET | `/family/invitations` | Administrator | List pending invitations |
| POST | `/family/invitations` | Administrator | Create an invitation |
| DELETE | `/family/invitations/:id` | Administrator | Revoke an invitation |
| PATCH | `/family/members/:userId` | Administrator | Change a member role |
| DELETE | `/family/members/:userId` | Administrator | Remove a member |

Only the owner can invite, promote, demote, or remove administrators. The owner cannot be demoted or removed.

## Verification

Run the integration suite against a disposable PostgreSQL database:

```powershell
$env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:55432/lineage_test'
$env:DATABASE_SSL='false'
$env:SESSION_SECRET='local-test-secret'
npm run test:family-access
```

The test verifies owner setup, invitation acceptance, viewer restrictions, contributor writes, administrator-only tree changes, shared visibility, and isolation between two family trees.

## Security and operational notes

- Send invitation links privately; the token grants the invited email a path to membership until it expires.
- Password recovery is disabled until verified email delivery and expiring reset tokens are implemented. The former public reset-by-email behavior was unsafe.
- Production PostgreSQL uses TLS by default. Set `DATABASE_SSL=false` only for a trusted local database that does not support TLS.
- Profile image files are still written to Cloud Run's ephemeral filesystem; use Cloud Storage before relying on uploads as durable records.