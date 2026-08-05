# Lineage Family Tree

Lineage is a full-stack family tree application for building shared, multi-generation family records. Every relative uses their own account and receives role-based access through an invitation; nobody needs to share the tree creator's password.

## Live application

- Firebase Hosting: https://family-tree-a4c4f.web.app
- Cloud Run API: https://lineage-api-662162914072.us-central1.run.app
- Google Cloud project: `family-tree-a4c4f`

## Features

- Individual email accounts with PostgreSQL-backed sessions
- Verified email addresses and expiring, single-use password recovery links
- KES 500 manual M-Pesa unlock with platform-superadmin approval for new signups
- Sign-in and pre-approval product guide with payment safety, feature previews, searchable FAQs, and support guidance
- Shared family trees with invitation links and role-based access
- Viewer, contributor, administrator, and owner permissions
- Multiple family trees per account with an active-tree selector
- Parent, spouse, sibling, grandparent, grandchild, cousin, and custom relationships
- Interactive SVG layout with search, pan, and zoom
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
| Backend | Node.js 20 and Express |
| Database | PostgreSQL using `pg` |
| Sessions | `express-session` with `connect-pg-simple` |
| Media | Private Google Cloud Storage objects |
| API hosting | Google Cloud Run |
| Static hosting | Firebase Hosting |

## Local setup

### Requirements

- Node.js 20 or newer
- npm
- PostgreSQL

### Installation

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set at least:

   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
   SESSION_SECRET=replace_with_a_long_random_secret
   ```

   For a trusted local PostgreSQL server without TLS, also set `DATABASE_SSL=false`. Production connections use TLS by default.

3. Start the application:

   ```bash
   npm start
   ```

4. Open http://localhost:4000.

Startup creates or migrates the PostgreSQL schema before the HTTP listener starts. `.env` is ignored by Git and must never be committed.

## Architecture

```text
Browser
  |
  v
Firebase Hosting
  |-- static files ------> public/
  `-- /api/** -----------> Cloud Run: lineage-api
                                 |
                                 +-- Express sessions
                                 +-- users
                                 +-- families
                                 +-- memberships and invitations
                                 +-- payment submissions and account approvals
                                 +-- people and relationships by family_id
```

Firebase preserves the `__session` cookie for rewritten `/api/**` requests. Express trusts the hosting proxy and keeps session records in PostgreSQL so authentication survives Cloud Run instance changes.

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

Detailed family endpoints and permissions are in [docs/FAMILY_ACCESS.md](docs/FAMILY_ACCESS.md).

## Testing

The family-access integration test requires a disposable PostgreSQL database:

```powershell
$env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:55432/lineage_test'
$env:DATABASE_SSL='false'
$env:SESSION_SECRET='local-test-secret'
npm test
```

## Deployment and collaboration

- [Deployment guide](README.deploy.md)
- [Contribution workflow](CONTRIBUTING.md)
- [Family access design and operations](docs/FAMILY_ACCESS.md)
- [Account unlock and superadmin approval](docs/ACCOUNT_APPROVAL.md)
- [Trust foundation release and rollout](docs/RELEASE_1_TRUST.md)
- [Privacy and data control release](docs/RELEASE_2_PRIVACY.md)
- [Family archive and storytelling release](docs/RELEASE_3_ARCHIVE.md)

Use a feature branch and pull request rather than committing directly to `main`.

## Current limitations

- MFA, passkeys, automated backups, and automated recycle-bin expiry are not implemented yet.
- SMTP and the private media bucket must remain configured in each deployed environment.
- The Express API remains mostly monolithic; route/service separation would improve maintainability as it grows.
- Archive citations are links in Release 3; document attachments, audio interviews, GEDCOM import, and print-book generation are not implemented yet.
