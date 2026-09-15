# Release 5 — GEDCOM 7 interoperability

The app now provides a review-first GEDCOM workflow:

1. Choose a `.ged` file or GEDZip archive in the Evidence workspace.
2. Preview people, families, sources, media entries, warnings, and likely duplicate people.
3. Confirm the import. Records are written in one transaction, so a failed import does not leave a partial tree.
4. Export the current family as UTF-8 GEDCOM 7.

Endpoints:

- `GET /api/gedcom/export`
- `POST /api/gedcom/preview` (multipart field `file`)
- `POST /api/gedcom/import/:preview_id`

The importer accepts common GEDCOM 7 records (`INDI`, `FAM`, `SOUR`, `REPO`, `OBJE`, and `NOTE`) and preserves source records in the preview/export path. GEDZip media entries are identified and reported during preview; the tree records are imported first so media can be reviewed and attached deliberately.

The format follows the [FamilySearch GEDCOM 7 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html). Unknown tags are ignored with a warning rather than blocking a family’s data transfer.
