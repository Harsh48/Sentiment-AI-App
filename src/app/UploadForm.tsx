'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a PDF file first.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/jobs', { method: 'POST', body: data });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `Upload failed (HTTP ${res.status})`);
        return;
      }
      router.push(`/jobs/${body.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p>
        <input type="file" name="file" accept="application/pdf,.pdf" required disabled={busy} />
      </p>
      <p>
        <button type="submit" disabled={busy}>
          {busy ? 'Uploading…' : 'Analyze'}
        </button>
      </p>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
