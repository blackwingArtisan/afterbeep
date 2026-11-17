/** Human time formats for texts, always in the business's own time zone. */

export function formatSlot(startIso: string, endIso: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(startIso),
  );
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time.format(new Date(startIso))}-${time.format(new Date(endIso))}`;
}

export function firstName(name: string | null): string {
  return name?.split(' ')[0] ?? 'there';
}
