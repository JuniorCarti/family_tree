# Release 13 - Mobile, accessibility and offline readiness

Release 13 adds an installable Progressive Web App foundation and safer family-tree reading on small or unreliable connections.

## Included

- Installable app manifest and browser install prompt.
- Service-worker shell caching for offline launch and cached /api/tree read access.
- Offline read-only banner; non-GET API actions queue locally and replay when connectivity returns.
- Reduced motion, visible keyboard focus, Escape-to-close modals and larger touch targets.
- High contrast and font scale controls through LineageAccessibility.
- Autosaved person-form drafts, cleared after successful submit.

## Offline safety

Offline data is a cached snapshot and may be stale. Mutations require an authenticated online session to complete.
