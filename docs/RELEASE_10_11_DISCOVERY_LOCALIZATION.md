# Releases 10 and 11 — Discovery and East African localization

## Discovery

The protected /api/discovery surface adds family-scoped search across names, nicknames, clans, occupations, birth/residence places, and country codes. Results are privacy-serialized and never cross family boundaries. The relationship endpoint calculates common ancestors and cousin degrees, including removed relationships. Family statistics expose living-record counts and missing birth-date counts.

Cross-tree matching is deliberately not enabled by default. Any future matching workflow must require explicit family consent, a clear preview, and per-match approval.

## Localization

East African regional settings support Kenya, Uganda, Tanzania, Rwanda, Burundi, South Sudan, Ethiopia, Somalia, Djibouti, and Eritrea. Supported languages are English and Kiswahili.

Optional person fields include nickname, clan, occupation, county, constituency, country, and residence place. These fields do not infer identity, ethnicity, or community membership.
