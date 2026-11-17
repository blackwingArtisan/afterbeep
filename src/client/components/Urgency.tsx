import type { Urgency } from '../../domain/types';

const LABEL: Record<Urgency, string> = { emergency: 'Emergency', soon: 'Soon', routine: 'No rush' };

export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  return <span className={`chip chip-${urgency}`}>{LABEL[urgency]}</span>;
}
