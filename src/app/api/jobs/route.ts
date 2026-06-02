import { NextResponse } from 'next/server';
import { createJob } from '@/lib/jobs';
import {
  extractTextFromPdf,
  parseFeedback,
  MAX_PDF_BYTES,
  MIN_FEEDBACK,
  MAX_FEEDBACK,
} from '@/lib/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `file exceeds max size of ${MAX_PDF_BYTES} bytes` },
      { status: 413 },
    );
  }

  const isPdfMime = file.type === 'application/pdf' || file.type === '';
  const isPdfExt = file.name.toLowerCase().endsWith('.pdf');
  if (!isPdfMime || !isPdfExt) {
    return NextResponse.json({ error: 'only PDF files are accepted' }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return NextResponse.json({ error: 'file does not appear to be a PDF' }, { status: 400 });
  }

  let text: string;
  try {
    text = await extractTextFromPdf(buf);
  } catch (err) {
    return NextResponse.json(
      { error: `could not parse PDF: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const items = parseFeedback(text);
  if (items.length < MIN_FEEDBACK) {
    return NextResponse.json(
      {
        error:
          'no feedback entries found. Expected lines like "Feedback ID: fb_001" followed by "Comment: ...".',
      },
      { status: 422 },
    );
  }
  if (items.length > MAX_FEEDBACK) {
    return NextResponse.json(
      { error: `too many feedback entries (${items.length}); max is ${MAX_FEEDBACK}` },
      { status: 422 },
    );
  }

  const job = await createJob({
    filename: file.name,
    fileSize: file.size,
    feedbackItems: items,
  });

  return NextResponse.json(
    { id: job.id, status: job.status, feedbackCount: items.length },
    { status: 202 },
  );
}
