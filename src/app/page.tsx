import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import UploadForm from './UploadForm';

export const dynamic = 'force-dynamic';

type RecentJob = {
  id: string;
  status: string;
  filename: string;
  createdAt: Date;
};

async function listRecentJobs(): Promise<RecentJob[]> {
  try {
    const r = await db.execute<RecentJob>(sql`
      SELECT id, status, filename, created_at as "createdAt"
      FROM jobs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    return r.rows;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const recent = await listRecentJobs();
  return (
    <>
      <section className="card">
        <h2>Upload feedback PDF</h2>
        <p className="muted">
          PDF only, max 2 MB. Expected format: lines of <code>Feedback ID: fb_001</code> followed
          by <code>Comment: ...</code>.
        </p>
        <UploadForm />
      </section>

      <section className="card">
        <h2>Recent jobs</h2>
        {recent.length === 0 ? (
          <p className="muted">No jobs yet.</p>
        ) : (
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((j) => (
                <tr key={j.id}>
                  <td>{j.filename}</td>
                  <td>
                    <span className={`status ${j.status}`}>{j.status}</span>
                  </td>
                  <td className="muted">{new Date(j.createdAt).toLocaleString()}</td>
                  <td>
                    <Link href={`/jobs/${j.id}`}>view</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
