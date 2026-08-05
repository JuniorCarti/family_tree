# Lineage Family Tree

Lineage is a full-stack family tree application for creating people, connecting family relationships, and exploring a generated multi-generation chart.

## Live application

- Firebase Hosting: https://family-tree-a4c4f.web.app
- Cloud Run API: https://lineage-api-662162914072.us-central1.run.app
- Google Cloud project: `family-tree-a4c4f`

## Features

- Email and family-name authentication
- Separate family data for each user
- Parent, spouse, sibling, grandparent, grandchild, cousin, and custom relationships
- Interactive SVG family-tree layout with search, pan, and zoom
- Person creation, editing, deletion, photo upload, duplicate detection, and merging
- Excel export
- PostgreSQL-backed sessions suitable for multiple Cloud Run instances

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, and browser JavaScript |
| Backend | Node.js 20 and Express |
| Database | PostgreSQL using `pg` |
| Sessions | `express-session` with `connect-pg-simple` |
| Container | Docker |
| API hosting | Google Cloud Run |
| Static hosting | Firebase Hosting |

## Local setup

### Requirements

- Node.js 20 or newer
- npm
- A PostgreSQL database

### Installation

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `.env` in the repository root:

   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
   SESSION_SECRET=replace_with_a_long_random_secret
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Open http://localhost:4000.

The application creates or verifies its PostgreSQL tables during startup. The `.env` file is ignored by Git and must never be committed.

## Application architecture

```text
Browser
  |
  | static files and /api/**
  v
Firebase Hosting
  |                 |
  | static assets   | /api/** rewrite
  v                 v
public/          Cloud Run: lineage-api
                     |
                     +-- PostgreSQL application data
                     +-- PostgreSQL session table
```

Firebase Hosting forwards `/api/**` to the `lineage-api` Cloud Run service in `us-central1`. Express uses Firebase's reserved `__session` cookie name, trusts the hosting proxy, and stores session records in PostgreSQL.

## API overview

All endpoints use the `/api` prefix.

| Method | Endpoint | Purpose | Authentication |
| --- | --- | --- | --- |
| GET | `/api/auth/me` | Return the current user | Session |
| POST | `/api/auth/signup` | Create an account | Public |
| POST | `/api/auth/login` | Sign in | Public |
| POST | `/api/auth/logout` | End the session | Session |
| POST | `/api/auth/reset-password` | Reset a password | Public |
| GET/POST | `/api/persons` | List or create people | Required |
| GET/PUT/DELETE | `/api/persons/:id` | Read, edit, or delete a person | Required |
| GET/POST | `/api/relationships` | List or create relationships | Required |
| DELETE | `/api/relationships/:id` | Delete a relationship | Required |
| GET/PUT | `/api/tree` | Load or rename a family tree | Required |
| POST | `/api/upload` | Upload a profile image | Required by UI flow |
| GET | `/api/export/excel` | Export family data | Required |
| GET | `/api/duplicates` | Find duplicate people | Required |
| POST | `/api/merge` | Merge duplicate people | Required |

## Deployment

See [README.deploy.md](README.deploy.md) for the complete Cloud Run and Firebase Hosting procedure, environment configuration, verification commands, rollback guidance, and troubleshooting.

## Repository structure

```text
.
|-- public/                Browser application
|   |-- index.html
|   |-- style.css
|   `-- app.js
|-- db.js                  PostgreSQL pool and schema initialization
|-- server.js              Express server and API routes
|-- Dockerfile             Cloud Run container image
|-- firebase.json          Hosting and /api rewrite configuration
|-- package.json           Runtime dependencies and scripts
|-- README.deploy.md       Deployment and operations guide
`-- CONTRIBUTING.md        Branch and pull-request workflow
```

## Operational limitations

- Uploaded images are written to the container filesystem. Cloud Run storage is ephemeral, so production uploads should move to Cloud Storage.
- The Express API currently contains most routes in one file. Splitting routes and services would improve maintainability as the project grows.
- Password reset currently accepts an identifier and a new password directly. A production system should use expiring, single-use reset tokens delivered through a verified channel.

## Contributing

Use a feature branch and open a pull request rather than committing directly to `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).