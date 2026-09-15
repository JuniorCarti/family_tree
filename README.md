# Lineage Family Tree

Lineage is a full-stack family tree application for building shared, multi-generation family records. Every relative uses their own account and receives role-based access through an invitation; nobody needs to share the tree creator's password.

## Live application

- Firebase Hosting: https://family-tree-a4c4f.web.app
- Firebase Functions API (2nd gen), routed through Hosting at `/api/**`
- Google Cloud project: `family-tree-a4c4f`

## Features

- Individual email accounts with Firebase Authentication and verified ID tokens
- Verified email addresses and expiring, single-use password recovery links
- KES 500 manual M-Pesa unlock with platform-superadmin approval for new signups
- Sign-in and pre-approval product guide with payment safety, feature previews, searchable FAQs, and support guidance
- Shared family trees with invitation links and role-based access
- Viewer, contributor, administrator, and owner permissions
- Multiple family trees per account with an active-tree selector
- Parent, spouse, sibling, grandparent, grandchild, cousin, and custom relationships
- Eight tree exploration modes: family, pedigree, descendants, fan, hourglass, compact list, relationship path, and places map
- Focus and generation controls, branch collapse, minimap, touch navigation, fullscreen presentation, and large-tree viewport virtualization
- Print-ready PDF, high-resolution PNG, print styling, and expiring privacy-filtered presentation links
- Person editing, private Cloud Storage media, audit history, duplicate detection, merging, and Excel export
- Living-person protection, per-profile visibility, safe private placeholders, and privacy-aware exports
- Recycle-bin restore plus personal account-data export and confirmed account deletion
- Privacy-aware life-event timelines, source citations, family stories, tagged relatives, and comments
- Family archive JSON export filtered to the requesting member's permissions
- Automatic migration of existing account-owned trees into shared families

See [Family Access and Sharing](docs/FAMILY_ACCESS.md) for family roles and invitations. See [Account Unlock and Superadmin Approval](docs/ACCOUNT_APPROVAL.md) for the KES 500 M-Pesa workflow. Release details are documented in [Release 1: Trust Foundation](docs/RELEASE_1_TRUST.md), [Release 2: Privacy and Data Control](docs/RELEASE_2_PRIVACY.md), and [Release 3: Family Archive and Storytelling](docs/RELEASE_3_ARCHIVE.md).

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, and browser JavaScript |
| Backend | Firebase Functions 2nd gen, Express, Firebase Admin SDK |
| Database | Cloud Firestore |
| Authentication | Firebase Authentication and verified ID tokens |
| Media | Cloud Storage for Firebase |
| API hosting | Firebase Hosting rewrite to Functions |
| Static hosting | Firebase Hosting |

## Local setup

### Requirements

- Node.js 20 or newer
- npm
- Firebase CLI and (for local development) the Emulator Suite

### Installation

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Select the Firebase project and install Functions dependencies:

   ```bash
   firebase use family-tree-a4c4f
   cd functions && npm install && cd ..
   ```

3. Start the application:

   ```bash
   npm start
   ```

4. Open http://localhost:4000.

For local Firebase-only development, run `firebase emulators:start` and use the Functions/Auth/Firestore/Storage emulators. No database URL or session secret is required by the Firebase runtime.

## Architecture

```text
Browser
  |
  v
Firebase Hosting
  |-- static files ------> public/
  `-- /api/** -----------> Firebase Functions 2nd gen
                                 |
                                 +-- Firebase Auth ID-token verification
                                 +-- Firestore trees, members, people, relationships
                                 `-- Cloud Storage private media
```

See [Firebase Native Architecture](docs/FIREBASE_NATIVE_ARCHITECTURE.md) and [Firebase Migration Report](docs/FIREBASE_NATIVE_MIGRATION_REPORT.md) for the migration status. The legacy PostgreSQL server remains in the repository only as historical audit material until feature parity and controlled cutover are complete.

## Main API groups

| Prefix | Purpose |
| --- | --- |
| `/api/auth` | Signup, verification, login, logout, recovery, and current account context |
| `/api/account` | Lock status, payment submission, data export, and account deletion |
| `/api/superadmin` | Manual payment review and platform account approval |
| `/api/families` | List, create, and select family trees |
| `/api/family` | Members, invitations, role and ownership administration, and audit history |
| `/api/media` | Authenticated active-family media delivery |
| `/api/persons` | People in the active family |
| `/api/relationships` | Relationships in the active family |
| `/api/tree` | Shared tree payload and administrator rename |
| `/api/duplicates`, `/api/merge` | Duplicate review and contributor merge |
| `/api/export` | Active-family Excel export |
| `/api/recycle-bin` | Administrator restore and owner permanent deletion |
| `/api/archive` | Privacy-aware timeline events, stories, comments, overview, and JSON export |
| `/api/exploration` | Focused branch slices, chart PDFs, and administrator-controlled presentation links |
| `/api/shared-tree` | Rate-limited, expiring, read-only private presentations |

Detailed family endpoints and permissions are in [docs/FAMILY_ACCESS.md](docs/FAMILY_ACCESS.md).

## Testing

The Firebase Functions smoke test is independent of PostgreSQL:

```powershell
cd functions
npm test
```

The legacy family-access integration test remains quarantined until its Firebase repository replacement is complete. It must not be pointed at production data.

## Deployment and collaboration

- [Deployment guide](README.deploy.md)
- [Contribution workflow](CONTRIBUTING.md)
- [Family access design and operations](docs/FAMILY_ACCESS.md)
- [Account unlock and superadmin approval](docs/ACCOUNT_APPROVAL.md)
- [Trust foundation release and rollout](docs/RELEASE_1_TRUST.md)
- [Privacy and data control release](docs/RELEASE_2_PRIVACY.md)
- [Family archive and storytelling release](docs/RELEASE_3_ARCHIVE.md)
- [Mobile tree and scale release](docs/RELEASE_6_MOBILE_SCALE.md)
- [Complete tree exploration release](docs/RELEASE_6_EXPLORATION.md)

Use a feature branch and pull request rather than committing directly to `main`.

## Current limitations

- MFA, passkeys, automated backups, and automated recycle-bin expiry are not implemented yet.
- SMTP and the private media bucket must remain configured in each deployed environment.
- The Express API remains mostly monolithic; route/service separation would improve maintainability as it grows.
- Archive citations are links in Release 3; document attachments, audio interviews, GEDCOM import, and print-book generation are not implemented yet.
- Place mapping requires deliberate event coordinates; automatic third-party geocoding is not enabled.
