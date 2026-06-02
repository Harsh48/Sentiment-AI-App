import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobs, type Job } from '@/db/schema';
import type { FeedbackItem } from './pdf';
import type { AnalysisResult } from './analysis';

export async function createJob(input: {
  filename: string;
  fileSize: number;
  feedbackItems: FeedbackItem[];
}): Promise<Job> {
  const [row] = await db
    .insert(jobs)
    .values({
      status: 'queued',
      filename: input.filename,
      fileSize: input.fileSize,
      feedbackItems: input.feedbackItems,
    })
    .returning();
  return row;
}

export async function getJob(id: string): Promise<Job | null> {
  const result = await db.execute<Job>(sql`
    SELECT id, status, filename, file_size as "fileSize",
           feedback_items as "feedbackItems", result, error, attempts,
           claimed_at as "claimedAt", created_at as "createdAt", updated_at as "updatedAt"
    FROM jobs WHERE id = ${id} LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function claimNextJob(): Promise<Job | null> {
  const result = await db.execute<Job>(sql`
    UPDATE jobs SET status = 'running',
                    claimed_at = NOW(),
                    attempts = attempts + 1,
                    updated_at = NOW()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, status, filename, file_size as "fileSize",
              feedback_items as "feedbackItems", result, error, attempts,
              claimed_at as "claimedAt", created_at as "createdAt", updated_at as "updatedAt"
  `);
  return result.rows[0] ?? null;
}

export async function completeJob(id: string, result: AnalysisResult): Promise<void> {
  await db.execute(sql`
    UPDATE jobs SET status = 'completed',
                    result = ${JSON.stringify(result)}::jsonb,
                    error = NULL,
                    updated_at = NOW()
    WHERE id = ${id}
  `);
}

export async function failJob(id: string, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs SET status = 'failed',
                    error = ${error},
                    updated_at = NOW()
    WHERE id = ${id}
  `);
}

export async function reclaimStaleJobs(olderThanMs: number): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs SET status = 'queued', claimed_at = NULL, updated_at = NOW()
    WHERE status = 'running'
      AND claimed_at < NOW() - (${olderThanMs} || ' milliseconds')::interval
    RETURNING id
  `);
  return result.rows.length;
}
