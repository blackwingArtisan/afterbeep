import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Job } from '../../domain/types';
import { api } from '../api';
import { UrgencyChip } from '../components/Urgency';
import { dayKey, formatLongDay, formatRange, telHref } from '../lib/format';
import { useMachine, useTitle } from '../lib/machine';

const STATUS: Record<Job['status'], string> = { scheduled: 'Scheduled', done: 'Done, needs invoice', invoiced: 'Invoiced' };

export default function Schedule() {
  useTitle('Schedule');
  const { business } = useMachine();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const tz = business?.timezone ?? 'America/New_York';

  useEffect(() => {
    void api.jobs().then((r) => setJobs(r.jobs));
  }, []);

  const days = useMemo(() => {
    const groups = new Map<string, Job[]>();
    for (const j of jobs ?? []) groups.set(dayKey(j.start, tz), [...(groups.get(dayKey(j.start, tz)) ?? []), j]);
    return [...groups.values()];
  }, [jobs, tz]);

  if (!jobs) return <div className="empty">Loading the schedule...</div>;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section>
        <p className="eyebrow">Schedule</p>
        <h1 className="page-title">Who's on the route</h1>
        <p className="muted page-lede">Jobs land here when a caller picks a time from their text. Finished jobs wait for a spoken invoice.</p>
      </section>
      {days.length === 0 && <div className="empty panel">Nothing booked yet.</div>}
      {days.map((dayJobs) => (
        <section key={dayJobs[0]!.id} className="stack">
          <h2 className="day-title">{formatLongDay(dayJobs[0]!.start, tz)}</h2>
          <div className="job-list">
            {dayJobs.map((j) => (
              <article key={j.id} className="job panel" data-testid="job">
                <div className="job-time lcd">{formatRange(j.start, j.end, tz)}</div>
                <div className="job-main">
                  <div className="spread">
                    <strong className="job-name">{j.customerName}</strong>
                    <UrgencyChip urgency={j.urgency} />
                  </div>
                  <div>{j.description}</div>
                  <div className="muted">
                    {j.address ?? 'No address yet'} · <a href={telHref(j.phone)}>{j.phone}</a>
                  </div>
                </div>
                <div className="job-actions">
                  <span className={`chip ${j.status === 'invoiced' ? 'chip-ok' : j.status === 'done' ? 'chip-soon' : 'chip-info'}`}>{STATUS[j.status]}</span>
                  {j.invoiceId ? (
                    <Link className="btn btn-small" to={`/i/${j.invoiceId}`}>
                      View invoice
                    </Link>
                  ) : (
                    <Link className="btn btn-primary btn-small" to={`/machine/invoice?job=${j.id}`}>
                      Say the invoice
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
