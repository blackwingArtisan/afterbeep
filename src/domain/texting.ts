import { toE164 } from './voicemail-rules';

/**
 * Texting rules. A caller can reply STOP to any text and is never texted again until they reply
 * START; HELP gets the business name and phone number. The keywords are the common carrier set,
 * matched only when the whole reply is the keyword, so "please don't stop by before 5" is not an
 * opt-out. AWS End User Messaging keeps its own opt-out list as well; this one also covers the
 * local outbox, so the demo behaves like production.
 */
export type TextKeyword = 'stop' | 'help' | 'start';

const KEYWORDS: Record<string, TextKeyword> = {
  STOP: 'stop',
  STOPALL: 'stop',
  UNSUBSCRIBE: 'stop',
  CANCEL: 'stop',
  END: 'stop',
  QUIT: 'stop',
  OPTOUT: 'stop',
  REVOKE: 'stop',
  PARAR: 'stop',
  HELP: 'help',
  INFO: 'help',
  AYUDA: 'help',
  START: 'start',
  UNSTOP: 'start',
};

/** The keyword a reply is, or null for an ordinary reply. Case, spacing and punctuation are ignored. */
export function textKeyword(body: string): TextKeyword | null {
  const word = body
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return KEYWORDS[word] ?? null;
}

/** The line every first text ends with, in the caller's language. */
export function optOutLine(language?: 'es'): string {
  return language === 'es' ? 'Responda STOP para no recibir más textos.' : 'Reply STOP to opt out.';
}

/** Numbers are compared in E.164 so (614) 555-0134 and +16145550134 are the same caller. */
export function normalizeNumber(phone: string): string {
  return toE164(phone) ?? phone;
}

export function isOptedOut(db: { optOuts?: readonly string[] }, phone: string): boolean {
  return (db.optOuts ?? []).includes(normalizeNumber(phone));
}

export function keywordReply(keyword: TextKeyword, business: { name: string; phone: string }): string {
  switch (keyword) {
    case 'stop':
      return `${business.name}: you're opted out and won't get more texts from us. Reply START to opt back in.`;
    case 'start':
      return `${business.name}: you're opted back in. Reply STOP to opt out.`;
    case 'help':
      return `${business.name}: texts about your service call. Call ${business.phone} for help. Reply STOP to opt out.`;
  }
}
