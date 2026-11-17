import type { Business, VoicemailExtraction } from '../../domain/types';

export interface ExtractionContext {
  callerId: string;
  business: Business;
}

export interface Extractor {
  readonly name: string;
  extract(transcript: string, ctx: ExtractionContext): Promise<VoicemailExtraction>;
}
