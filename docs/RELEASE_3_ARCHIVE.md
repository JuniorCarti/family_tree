# Release 3: Family Archive and Storytelling

Release 3 turns Lineage from a visual relationship map into a private, collaborative family archive. Families can preserve dated life events, long-form memories, source links, tagged relatives, and discussion without sharing account credentials.

## What ships

### Family timeline

- A chronological view grouped by year.
- Birth, education, marriage, work, migration, milestone, death, and other event types.
- Person, type, and full-text filters.
- Exact dates, approximate years, date ranges, places, descriptions, and source citations.
- Quick access from a person's tree profile.
- JSON archive export containing only records the requesting member may view.

### Family journal

- Long-form family stories in a dedicated editorial reading experience.
- Featured-story treatment and responsive story cards.
- Optional date, place, tagged relatives, and visibility.
- Family comments with author/admin deletion controls.
- Direct navigation from a tagged relative to that person's timeline.

### Responsive archive workspace

- Shared Tree, Timeline, and Stories navigation.
- Desktop, tablet, 390px, and 320px layouts without horizontal scrolling.
- Scroll-safe event and story editors with reachable actions on short screens.
- Reduced-motion support and accessible native form controls.
- Heritage green, parchment, cream, and brass styling consistent with the existing product.

## Permissions

| Action | Viewer | Contributor | Admin | Owner |
| --- | ---: | ---: | ---: | ---: |
| Read permitted events and stories | Yes | Yes | Yes | Yes |
| Comment on a permitted story | Yes | Yes | Yes | Yes |
| Delete own comment | Yes | Yes | Yes | Yes |
| Add events and stories | No | Yes | Yes | Yes |
| Edit/delete own archive record | No | Yes | Yes | Yes |
| Edit/delete another member's archive record | No | No | Yes | Yes |
| Delete another member's comment | No | No | Yes | Yes |
| Export permitted archive records | Yes | Yes | Yes | Yes |

All endpoints require an authenticated, unlocked account and active family membership.

## Privacy behavior

Archive visibility is enforced by the API, not only by the interface.

- family: available to family members when every tagged profile is available to that member.
- contributors: contributor, admin, and owner roles only.
- admins: admin and owner roles only.
- private: creator, admin, and owner only.
- An event inherits the tagged person's privacy restrictions.
- A story is suppressed when any tagged person is not visible to the requester.
- Release 2 living-person restrictions continue to apply. A viewer cannot reveal a protected living person's details through the archive, direct story URL, overview counts, or export.
- Hidden records return 404 from direct detail routes to avoid confirming that sensitive content exists.

## API

All routes are under /api/archive.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /overview | Privacy-filtered counts and recent archive content |
| GET | /events | List visible events; supports person_id, type, and q |
| POST | /events | Create a life event |
| PUT | /events/:id | Update a manageable event |
| DELETE | /events/:id | Soft-delete a manageable event |
| GET | /stories | List visible stories; supports person_id and q |
| GET | /stories/:id | Read a visible story and its comments |
| POST | /stories | Create a tagged family story |
| PUT | /stories/:id | Update a manageable story |
| DELETE | /stories/:id | Soft-delete a manageable story |
| POST | /stories/:id/comments | Add a note to a visible story |
| DELETE | /comments/:id | Soft-delete an owned or admin-managed comment |
| GET | /export | Download a privacy-filtered JSON archive |

Client and server validation cap titles, dates, places, descriptions, story bodies, source labels, and comments. Source links accept only HTTP or HTTPS URLs.

## Database changes

Startup migration creates:

- life_events
- family_stories
- family_story_people
- family_story_comments

Records are scoped by family_id. Archive contributions retain attribution while the contributor exists and safely use ON DELETE SET NULL where account deletion removes that user. Event, story, and comment removal is soft deletion. Indexed family, person, date, and story-tag fields keep filtering practical as archives grow.

## Audit and personal data

The family audit history records archive event, story, and comment creation, updates, and deletion. Release 2 personal-data export now includes the requesting user's contributed events, stories, tagged person IDs, and comments.

## Verification

The integration suite covers:

- Viewer access to a deceased ancestor's event.
- Suppression of a protected living person's event.
- Private-profile contributor restrictions.
- Visible and hidden tagged stories.
- Story ownership and admin authorization.
- Viewer comments and comment controls.
- Privacy-filtered overview counts.
- Privacy-filtered archive export.
- Legacy account-to-family migration.

Browser QA covers Tree/Timeline/Stories switching, populated desktop views, both mobile editors, and 390px/320px overflow checks.

Run the full suite against a disposable PostgreSQL database:

    $env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:55435/lineage_test'
    $env:DATABASE_SSL='false'
    $env:SESSION_SECRET='local-test-secret'
    npm test

## Deployment checklist

1. Back up the production database.
2. Build and deploy the Express image; startup applies the additive archive migration.
3. Confirm Cloud Run is healthy and the archive overview returns an authenticated response.
4. Publish Firebase Hosting so archive.js, app.js, index.html, and style.css move together.
5. Verify one owner and one viewer account, especially living-person suppression.
6. Confirm a JSON archive export contains no records hidden from the requesting account.

## Deliberate boundaries

Release 3 stores citation links but does not yet upload archive-specific document attachments, transcribe audio interviews, import GEDCOM files, or generate print books. Those are natural candidates for later releases and should build on the same privacy checks.
