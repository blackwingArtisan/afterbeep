import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { TranscriptionError, type Transcriber, type TranscriptionInput } from './types';

export interface AwsTranscriberOptions {
  region: string;
  /** Poll interval and overall budget for a batch job (voicemails are short). */
  pollMs?: number;
  timeoutMs?: number;
  newJobName: () => string;
}

/** Amazon Transcribe batch job over the call recording Amazon Connect stored in S3. */
export class AwsTranscriber implements Transcriber {
  readonly name = 'amazon-transcribe';
  private readonly client: TranscribeClient;

  constructor(private readonly options: AwsTranscriberOptions) {
    this.client = new TranscribeClient({ region: options.region });
  }

  async transcribe(input: TranscriptionInput) {
    if (input.transcript?.trim()) return { text: input.transcript.trim(), provider: 'device' };
    if (!input.audioUri) throw new TranscriptionError('No recording to transcribe');

    const jobName = this.options.newJobName();
    await this.client.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: 'en-US',
        Media: { MediaFileUri: input.audioUri },
      }),
    );

    const deadline = Date.now() + (this.options.timeoutMs ?? 90_000);
    while (Date.now() < deadline) {
      const { TranscriptionJob: job } = await this.client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
      );
      if (job?.TranscriptionJobStatus === 'FAILED') {
        throw new TranscriptionError(job.FailureReason ?? 'Transcription failed');
      }
      const uri = job?.Transcript?.TranscriptFileUri;
      if (job?.TranscriptionJobStatus === 'COMPLETED' && uri) {
        const body = (await (await fetch(uri)).json()) as {
          results?: { transcripts?: Array<{ transcript?: string }> };
        };
        const text = body.results?.transcripts?.map((t) => t.transcript ?? '').join(' ').trim();
        if (!text) throw new TranscriptionError('The recording had no speech');
        return { text, provider: this.name };
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.pollMs ?? 1500));
    }
    throw new TranscriptionError('Transcription timed out');
  }
}
