# Release 2: Privacy and Data Control

Release 2 adds server-enforced privacy for family profiles, recoverable deletion, and account data controls. The browser never decides whether sensitive data may be returned; every API path uses the same privacy policy.

## Profile privacy

Each person has two controls:

| Control | Values | Meaning |
| --- | --- | --- |
| Life status | Living, deceased, unknown | Living profiles receive extra protection for viewers. |
| Visibility | Family, contributors, admins, private | Sets the minimum family role that can receive full details. Private means the profile creator only. |

The profile creator can always view and edit the profile. Editing still requires contributor access or higher.

### What viewers see

- A viewer may see the full record of a deceased or unknown person when visibility is `family`.
- For a living person, viewers receive the name and birth year, but not the exact birth date, photo, birthplace, maiden name, or notes.
- When visibility is above the viewer's role, the tree retains a safe **Private relative** placeholder so family relationships and layout remain understandable.
- Private media returns `404` to avoid confirming that a protected file exists.

These rules apply to:

- Person lists and direct person endpoints
- Full tree payloads
- Relationships involving deleted profiles
- Duplicate detection and merge authorization
- Excel exports
- Private Cloud Storage media
- Legacy `/uploads` media

## Recycle bin

Deleting a person now soft-deletes the profile. The active tree and relationship APIs immediately exclude it, while the database keeps the profile and its relationships.

- Contributors can delete profiles they are allowed to edit.
- Administrators and owners can view the recycle bin and restore profiles.
- Owners can permanently delete a recycled profile.
- Delete and restore actions are written to the family audit log.
- The UI displays a 30-day recovery date. Permanent expiry cleanup is intentionally not automated in this release; an owner must explicitly delete forever.

## Account data

The **Privacy & account** screen provides:

- A JSON download containing the signed-in user's account, family memberships, payment history, and records they contributed.
- Permanent account deletion protected by the current password and the exact phrase `DELETE MY ACCOUNT`.

Account deletion preserves records contributed to shared families by removing the creator reference rather than deleting those family records. An owner cannot delete their account while an owned family has other members; ownership must be transferred first. The platform superadmin account cannot be deleted from this screen.

Family owners can use **Make owner** beside an existing member in Family access. The new owner receives the owner role and the previous owner becomes an administrator.

## API additions

| Method and path | Minimum access | Purpose |
| --- | --- | --- |
| `GET /api/recycle-bin/persons` | Administrator | List soft-deleted profiles |
| `POST /api/recycle-bin/persons/:id/restore` | Administrator | Restore a profile |
| `DELETE /api/recycle-bin/persons/:id` | Owner | Permanently delete a profile |
| `GET /api/account/data-export` | Approved account | Download personal account data |
| `DELETE /api/account` | Approved account | Permanently delete the signed-in account |
| `PATCH /api/family/owner` | Owner | Transfer ownership to an existing member |

Person create and update payloads now accept:

```json
{
  "life_status": "living",
  "visibility": "family"
}
```

Existing records migrate to `unknown` and `family`. New profiles created in the UI default to `living` and `family`.

## Verification

Run against a disposable PostgreSQL database:

```powershell
$env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:55432/lineage_test'
$env:DATABASE_SSL='false'
npm test
```

The integration suite verifies living-person redaction, private placeholders, edit denial, media denial, soft delete, restore, personal-data export, account deletion, and preservation of shared records.
