# Lineage Family Tree

Lineage is a full-stack family tree application for building shared, multi-generation family records. Every relative uses their own account and receives role-based access through an invitation; nobody needs to share the tree creator's password.

## Live application

- Firebase Hosting: https://family-tree-a4c4f.web.app
- Cloud Run API: https://lineage-api-662162914072.us-central1.run.app
- Google Cloud project: `family-tree-a4c4f`

## Features

- Individual email accounts with PostgreSQL-backed sessions
- Shared family trees with invitation links and role-based access
- Viewer, contributor, administrator, and owner permissions
- Multiple family trees per account with an active-tree selector
- Parent, spouse, sibling, grandparent, grandchild, cousin, and custom relationships
- Interactive SVG layout with search, pan, and zoom
- Person editing, photo upload, duplicate detection, merging, and Excel export
- Automatic migration of existing account-owned trees into shared families

See [Family Access and Sharing](docs/FAMILY_ACCESS.md) for the joining flow, role matrix, API, migration details, and security notes.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, and browser JavaScript |
| Backend | Node.js 20 and Express |
| Database | PostgreSQL using `pg` |
| Sessions | `express-session` with `connect-pg-simple` |
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
                                 +-- people and relationships by family_id
```

Firebase preserves the `__session` cookie for rewritten `/api/**` requests. Express trusts the hosting proxy and keeps session records in PostgreSQL so authentication survives Cloud Run instance changes.

## Main API groups

| Prefix | Purpose |
| --- | --- |
| `/api/auth` | Signup, login, logout, and current account context |
| `/api/families` | List, create, and select family trees |
| `/api/family` | Members, invitations, and role administration |
| `/api/persons` | People in the active family |
| `/api/relationships` | Relationships in the active family |
| `/api/tree` | Shared tree payload and administrator rename |
| `/api/duplicates`, `/api/merge` | Duplicate review and contributor merge |
| `/api/export` | Active-family Excel export |

Detailed family endpoints and permissions are in [docs/FAMILY_ACCESS.md](docs/FAMILY_ACCESS.md).

## Testing

The family-access integration test requires a disposable PostgreSQL database:

```powershell
$env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:55432/lineage_test'
$env:DATABASE_SSL='false'
$env:SESSION_SECRET='local-test-secret'
npm run test:family-access
```

## Deployment and collaboration

- [Deployment guide](README.deploy.md)
- [Contribution workflow](CONTRIBUTING.md)
- [Family access design and operations](docs/FAMILY_ACCESS.md)

Use a feature branch and pull request rather than committing directly to `main`.

## Current limitations

- Password recovery is intentionally unavailable until verified email delivery and expiring, single-use reset tokens are implemented.
- Profile uploads use Cloud Run's ephemeral filesystem and should move to Cloud Storage for durable production use.
- The Express API remains mostly monolithic; route/service separation would improve maintainability as it grows.