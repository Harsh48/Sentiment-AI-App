import { Pool } from 'pg';

const DDL = `
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

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at);
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    await pool.query(DDL);
    // eslint-disable-next-line no-console
    console.log('migrate: ok');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('migrate failed:', err);
  process.exit(1);
});
