/** Human time formats for texts, always in the business's own time zone. */

/** "Tue, Nov 17, 8:00 AM-10:00 AM", or in Spanish "martes, 17 de noviembre, de 8:00 a.m. a 10:00 a.m.". */
export function formatSlot(startIso: string, endIso: string, timeZone: string, language?: 'es'): string {
  if (language === 'es') {
    const day = new Intl.DateTimeFormat('es-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(startIso));
    const at = new Intl.DateTimeFormat('es-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    return `${day}, de ${at.format(new Date(startIso))} a ${at.format(new Date(endIso))}`;
  }
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(startIso),
  );
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time.format(new Date(startIso))}-${time.format(new Date(endIso))}`;
}

export function firstName(name: string | null): string {
  return name?.split(' ')[0] ?? 'there';
}
