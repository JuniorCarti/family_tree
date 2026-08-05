# Cloud Run and Firebase Hosting Deployment

This guide deploys the Express API to Google Cloud Run and the static browser application to Firebase Hosting. Firebase forwards `/api/**` requests to Cloud Run.

## Production resources

| Resource | Value |
| --- | --- |
| Google Cloud project | `family-tree-a4c4f` |
| Cloud Run service | `lineage-api` |
| Cloud Run region | `us-central1` |
| Container image | `gcr.io/family-tree-a4c4f/lineage-api` |
| Firebase Hosting site | `family-tree-a4c4f` |
| Public site | https://family-tree-a4c4f.web.app |

## Architecture and authentication

```text
Firebase Hosting
  |-- /, /app.js, /style.css --> public/
  `-- /api/**               --> Cloud Run lineage-api
                                      |
                                      `--> PostgreSQL
                                           |-- users and family data
                                           `-- session table
```

Authentication depends on three production settings in `server.js`:

1. Express trusts the Firebase/Cloud Run proxy so secure cookies can be issued.
2. The session cookie is named `__session`, the cookie name Firebase Hosting preserves for rewritten requests.
3. Sessions are stored in PostgreSQL with `connect-pg-simple`, so they survive instance changes and restarts.

Changing any of these settings can cause a successful login to be followed immediately by `401 Unauthorized` responses.

## Prerequisites

Install and authenticate these tools:

- Google Cloud CLI (`gcloud`)
- Firebase CLI (`firebase`)
- Docker Desktop when using the local-build workflow

Confirm access:

```bash
gcloud auth login
gcloud config set project family-tree-a4c4f
firebase login
firebase use family-tree-a4c4f
```

The Google account must be allowed to deploy Cloud Run, push images, and publish Firebase Hosting. Billing must be enabled for the Google Cloud project.

## Required environment variables

Create a local `.env` file. It is ignored by Git.

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
SESSION_SECRET=replace_with_a_long_random_secret
# DATABASE_SSL=false # local PostgreSQL only; omit in production
```

- `DATABASE_URL` must be reachable from Cloud Run.
- `SESSION_SECRET` should be long, random, and stable across deployments. Changing it invalidates existing sessions.
- Never commit `.env` or paste secret values into documentation.
- PostgreSQL TLS is enabled by default. Use `DATABASE_SSL=false` only for a trusted local database without TLS.

For a mature production environment, store these values in Google Secret Manager and bind them to Cloud Run instead of passing them on the command line.

## One-time Google Cloud setup

Enable the required services:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com
```

## Build the container

### Option A: Cloud Build

```bash
gcloud builds submit \
  --tag gcr.io/family-tree-a4c4f/lineage-api \
  --project family-tree-a4c4f \
  .
```

### Option B: Local Docker build

Use this when Cloud Build is unavailable but Docker and registry access work:

```bash
gcloud auth configure-docker gcr.io --quiet
docker build -t gcr.io/family-tree-a4c4f/lineage-api .
docker push gcr.io/family-tree-a4c4f/lineage-api
```

## Deploy Cloud Run

The following PowerShell example loads values from `.env` without printing them:

```powershell
$deployEnv = Get-Content -LiteralPath '.env' | ConvertFrom-StringData

gcloud run deploy lineage-api `
  --image gcr.io/family-tree-a4c4f/lineage-api:latest `
  --region us-central1 `
  --platform managed `
  --allow-unauthenticated `
  --set-env-vars "NODE_ENV=production,DATABASE_URL=$($deployEnv.DATABASE_URL),SESSION_SECRET=$($deployEnv.SESSION_SECRET)" `
  --project family-tree-a4c4f
```

A successful deployment reports a new revision serving 100 percent of traffic.

## Shared-family migration

The first revision containing family sharing performs an automatic, idempotent PostgreSQL migration before it starts listening:

1. Create `families`, `family_memberships`, and `family_invitations`.
2. Create an owner family for each existing account.
3. Backfill existing people and relationships with that family's ID.
4. Add family indexes and enforce required family ownership.

The migration is serialized with a PostgreSQL advisory lock, so multiple Cloud Run instances cannot run it concurrently. If any step fails, startup fails and Cloud Run will not send traffic to that revision.

Before the first production rollout:

- take a PostgreSQL backup or verify that a recent recoverable backup exists;
- confirm the database user can run `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX`;
- keep the previous Cloud Run revision available until verification finishes;
- inspect revision logs for `Database initialized successfully` and no family-sharing migration error.

Existing users remain owners of their existing data. No relative receives access until an owner or administrator creates an invitation.
## Deploy Firebase Hosting

The Cloud Run service must exist before Firebase validates the rewrite in `firebase.json`.

```bash
firebase use family-tree-a4c4f
firebase deploy --only hosting --project family-tree-a4c4f
```

Expected hosting URL:

```text
https://family-tree-a4c4f.web.app
```

A backend-only Cloud Run update does not require republishing unchanged static Hosting files.

## Verify the deployment

### Basic availability

```powershell
Invoke-WebRequest -Uri 'https://lineage-api-662162914072.us-central1.run.app/' -UseBasicParsing
Invoke-WebRequest -Uri 'https://family-tree-a4c4f.web.app/' -UseBasicParsing
```

Both should return HTTP `200`.

### Family-access verification

After signing in as an existing account:

1. Confirm its existing people are visible and its role badge says `owner`.
2. Open **Family access**, invite a temporary second email as `viewer`, and open the link in a private browser session.
3. Confirm the viewer sees the shared tree but cannot add, edit, delete, merge, or rename.
4. Promote that account to `contributor` and confirm it can add a person.
5. Remove the temporary member and verify access is denied on the next request.

The automated equivalent is documented in [docs/FAMILY_ACCESS.md](docs/FAMILY_ACCESS.md).
### Authentication verification

Use the hosted site, sign in, and inspect the browser's Application/Storage tab:

- Cookie name: `__session`
- Secure: enabled
- HTTP-only: enabled
- Host: `family-tree-a4c4f.web.app`

Expected request sequence:

| Request | Expected result |
| --- | --- |
| `GET /api/auth/me` before login | `401` |
| `POST /api/auth/login` with valid credentials | `200` and `Set-Cookie: __session=...` |
| `GET /api/auth/me` after login | `200` |
| `GET /api/tree` after login | `200` |

## Troubleshooting

### Login appears briefly, then returns to the login screen

Check all of the following:

- Session cookie is named `__session`, not `connect.sid`.
- `app.set('trust proxy', 1)` is configured before session middleware.
- `connect-pg-simple` is configured with the shared PostgreSQL pool.
- `SESSION_SECRET` is present and unchanged.
- The PostgreSQL user can create and use the session table.

### `/api/auth/me` returns 401 before login

This is expected. The frontend uses this request to determine whether it should display the authentication screen.

### Signup returns 409

The email already exists. Switch the form to Sign In or use the password-reset flow.

### Firebase deployment says the Cloud Run service does not exist

Deploy `lineage-api` in `us-central1` first. The service name and region must match `firebase.json` exactly.

### Container fails to listen on port 8080

Read the revision logs:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="lineage-api"' \
  --project family-tree-a4c4f \
  --limit 50
```

Cloud Run supplies `PORT=8080`; the server already reads `process.env.PORT`.

### `/favicon.ico` returns 404

This is harmless unless a favicon is required. Add a favicon under `public/` and reference it from `public/index.html` to remove the warning.

## Rollback

List revisions:

```bash
gcloud run revisions list \
  --service lineage-api \
  --region us-central1 \
  --project family-tree-a4c4f
```

Move traffic to a known-good revision:

```bash
gcloud run services update-traffic lineage-api \
  --to-revisions REVISION_NAME=100 \
  --region us-central1 \
  --project family-tree-a4c4f
```

Firebase Hosting releases can be reviewed and rolled back from the Firebase console.

## Known production limitation

Profile images are currently written under `public/uploads` inside the Cloud Run container. That filesystem is ephemeral. Move production uploads to Cloud Storage before treating them as durable user data.