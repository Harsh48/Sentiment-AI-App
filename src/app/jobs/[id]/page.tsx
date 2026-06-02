import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getJob } from '@/lib/jobs';
import { AnalysisResultSchema } from '@/lib/analysis';
import JobAutoRefresh from './JobAutoRefresh';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const job = await getJob(params.id);
  if (!job) notFound();

  const items = Array.isArray(job.feedbackItems) ? job.feedbackItems : [];
  const parsed =
    job.status === 'completed' && job.result
      ? AnalysisResultSchema.safeParse(job.result)
      : null;

  return (
    <>
      {(job.status === 'queued' || job.status === 'running') && <JobAutoRefresh />}

      <section className="card">
        <p>
          <Link href="/">← back</Link>
        </p>
        <h2 style={{ marginBottom: 6 }}>{job.filename}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {items.length} feedback {items.length === 1 ? 'entry' : 'entries'} · created{' '}
          {new Date(job.createdAt).toLocaleString()}
        </p>
        <p>
          <span className={`status ${job.status}`}>{job.status}</span>
        </p>
        {job.status === 'failed' && job.error && <div className="error">{job.error}</div>}
        {(job.status === 'queued' || job.status === 'running') && (
          <p className="muted">Analyzing… this page auto-refreshes.</p>
        )}
      </section>

      {parsed?.success && (
        <>
          <section className="card">
            <h2>
              Overall sentiment:{' '}
              <span className={`sentiment-${parsed.data.overallSentiment}`}>
                {parsed.data.overallSentiment}
              </span>
            </h2>
            <p>{parsed.data.overallSummary}</p>
          </section>

          <section className="card">
            <h2>Themes</h2>
            {parsed.data.themes.map((t, i) => (
              <div className="theme" key={i}>
                <h3>
                  {t.name}{' '}
                  <span className={`sentiment-${t.sentiment}`} style={{ fontSize: 12 }}>
                    ({t.sentiment})
                  </span>
                </h3>
                <div>{t.description}</div>
                <div className="evidence">evidence: {t.evidenceFeedbackIds.join(', ')}</div>
              </div>
            ))}
          </section>

          <section className="card">
            <h2>Recommended actions</h2>
            <ol className="list">
              {parsed.data.recommendedActions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </section>

          {parsed.data.uncertaintyNotes && (
            <section className="card">
              <h2>Notes &amp; limitations</h2>
              <p className="muted">{parsed.data.uncertaintyNotes}</p>
            </section>
          )}
        </>
      )}

      {parsed && !parsed.success && (
        <div className="error">Stored result failed validation: {parsed.error.message}</div>
      )}
    </>
  );
}
