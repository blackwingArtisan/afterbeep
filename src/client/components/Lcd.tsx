export function MessageCounter({ count, label = 'NEW' }: { count: number; label?: string }) {
  const digits = String(Math.min(count, 99)).padStart(2, '0');
  return (
    <span className="lcd" role="status" aria-label={`${count} new messages`}>
      <span className={`led ${count > 0 ? 'blink' : 'off'}`} aria-hidden="true" />
      <span className="ghost-digits" aria-hidden="true">
        <span className="digits" data-testid="lcd-count">
          {digits}
        </span>
      </span>
      <span aria-hidden="true" style={{ fontSize: 18 }}>
        {label}
      </span>
    </span>
  );
}
