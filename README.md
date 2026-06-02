# Consumer Sentiment Analyzer

A small cloud-hosted service that ingests a PDF of customer feedback and returns a structured sentiment analysis.

Built for the take-home evaluation. Sample data only.

## What it does

1. User uploads a PDF (max 2 MB, format: `Feedback ID:` / `Comment:` pairs, 1–50 entries).
2. The API parses the PDF, extracts feedback items, creates a job in Postgres, and returns a job ID immediately (`202`).
3. A separate background worker polls the DB, calls the LLM with **structured outputs** (`gpt-4o-mini`), validates the response against a Zod schema, and stores the result.
4. The UI auto-refreshes the job page until it shows the readable analysis: overall summary, sentiment, themes (with evidence IDs), recommended actions, and uncertainty notes.

## Stack

- **Next.js 14** (App Router) — UI + API routes in one service
- **Postgres** via **Drizzle ORM** — durable job & result storage; jobs claimed atomically with `FOR UPDATE SKIP LOCKED`
- **Node worker** — long-running process, configurable concurrency, exposes `/healthz` for Cloud Run
- **OpenAI `gpt-4o-mini`** — structured JSON output via `response_format: json_schema`
- **Zod** — validates LLM output and the analysis schema in the UI
- **Vitest** — unit + (gated) integration tests

## Project layout

```
src/
  app/
    page.tsx                          home: upload form + recent jobs
    jobs/[id]/page.tsx                job status + result rendering
    api/jobs/route.ts                 POST /jobs
    api/jobs/[id]/route.ts            GET  /jobs/:id
    api/jobs/[id]/result/route.ts     GET  /jobs/:id/result
  db/
    schema.ts                         jobs table
    client.ts, migrate.ts             pg pool, idempotent DDL
  lib/
    pdf.ts                            PDF text extraction + feedback parser
    llm.ts                            OpenAI client wrapper, schema-validated
    analysis.ts                       Zod + JSON schema for results
    jobs.ts                           createJob / claimNextJob / completeJob / failJob
  worker/index.ts                     polling worker + healthcheck server
tests/
  pdf.test.ts                         parser unit tests
  analysis.test.ts                    schema validation
  llm.test.ts                         mocked LLM success + failures
  api.test.ts                         upload-route validation paths
  integration.test.ts                 Postgres-backed lifecycle + concurrency (gated)
Dockerfile                            web image (Next.js standalone)
Dockerfile.worker                     worker image
DEPLOY.md                             step-by-step Cloud Run + Cloud SQL deploy
```

## Local development

Requirements: Node 20+, Docker (for Postgres), and an OpenAI key.

```bash
# 1. Install
npm install

# 2. Start Postgres
docker run --rm -d --name sentiment-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres postgres:16

# 3. Env
cp .env.example .env.local
# Edit .env.local: set OPENAI_API_KEY=sk-...

# 4. Migrate
npm run db:migrate

# 5. Run web + worker (separate terminals)
npm run dev          # http://localhost:3000
npm run worker:dev
```

Upload `tests/fixtures/*.pdf` (or any PDF in the expected format) via the UI.

## API

| Method | Path                       | Notes                                                  |
| ------ | -------------------------- | ------------------------------------------------------ |
| POST   | `/api/jobs`                | multipart upload `file=<pdf>`. Returns `202 {id, …}`.  |
| GET    | `/api/jobs/:id`            | returns `{status, filename, feedbackCount, …}`         |
| GET    | `/api/jobs/:id/result`     | `200` when completed, `409` while queued/running       |

## Tests

```bash
npm test                  # unit tests only (no DB needed)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sentiment npm test
# the second form also runs integration tests:
#   - job lifecycle (queued → running → completed)
#   - atomic claim (3 concurrent claims get 3 distinct jobs)
#   - 3 jobs processed concurrently keep separate results (no mixing)
#   - failure path marks job as failed with stored error
```

Unit-test count: **19 passing** across PDF parsing, analysis schema, LLM client (mocked), and upload validation. Integration suite adds **4 more** when a DB is available.

## Concurrency model

The worker runs **N concurrent loops** (default `WORKER_CONCURRENCY=3`). Each loop:

1. `UPDATE … SET status='running' WHERE id = (SELECT id FROM jobs WHERE status='queued' FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …` — atomic claim, no two loops ever see the same row.
2. Calls `LlmClient.analyze(items)` (OpenAI w/ `json_schema`, Zod-validated, evidence IDs filtered to known set).
3. `completeJob` or `failJob` writes the terminal state in a single statement.

A **reaper loop** every 60 s resets any job stuck in `running` for more than 5 minutes back to `queued` so a crashed worker doesn't leave jobs orphaned.

## Design decisions worth flagging

- **Two Cloud Run services, one DB.** Splitting the worker from the web service means an HTTP request never blocks on the LLM (spec requirement) and lets the worker keep `min-instances=1` while the web scales to zero.
- **DB-polling worker, not Cloud Tasks / Pub-Sub.** For this scale (small bursts, small fleet), polling is one fewer moving part and survives platform restarts cleanly via `SKIP LOCKED`. The trade-off is a configurable latency floor (1.5 s).
- **Strict LLM output via `response_format: json_schema`.** The model can only emit JSON conforming to the schema in `src/lib/analysis.ts`. We *also* re-parse with Zod and **drop fabricated evidence IDs** that weren't in the input — belt-and-suspenders against hallucination.
- **No PDF storage.** The PDF is parsed in-memory, extracted feedback is stored as JSONB, the bytes are discarded. Less to secure, less to manage.
- **Magic-byte check + 2 MB cap before parsing.** Cheap denial-of-service guardrails: we won't hand multi-megabyte garbage to `pdf-parse`.
- **Secrets stay in env / Secret Manager.** `.env*` is gitignored; `DEPLOY.md` wires Secret Manager into Cloud Run.

## Known limitations

- One worker instance is the default. The architecture supports many (rows are claimed atomically), but `--max-instances 1` is the take-home default. Increase if you need more throughput.
- No retry on LLM failure today — the job is marked `failed` with the error message. A bounded exponential retry would be a one-screen change in `processOne`.
- No rate-limit on uploads. For production, add per-IP throttling in front of `/api/jobs`.
- The result page polls by full server-component refresh on a 2 s interval. Fine for one user; for many concurrent viewers a single SSE endpoint would be cheaper.

## Deployment

See [`DEPLOY.md`](./DEPLOY.md) for a step-by-step Cloud Run + Cloud SQL deploy. Once both services are deployed, the public URL of `sentiment-web` is the working URL.
