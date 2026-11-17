export interface TranscriptionInput {
  /** Text already transcribed on the device (Web Speech API) or a sample script. */
  transcript?: string;
  /** Location of a recorded call, e.g. the S3 URI Amazon Connect wrote the recording to. */
  audioUri?: string;
}

export interface Transcription {
  text: string;
  provider: string;
}

export interface Transcriber {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<Transcription>;
}

export class TranscriptionError extends Error {}
