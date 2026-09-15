# Release 9 — Memories and storytelling

Release 9 turns the family tree into a private memory house.

## Included

- Photo, video, audio, document, and story memory items.
- Captions, dates, places, photographer/speaker attribution, transcripts, and translations.
- Tag multiple people in a memory.
- Curated albums with descriptions and cover-ready presentation.
- Recipe archive with origin, contributor, story, ingredients, and instructions.
- Memorial records for people whose lives should remain visible to the family.
- Calendar data for birthdays, death anniversaries, and “On this day” cards.
- Slideshow presentation mode and a print-ready family memory book.
- Private family visibility controls for every memory.
- QR-code PNG downloads that open a responsive public memory page. The QR target exposes only the explicitly shared memory and its token-protected media.

## API

- `GET /api/memories/overview`
- `GET/POST /api/memories/items`
- `PATCH/DELETE /api/memories/items/:id`
- `GET/POST /api/memories/albums`
- `GET/POST /api/memories/recipes`
- `GET/POST /api/memories/memorials`
- `GET /api/memories/calendar`
- `POST /api/memories/items/:id/qr`
- `GET /memory/:token` and token-protected public media routes

Media uses the existing private local/Cloud Storage abstraction. Audio transcription is supported through transcript fields now; an external transcription provider can be added later without changing the memory data model.
