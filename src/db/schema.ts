import { pgTable, text, timestamp, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    filename: text('filename').notNull(),
    fileSize: integer('file_size').notNull(),
    feedbackItems: jsonb('feedback_items').$type<Array<{ id: string; comment: string }>>(),
    result: jsonb('result'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('jobs_status_idx').on(table.status),
    createdIdx: index('jobs_created_idx').on(table.createdAt),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
