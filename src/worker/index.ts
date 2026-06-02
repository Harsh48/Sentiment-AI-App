import http from 'node:http';
import { claimNextJob, completeJob, failJob, reclaimStaleJobs } from '@/lib/jobs';
import { OpenAiLlmClient, type LlmClient } from '@/lib/llm';
import { pool } from '@/db/client';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1500);
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3));
const STALE_RUNNING_MS = Number(process.env.WORKER_STALE_RUNNING_MS ?? 5 * 60_000);
const REAPER_INTERVAL_MS = Number(process.env.WORKER_REAPER_INTERVAL_MS ?? 60_000);

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) {
  const line = { level, msg, time: new Date().toISOString(), ...extra };
  if (level === 'error') console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

export async function processOne(llm: LlmClient): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  const items = Array.isArray(job.feedbackItems) ? job.feedbackItems : [];
  log('info', 'job claimed', { jobId: job.id, items: items.length, attempts: job.attempts });

  try {
    if (items.length === 0) {
      await failJob(job.id, 'no feedback items found on job');
      return true;
    }
    const result = await llm.analyze(items);
    await completeJob(job.id, result);
    log('info', 'job completed', { jobId: job.id });
  } catch (err) {
    const message = (err as Error).message || String(err);
    log('error', 'job failed', { jobId: job.id, error: message });
    await failJob(job.id, message);
  }
  return true;
}

async function workerLoop(slot: number, llm: LlmClient, shouldStop: () => boolean) {
  while (!shouldStop()) {
    try {
      const did = await processOne(llm);
      if (!did) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      log('error', 'worker loop error', { slot, error: (err as Error).message });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function reaperLoop(shouldStop: () => boolean) {
  while (!shouldStop()) {
    try {
      const n = await reclaimStaleJobs(STALE_RUNNING_MS);
      if (n > 0) log('warn', 'reclaimed stale jobs', { count: n });
    } catch (err) {
      log('error', 'reaper error', { error: (err as Error).message });
    }
    await sleep(REAPER_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const llm = new OpenAiLlmClient();
  let stopping = false;
  const shouldStop = () => stopping;

  const port = Number(process.env.PORT ?? 8080);
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(stopping ? 503 : 200, { 'content-type': 'text/plain' });
      res.end(stopping ? 'stopping' : 'ok');
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log('info', 'healthcheck listening', { port }));

  const shutdown = (sig: string) => {
    log('info', 'shutdown signal received', { sig });
    stopping = true;
    server.close();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log('info', 'worker starting', {
    concurrency: CONCURRENCY,
    pollIntervalMs: POLL_INTERVAL_MS,
    staleAfterMs: STALE_RUNNING_MS,
  });

  const loops = [
    ...Array.from({ length: CONCURRENCY }, (_, i) => workerLoop(i, llm, shouldStop)),
    reaperLoop(shouldStop),
  ];

  await Promise.all(loops);
  await pool.end();
  log('info', 'worker stopped');
}

if (require.main === module) {
  main().catch((err) => {
    log('error', 'worker fatal', { error: (err as Error).message });
    process.exit(1);
  });
}
