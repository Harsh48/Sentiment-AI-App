import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const integration = dbUrl ? describe : describe.skip;

if (dbUrl) process.env.DATABASE_URL = dbUrl;

let createJob: typeof import('@/lib/jobs').createJob;
let getJob: typeof import('@/lib/jobs').getJob;
let claimNextJob: typeof import('@/lib/jobs').claimNextJob;
let completeJob: typeof import('@/lib/jobs').completeJob;
let failJob: typeof import('@/lib/jobs').failJob;
let pool: import('pg').Pool;
let processOne: typeof import('@/worker/index').processOne;

integration('job lifecycle (Postgres)', () => {
  beforeAll(async () => {
    ({ createJob, getJob, claimNextJob, completeJob, failJob } = await import('@/lib/jobs'));
    ({ pool } = await import('@/db/client'));
    ({ processOne } = await import('@/worker/index'));

    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status        TEXT NOT NULL DEFAULT 'queued',
        filename      TEXT NOT NULL,
        file_size     INTEGER NOT NULL,
        feedback_items JSONB,
        result        JSONB,
        error         TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0,
        claimed_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query('TRUNCATE jobs');
  });

  afterAll(async () => {
    await pool.end();
  });

  const ITEMS = [{ id: 'fb_1', comment: 'good' }];

  it('moves a job through queued → running → completed', async () => {
    const job = await createJob({ filename: 'a.pdf', fileSize: 100, feedbackItems: ITEMS });
    expect(job.status).toBe('queued');

    const claimed = await claimNextJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);

    await completeJob(job.id, {
      overallSummary: 'ok',
      overallSentiment: 'positive',
      themes: [{ name: 't', description: 'd', sentiment: 'positive', evidenceFeedbackIds: ['fb_1'] }],
      recommendedActions: ['act'],
      uncertaintyNotes: null,
    });

    const final = await getJob(job.id);
    expect(final?.status).toBe('completed');
    expect(final?.result).toBeTruthy();
  });

  it('claimNextJob never returns the same job twice (atomic claim)', async () => {
    await pool.query('TRUNCATE jobs');
    const ids = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createJob({ filename: `f${i}.pdf`, fileSize: 100, feedbackItems: ITEMS }),
      ),
    );
    expect(ids).toHaveLength(3);

    const claims = await Promise.all([claimNextJob(), claimNextJob(), claimNextJob()]);
    const claimedIds = claims.map((c) => c?.id);
    expect(new Set(claimedIds).size).toBe(3);
    for (const c of claims) expect(c?.status).toBe('running');

    const empty = await claimNextJob();
    expect(empty).toBeNull();
  });

  it('processes 3 jobs in parallel without overwrite or mixing', async () => {
    await pool.query('TRUNCATE jobs');

    const fakeLlm = {
      analyze: async (items: Array<{ id: string; comment: string }>) => ({
        overallSummary: `summary for ${items.map((i) => i.id).join(',')}`,
        overallSentiment: 'neutral' as const,
        themes: [
          {
            name: 'echo',
            description: 'echo',
            sentiment: 'neutral' as const,
            evidenceFeedbackIds: items.map((i) => i.id),
          },
        ],
        recommendedActions: ['noop'],
        uncertaintyNotes: null,
      }),
    };

    const jobs = await Promise.all(
      [
        [{ id: 'a1', comment: 'A' }],
        [{ id: 'b1', comment: 'B' }],
        [{ id: 'c1', comment: 'C' }],
      ].map((items, i) =>
        createJob({ filename: `f${i}.pdf`, fileSize: 1, feedbackItems: items }),
      ),
    );

    const handled = await Promise.all([
      processOne(fakeLlm),
      processOne(fakeLlm),
      processOne(fakeLlm),
    ]);
    expect(handled.every(Boolean)).toBe(true);

    const finals = await Promise.all(jobs.map((j) => getJob(j.id)));
    const byFilename = Object.fromEntries(finals.map((j) => [j!.filename, j!]));

    expect(byFilename['f0.pdf'].status).toBe('completed');
    expect(byFilename['f0.pdf'].result).toMatchObject({ overallSummary: 'summary for a1' });
    expect(byFilename['f1.pdf'].result).toMatchObject({ overallSummary: 'summary for b1' });
    expect(byFilename['f2.pdf'].result).toMatchObject({ overallSummary: 'summary for c1' });
  });

  it('marks a job failed when the LLM throws', async () => {
    await pool.query('TRUNCATE jobs');
    const job = await createJob({ filename: 'x.pdf', fileSize: 1, feedbackItems: ITEMS });
    const failingLlm = {
      analyze: async () => {
        throw new Error('boom');
      },
    };
    await processOne(failingLlm);
    const final = await getJob(job.id);
    expect(final?.status).toBe('failed');
    expect(final?.error).toBe('boom');
  });
});
