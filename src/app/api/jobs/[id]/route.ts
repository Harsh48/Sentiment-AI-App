import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid job id' }, { status: 400 });
  }
  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    status: job.status,
    filename: job.filename,
    feedbackCount: Array.isArray(job.feedbackItems) ? job.feedbackItems.length : 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
  });
}
