# Release 1: Trust Foundation

This release protects account access and makes uploaded family media durable in Cloud Run.

## Included

- Single-use email-verification links that expire after 24 hours.
- Non-enumerating password-reset requests with one-hour, single-use tokens.
- Password resets invalidate every existing database-backed session.
- Session IDs rotate after successful login.
- Rate limiting on signup, login, verification, and recovery endpoints.
- Helmet security headers and same-site session cookies.
- Private media assets scoped to the active family.
- Google Cloud Storage in production and a local-disk fallback for development.
- Immutable audit records for person, relationship, family-name, merge, and media mutations.
- A family audit API at GET /api/family/audit.

Email verification and account payment approval are independent gates. A new account must verify its email and still complete the existing KES 500 approval process.

## Required production configuration

Set these Cloud Run environment variables:

    PUBLIC_APP_URL=https://family-tree-a4c4f.web.app
    SMTP_HOST=your-smtp-host
    SMTP_PORT=587
    SMTP_SECURE=false
    SMTP_USER=your-smtp-user
    SMTP_PASSWORD=your-smtp-password
    EMAIL_FROM=Lineage <no-reply@your-domain>
    MEDIA_BUCKET=family-tree-a4c4f-media

Keep SMTP_PASSWORD and SESSION_SECRET in Secret Manager. The production server now refuses to start when SESSION_SECRET is absent or shorter than 32 characters.

The configured project uses these Secret Manager names:

- lineage-database-url
- lineage-session-secret
- lineage-smtp-password

Cloud Run reads DATABASE_URL and SESSION_SECRET from pinned secret version 1. Add SMTP_PASSWORD only after lineage-smtp-password has an enabled version.

## Cloud Storage setup

Create a regional bucket in the same region as Cloud Run. Do not make the bucket public. Give the Cloud Run runtime service account permission to create and read objects in only this bucket.

Example commands:

    gcloud storage buckets create gs://family-tree-a4c4f-media --location=us-central1 --uniform-bucket-level-access --public-access-prevention
    gcloud storage buckets add-iam-policy-binding gs://family-tree-a4c4f-media --member=serviceAccount:CLOUD_RUN_SERVICE_ACCOUNT --role=roles/storage.objectUser

Uploaded objects are served through authenticated /api/media/:id requests. The database checks active-family membership before any object is streamed.

If MEDIA_BUCKET is missing, media is written under public/uploads. That fallback is intended only for local development because Cloud Run filesystems are ephemeral.

## Email behavior

The application uses SMTP through Nodemailer. When SMTP is missing, signup still creates an account and a verification token, but no email can be delivered. Configure and test SMTP before deploying this release or accepting new registrations.

All password-reset request responses are deliberately identical whether an email exists or not.

## Database changes

Startup migrations add:

- users.email_verified_at
- auth_tokens
- audit_logs
- media_assets

Existing users are grandfathered as email-verified. New users receive a null verification timestamp until they use a valid token. The existing M-Pesa approval and family-membership tables are unchanged.

## Verification

Run:

    npm test
    node --check server.js
    node --check public/app.js

The integration suite covers:

- unverified account rejection;
- one-time email verification;
- payment approval after verification;
- family role enforcement;
- audit creation;
- non-enumerating reset requests;
- reset-token one-time consumption;
- old-password rejection and new-password login;
- legacy family migration.

## Rollout checklist

1. Create the private storage bucket and grant the runtime service account access.
2. Configure SMTP and send a verification email in staging.
3. Put SMTP credentials and the session secret in Secret Manager.
4. Deploy a new Cloud Run revision without shifting all traffic.
5. Test signup, verification, payment submission, approval, login, photo upload, and password reset.
6. Confirm /api/family/audit records the test changes.
7. Shift production traffic and monitor email errors, HTTP 429 responses, media errors, and database migration logs.

## Not yet included

This release does not claim to provide MFA, passkeys, backup automation, malware scanning, soft deletion, or undo/restore. Those remain planned trust and privacy work and should not be represented as complete.
