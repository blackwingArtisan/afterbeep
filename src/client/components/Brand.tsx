import { Link } from 'react-router-dom';

export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 34 22" aria-hidden="true">
      <rect x="1" y="1" width="32" height="20" rx="4" fill="none" stroke="var(--pumpkin)" strokeWidth="2" />
      <circle cx="10" cy="12" r="3.5" fill="var(--ink)" />
      <circle cx="24" cy="12" r="3.5" fill="var(--ink)" />
      <path d="M10 15.5h14" stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link className="brand" to={to} aria-label="AfterBeep home">
      <BrandMark />
      <span className="brand-word">
        After<b>Beep</b>
      </span>
    </Link>
  );
}
