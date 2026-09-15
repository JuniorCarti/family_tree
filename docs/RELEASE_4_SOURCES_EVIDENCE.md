# Release 4 — Sources and evidence

Release 4 adds an evidence layer without replacing the existing family facts.

## What is stored

- A source record describes a certificate, census, school/church/land record, newspaper, photograph, interview, archive, or other repository item.
- A citation attaches a source to a person, relationship, life event, or story.
- Citations retain page numbers, record identifiers, citation text, transcription, translation, confidence (`confirmed`, `probable`, `uncertain`, or `disputed`), conflict groups, and research notes.
- Original scans and photographs can be uploaded as private evidence media. Access follows the subject’s family privacy rules.

Claims are append-only from the perspective of the family fact: adding a second birth date creates another claim and never silently overwrites the person record.

## API

- `GET /api/evidence/sources?q=` — source library
- `POST /api/evidence/sources` — create a source
- `GET /api/evidence/citations?subject_type=person&subject_id=123` — attached evidence
- `POST /api/evidence/citations` — attach a claim
- `POST /api/evidence/citations/:id/media` — attach a private scan/photo/PDF

Contributor access is required for writes. Family membership and existing privacy serialization are required for reads.
