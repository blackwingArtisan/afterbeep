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
  { to: '/machine/prices', label: 'Prices', icon: BookIcon },
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
    <MachineContext.Provider value={{ business, newCount, refresh }}>
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
            <div className="row">
              <MessageCounter count={newCount} />
              <ThemeToggle />
              <NavLink className="btn btn-small story-btn" to="/machine/call?story=1">
                Demo the whole story
              </NavLink>
              <button className="btn btn-ghost btn-small reset-btn" type="button" onClick={() => void resetDemo()} title="Restore the demo data">
                Reset demo
              </button>
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
