# Firebase / Cloud Run deployment

This deployment keeps the existing PostgreSQL database where it is. The
Express application runs on Cloud Run and Firebase Hosting serves the static
frontend while forwarding `/api/**` requests to Cloud Run.

## 1. Build and deploy the API

From the repository root:

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/lineage-api
gcloud run deploy lineage-api \
  --image gcr.io/PROJECT_ID/lineage-api \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-env-vars DATABASE_URL="YOUR_RENDER_POSTGRES_URL" \
  --set-env-vars SESSION_SECRET="YOUR_LONG_RANDOM_SECRET"
```

Replace `PROJECT_ID` and the two secret values. Prefer Secret Manager for
production secrets instead of putting them directly in shell history.

## 2. Deploy Firebase Hosting

```bash
firebase login
firebase use PROJECT_ID
firebase deploy --only hosting
```

## Important limitations

- The current session store is in memory. Cloud Run restarts or multiple
  instances will lose sessions. Use a persistent session store before
  production scaling.
- Uploaded images currently use local disk storage. Cloud Run disk is not
  durable; move uploads to Cloud Storage before relying on uploaded photos.
- The Render PostgreSQL database is not changed by this deployment.
