import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Slot } from '../../domain/slots';
import { api, ApiError, type BookingView } from '../api';
import { BrandMark } from '../components/Brand';
import { CheckIcon, GhostIcon, PhoneIcon } from '../components/Icons';
import { StoryBar } from '../components/StoryBar';
import { UrgencyChip } from '../components/Urgency';
import { dayKey, formatDay, formatLongDay, formatRange, telHref } from '../lib/format';
import { useTitle } from '../lib/machine';

export default function Booking() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const story = params.get('story') === '1';
  const [bookedJobId, setBookedJobId] = useState<string | null>(null);
  const [view, setView] = useState<BookingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [badLinkBusiness, setBadLinkBusiness] = useState<{ name: string; phone: string } | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  useTitle(view ? `Book ${view.business.name}` : 'Book a visit');

  const load = useCallback(async () => {
    try {
      const v = await api.booking(token);
      setView(v);
      setAddress(v.caller.address ?? '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this booking link.');
      const details = e instanceof ApiError ? (e.details as { business?: { name: string; phone: string } } | null) : null;
      setBadLinkBusiness(details?.business ?? null);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const tz = view?.business.timezone ?? 'America/New_York';
  const days = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const s of view?.slots ?? []) {
      const key = dayKey(s.start, tz);
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.values()];
  }, [view, tz]);

  async function confirm() {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const { job } = await api.book(token, picked, address.trim() || null);
      setBookedJobId(job.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Booking failed. Please try again.');
      if (e instanceof ApiError && e.code === 'slot-taken') {
        setPicked(null);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  if (error && !view) {
    return (
      <div className="caller-page">
        <div className="caller-card panel" data-testid="bad-link">
          {badLinkBusiness && (
            <header className="caller-head">
              <BrandMark />
              <div>
                <div className="caller-biz">{badLinkBusiness.name}</div>
                <div className="faint" style={{ fontSize: 13 }}>
                  {badLinkBusiness.phone}
                </div>
              </div>
            </header>
          )}
          <section className="stack" style={{ gap: 14, justifyItems: 'center', textAlign: 'center' }}>
            <GhostIcon width={56} height={56} />
            <h1 className="caller-title">This link has given up the ghost.</h1>
            <p className="muted">It may have been mistyped or already used. A quick call still gets you on the schedule.</p>
            {badLinkBusiness && (
              <a className="btn btn-primary caller-confirm" href={telHref(badLinkBusiness.phone)}>
                <PhoneIcon /> Call {badLinkBusiness.phone}
              </a>
            )}
          </section>
        </div>
      </div>
    );
  }
  if (!view) return <div className="caller-page empty">Loading...</div>;

  const owner = view.business.ownerName.split(' ')[0];
  const first = view.caller.name?.split(' ')[0];

  return (
    <div className="caller-page">
      {story && (
        <StoryBar
          step={view.booked ? 4 : 3}
          next={
            view.booked
              ? { to: `/machine/invoice?script=slip&story=1${bookedJobId ? `&job=${bookedJobId}` : ''}`, label: `Back to ${owner}: bill it by voice` }
              : undefined
          }
        />
      )}
      <div className="caller-card panel">
        <header className="caller-head">
          <BrandMark />
          <div>
            <div className="caller-biz">{view.business.name}</div>
            <div className="faint" style={{ fontSize: 13 }}>
              {view.business.phone}
            </div>
          </div>
        </header>

        {view.booked ? (
          <section className="ticket" data-testid="booked">
            <div className="ticket-stamp">
              <CheckIcon /> Booked
            </div>
            <h1 className="caller-title">You're on the schedule{first ? `, ${first}` : ''}.</h1>
            <p className="ticket-when">
              {formatLongDay(view.booked.start, tz)}
              <br />
              {formatRange(view.booked.start, view.booked.end, tz)}
            </p>
            <p className="muted">
              {owner} will text you when on the way. Need to change it? Call {view.business.phone}.
            </p>
          </section>
        ) : (
          <section className="stack" style={{ gap: 18 }}>
            <div>
              <h1 className="caller-title">{first ? `Hi ${first}, ` : ''}pick a time for {owner} to come out.</h1>
              <p className="muted">Sorry we missed your call. Here is what we heard:</p>
            </div>
            <div className="heard">
              <div className="spread">
                <strong>{view.caller.job}</strong>
                <UrgencyChip urgency={view.caller.urgency} />
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor="address">Address for the visit</label>
                <input id="address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
              </div>
            </div>

            {days.length === 0 ? (
              <div className="notice">No open times in the next two weeks. Please call {view.business.phone}.</div>
            ) : (
              <div className="stack" role="radiogroup" aria-label="Open times">
                {days.map((slots) => (
                  <div key={slots[0]!.start} className="slot-day">
                    <div className="label">{formatDay(slots[0]!.start, tz)}</div>
                    <div className="slot-row">
                      {slots.map((s) => {
                        const on = picked?.start === s.start;
                        return (
                          <button key={s.start} type="button" role="radio" aria-checked={on} className={`slot ${on ? 'on' : ''}`} onClick={() => setPicked(s)}>
                            {formatRange(s.start, s.end, tz)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="error-box" role="alert">{error}</div>}
            <button className="btn btn-primary caller-confirm" type="button" disabled={!picked || saving} onClick={() => void confirm()}>
              {picked ? `Book ${formatDay(picked.start, tz)}, ${formatRange(picked.start, picked.end, tz)}` : 'Pick a time above'}
            </button>
          </section>
        )}
      </div>
      <p className="caller-foot faint">Scheduling by AfterBeep</p>
    </div>
  );
}
