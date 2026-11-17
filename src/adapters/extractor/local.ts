import { extractWithRules } from '../../domain/voicemail-rules';
import type { ExtractionContext, Extractor } from './types';

export function areaCodeOf(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.slice(0, 3);
}

/** Deterministic rule-based extraction. Free, offline, and the fallback for the model path. */
export class RuleExtractor implements Extractor {
  readonly name = 'rules';
  async extract(transcript: string, ctx: ExtractionContext) {
    return extractWithRules(transcript, {
      callerId: ctx.callerId,
      defaultAreaCode: areaCodeOf(ctx.business.phone),
    });
  }
}
