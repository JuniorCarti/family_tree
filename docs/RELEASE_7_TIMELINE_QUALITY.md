# Release 7  Timeline and data quality

Release 7 adds a review queue for chronology and completeness issues. Family members with contributor access can run a scan from **Quality** and mark findings fixed, accepted, or dismissed.

The scanner checks parent/child chronology, unusual parent ages, marriage before birth, marriage after death, childbirth after a parents death, events after death, duplicate spouse links, overlapping same-year events, missing birth dates, missing birth places, missing parents, and inconsistent place formatting. Findings are suggestions only; no family fact is overwritten automatically.

Each finding keeps its subject and related record IDs so a future review action can link directly to the person, relationship, or event. Place normalization produces a suggested value for human approval.

## API

- `POST /api/quality/scan`
- `GET /api/quality/findings?status=open|all|fixed|dismissed`
- `PATCH /api/quality/findings/:id`

The timeline remains the source of truth for events. Data-quality findings are a review layer over existing records.
