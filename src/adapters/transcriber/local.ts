import { TranscriptionError, type Transcriber, type TranscriptionInput } from './types';

/** Uses the transcript the browser produced. Free, instant, and deterministic for tests. */
export class PassThroughTranscriber implements Transcriber {
  readonly name = 'local';
  async transcribe(input: TranscriptionInput) {
    const text = input.transcript?.trim();
    if (!text) {
      throw new TranscriptionError(
        'The local transcriber needs a transcript. Set AFTERBEEP_TRANSCRIBER=aws to transcribe recordings.',
      );
    }
    return { text, provider: this.name };
  }
}
