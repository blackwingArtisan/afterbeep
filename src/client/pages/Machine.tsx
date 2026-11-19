import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Business } from '../../domain/types';
import { api } from '../api';
import { Brand } from '../components/Brand';
import { BookIcon, CalendarIcon, OutboxIcon, PhoneIcon, ReceiptIcon, TapeIcon } from '../components/Icons';
import { MessageCounter } from '../components/Lcd';
import { ThemeToggle } from '../components/ThemeToggle';
import { MachineContext } from '../lib/machine';

const KEYS = [
  { to: '/machine', label: 'Messages', icon: TapeIcon, end: true },
  { to: '/machine/call', label: 'Call in', icon: PhoneIcon },
  { to: '/machine/schedule', label: 'Schedule', icon: CalendarIcon },
  { to: '/machine/invoice', label: 'Invoice', icon: ReceiptIcon },
  { to: '/machine/outbox', label: 'Outbox', icon: OutboxIcon },
  { to: '/machine/prices', label: 'Copies', icon: BookIcon },
];

export default function Machine() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [newCount, setNewCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  const refresh = useCallback(async () => {
    const { newCount: count } = await api.messages();
    setNewCount(count);
  }, []);

  useEffect(() => {
    void api.business().then((r) => setBusiness(r.business));
    void refresh();
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function resetDemo() {
    await api.reset();
    await refresh();
    navigate('/machine', { replace: true });
    window.location.reload();
  }

  return (
    <MachineContext.Provider value={{ business, newCount, refresh, setBusiness }}>
      <div className="machine">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="machine-top">
          <div className="wrap spread">
            <div className="row" style={{ gap: 16 }}>
              <Brand to="/" />
              <span className="machine-biz muted">{business?.name}</span>
            </div>
            <div className="row machine-actions">
              <MessageCounter count={newCount} />
              <span className="wide-only">
                <ThemeToggle />
              </span>
              <NavLink className="btn btn-small story-btn" to="/machine/call?story=1" aria-label="Demo the whole story">
                <span className="story-long">Demo the whole story</span>
                <span className="story-short" aria-hidden="true">
                  Demo
                </span>
              </NavLink>
              <button className="btn btn-ghost btn-small reset-btn" type="button" onClick={() => void resetDemo()} title="Restore the demo data">
                Reset demo
              </button>
              {/* On a phone, the theme switch and reset fold into one overflow menu so the header stays on one row. */}
              <details className="more-menu" data-testid="more-menu">
                <summary className="btn btn-ghost btn-small" aria-label="More">
                  <span aria-hidden="true">&middot;&middot;&middot;</span>
                </summary>
                <div className="more-panel panel">
                  <NavLink className="btn btn-small more-story" to="/machine/call?story=1">
                    Demo the whole story
                  </NavLink>
                  <ThemeToggle />
                  <button className="btn btn-ghost btn-small" type="button" onClick={() => void resetDemo()}>
                    Reset demo
                  </button>
                </div>
              </details>
            </div>
          </div>
        </header>
        <nav className="machine-keys" aria-label="Machine">
          <div className="wrap keys-row">
            {KEYS.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className="key">
                <Icon />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
        <main id="main" className="wrap machine-main" tabIndex={-1}>
          {/* A new query (such as starting the whole story) starts the screen fresh. */}
          <Outlet key={location.search} />
        </main>
      </div>
    </MachineContext.Provider>
  );
}
