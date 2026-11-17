export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(iso),
  );
}

export function formatLongDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(iso),
  );
}

export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

/** "8 - 10 AM" when both ends share AM or PM, else "10 AM - 12 PM"; minutes only when not on the hour. */
export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  const start = formatTime(startIso, timeZone).replace(':00', '');
  const end = formatTime(endIso, timeZone).replace(':00', '');
  // Intl may separate the clock and AM/PM with a narrow no-break space; \s covers it.
  const [startClock, startHalf] = start.split(/\s/);
  const [, endHalf] = end.split(/\s/);
  return startHalf && startHalf === endHalf ? `${startClock} - ${end}` : `${start} - ${end}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `tel:+${digits.length === 10 ? `1${digits}` : digits}`;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}
