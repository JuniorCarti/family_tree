# Release 8  Collaboration workroom

Release 8 adds a family workroom for careful, attributable collaboration.

- Contributors submit proposed person or event edits with a base snapshot.
- Administrators review, approve, reject, or identify conflicts before changes are applied.
- Every approved proposal is written to the existing audit log.
- Members can comment on people, events, relationships, stories, and documents; `@email` mentions are retained with the comment.
- Research tasks support descriptions, assignees, due dates, and completion status.
- Family activity records scans, proposals, reviews, comments, and tasks.
- In-app notifications are generated for new proposals and announcements.
- Administrators can publish pinned or expiring family announcements.
- Existing family roles remain separate from platform/superadmin billing access.
- Existing invitations already support expiry, acceptance, and revocation; the family member list remains the authority for role changes.

## API

Collaboration routes are available under `/api/collaboration` (the same handlers are also mounted under `/api/quality` for the review surface):

- `GET /overview`, `/proposals`, `/comments`, `/tasks`, `/notifications`, `/activity`, `/announcements`
- `POST /proposals`, `/comments`, `/tasks`, `/announcements`
- `PATCH /proposals/:id/review`, `/tasks/:id`, `/notifications/:id/read`

The UI is intentionally review-first: records are never silently replaced when a concurrent edit changes the proposal base data.
