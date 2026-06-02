# Deploying to GCP Cloud Run

This deploys two Cloud Run services that share one Cloud SQL Postgres instance:

- `sentiment-web` – the Next.js app (UI + API)
- `sentiment-worker` – the background job processor

## Prerequisites

- A GCP project with billing enabled (free tier is fine for this workload)
- `gcloud` CLI installed and authenticated: `gcloud auth login && gcloud config set project YOUR_PROJECT`
- The following APIs enabled:
  ```
  gcloud services enable run.googleapis.com sqladmin.googleapis.com \
      cloudbuild.googleapis.com secretmanager.googleapis.com \
      artifactregistry.googleapis.com
  ```

Set some shell variables you'll reuse:

```bash
export PROJECT=$(gcloud config get-value project)
export REGION=us-central1
export SQL_INSTANCE=sentiment-db
export DB_NAME=sentiment
export DB_USER=sentiment
export DB_PASSWORD="$(openssl rand -base64 24)"
```

## 1. Create Cloud SQL Postgres

```bash
gcloud sql instances create $SQL_INSTANCE \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-size=10GB

gcloud sql databases create $DB_NAME --instance=$SQL_INSTANCE
gcloud sql users create $DB_USER --instance=$SQL_INSTANCE --password="$DB_PASSWORD"
```

The Cloud SQL **connection name** (used by Cloud Run's socket) is:

```bash
export SQL_CONNECTION="$PROJECT:$REGION:$SQL_INSTANCE"
```

## 2. Store secrets in Secret Manager

```bash
printf '%s' "$DB_PASSWORD" | gcloud secrets create sentiment-db-password --data-file=-
printf '%s' "$OPENAI_API_KEY" | gcloud secrets create sentiment-openai-key --data-file=-
```

Give the default Compute service account access:

```bash
SA="$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for s in sentiment-db-password sentiment-openai-key; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

## 3. Build and push the two images

Cloud Build builds straight from the source dir — no local Docker required:

```bash
gcloud builds submit . --tag $REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/sentiment-web --file Dockerfile
gcloud builds submit . --tag $REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/sentiment-worker --file Dockerfile.worker
```

(If `cloud-run-source-deploy` doesn't exist, replace with any Artifact Registry repo you've created.)

## 4. Run the DB migration

Run the migrator once from your local machine using the Cloud SQL Auth Proxy
(or any psql client). With the proxy:

```bash
cloud-sql-proxy --port 5433 $SQL_CONNECTION &
DATABASE_URL="postgres://$DB_USER:$DB_PASSWORD@localhost:5433/$DB_NAME" npm run db:migrate
kill %1
```

## 5. Deploy the web service

```bash
gcloud run deploy sentiment-web \
  --image $REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/sentiment-web \
  --region $REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances $SQL_CONNECTION \
  --set-env-vars "DATABASE_URL=postgres://$DB_USER:PASSWORD_PLACEHOLDER@/$DB_NAME?host=/cloudsql/$SQL_CONNECTION" \
  --update-secrets "DATABASE_URL_PASSWORD=sentiment-db-password:latest"
```

(`DATABASE_URL` here is a workaround: Cloud Run doesn't expand secret values inside other env vars, so for production you'd build the full URL at runtime. For a take-home demo, set the whole `DATABASE_URL` env var with the literal password — note that anyone with `roles/run.admin` can read it. Use Secret Manager mounting for hardening.)

Simpler version that just stores the full URL as a secret:

```bash
printf '%s' "postgres://$DB_USER:$DB_PASSWORD@/$DB_NAME?host=/cloudsql/$SQL_CONNECTION" \
  | gcloud secrets create sentiment-db-url --data-file=-
gcloud secrets add-iam-policy-binding sentiment-db-url \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor

gcloud run deploy sentiment-web \
  --image $REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/sentiment-web \
  --region $REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances $SQL_CONNECTION \
  --update-secrets DATABASE_URL=sentiment-db-url:latest
```

## 6. Deploy the worker

```bash
gcloud run deploy sentiment-worker \
  --image $REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/sentiment-worker \
  --region $REGION \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --cpu 1 --memory 512Mi \
  --add-cloudsql-instances $SQL_CONNECTION \
  --update-secrets DATABASE_URL=sentiment-db-url:latest,OPENAI_API_KEY=sentiment-openai-key:latest \
  --set-env-vars OPENAI_MODEL=gpt-4o-mini,WORKER_CONCURRENCY=3
```

Key flags:

- `--min-instances 1` keeps the worker warm so jobs are picked up immediately (Cloud Run scales to zero by default; without this the worker sleeps).
- `--max-instances 1` is a safe starting point — multiple worker instances are also safe because `claimNextJob()` uses `FOR UPDATE SKIP LOCKED`, but for a take-home one is enough.
- The worker is `--no-allow-unauthenticated` since nothing should call it externally.

## 7. Verify

```bash
gcloud run services describe sentiment-web --region $REGION --format='value(status.url)'
```

Open that URL, upload a sample PDF, and watch the job page auto-refresh through queued → running → completed.

## Notes / known limitations

- **Cold-start latency**: with `--min-instances 0` on the web service, the first upload after idle will take a few seconds. Acceptable for a demo.
- **Cost**: db-f1-micro + min-instance worker is roughly $7–10/month if left running. Delete the worker (`gcloud run services delete sentiment-worker`) and Cloud SQL instance when done evaluating.
- **Secrets**: the `OPENAI_API_KEY` is supplied via Secret Manager, never baked into the image or committed.
