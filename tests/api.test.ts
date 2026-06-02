import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ createJob: vi.fn(), getJob: vi.fn() }));
vi.mock('@/lib/jobs', () => mocks);
vi.mock('@/db/client', () => ({ db: {}, pool: {} }));

import { POST } from '@/app/api/jobs/route';

function makeRequest(form: FormData): Request {
  return new Request('http://localhost/api/jobs', { method: 'POST', body: form });
}

beforeEach(() => {
  mocks.createJob.mockReset();
  mocks.createJob.mockResolvedValue({
    id: '11111111-1111-1111-1111-111111111111',
    status: 'queued',
  });
});

describe('POST /api/jobs', () => {
  it('rejects when no file is supplied', async () => {
    const form = new FormData();
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(400);
  });

  it('rejects a non-PDF file', async () => {
    const form = new FormData();
    form.append('file', new File(['hello'], 'foo.txt', { type: 'text/plain' }));
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(415);
  });

  it('rejects a file whose magic bytes are not %PDF-', async () => {
    const form = new FormData();
    form.append('file', new File(['hello there'], 'foo.pdf', { type: 'application/pdf' }));
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not appear to be a PDF/);
  });

  it('rejects an oversized file', async () => {
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1, 0);
    huge.write('%PDF-', 0);
    const form = new FormData();
    form.append('file', new File([huge], 'big.pdf', { type: 'application/pdf' }));
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(413);
  });
});
