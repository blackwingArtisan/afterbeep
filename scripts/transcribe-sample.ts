/**
 * Transcribes one recording with Amazon Transcribe and prints what the rules extractor reads from it,
 * so the real speech-to-text path can be checked by ear and eye. One batch job costs about a cent
 * per minute of audio, so it needs AFTERBEEP_EVAL_PAID=1 and AWS credentials.
 *
 * Usage: AFTERBEEP_EVAL_PAID=1 tsx scripts/transcribe-sample.ts s3://your-bucket/voicemail.wav
 */
import { randomUUID } from 'node:crypto';
import { AwsTranscriber } from '../src/adapters/transcriber/aws';
import { extractWithRules } from '../src/domain/voicemail-rules';

const uri = process.argv[2];
if (!uri?.startsWith('s3://')) {
  console.error('Usage: tsx scripts/transcribe-sample.ts s3://bucket/key.wav');
  process.exit(2);
}
if (process.env.AFTERBEEP_EVAL_PAID !== '1') {
  console.error('This starts a paid Amazon Transcribe job. Set AFTERBEEP_EVAL_PAID=1 to run it.');
  process.exit(2);
}

const transcriber = new AwsTranscriber({ region: process.env.AWS_REGION ?? 'us-east-1', newJobName: () => `afterbeep-sample-${randomUUID()}` });
const started = Date.now();
const { text } = await transcriber.transcribe({ audioUri: uri });
console.log(`Transcript (${((Date.now() - started) / 1000).toFixed(1)} s):\n${text}\n`);
console.log(JSON.stringify(extractWithRules(text, { callerId: '+16145550100', defaultAreaCode: '614' }), null, 2));
