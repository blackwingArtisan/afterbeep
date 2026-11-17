import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import { spokenDigitsToText } from '../../domain/spoken-numbers';
import { formatPhone } from '../../domain/voicemail-rules';
import type { VoicemailExtraction } from '../../domain/types';
import { RuleExtractor } from './local';
import { extractionToolJsonSchema, ModelExtractionSchema } from './schema';
import type { ExtractionContext, Extractor } from './types';

/** The one client call this adapter makes; injectable so tests never reach the network. */
export interface ConverseClient {
  send(command: ConverseCommand): Promise<ConverseCommandOutput>;
}

export interface BedrockExtractorOptions {
  region: string;
  modelId: string;
  client?: ConverseClient;
}

const STREET_WORDS = new Set([
  'street', 'road', 'avenue', 'lane', 'drive', 'court', 'way', 'place', 'boulevard', 'circle', 'row', 'terrace',
  'trail', 'parkway', 'highway', 'apartment', 'unit', 'suite',
]);

/** True when the caller actually said these digits (directly or as spoken words). */
export function numberIsGrounded(number: string, transcript: string, callerId: string): boolean {
  const digits = number.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (digits.length < 7) return false;
  if (callerId.replace(/\D/g, '').endsWith(digits)) return true;
  const said = spokenDigitsToText(transcript).replace(/\D/g, '');
  return said.includes(digits.slice(-7));
}

/** True when the street name in the address appears in the transcript. */
export function addressIsGrounded(address: string, transcript: string): boolean {
  const said = transcript.toLowerCase();
  const names = address
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STREET_WORDS.has(w));
  return names.length > 0 && names.some((w) => said.includes(w));
}

const TOOL_NAME = 'record_voicemail';

/**
 * Amazon Bedrock extraction through the Converse API with a single forced tool, so the model can
 * only answer with the validated shape. Any failure falls back to the rule-based extractor: the
 * caller still gets a text back.
 */
export class BedrockExtractor implements Extractor {
  readonly name = 'bedrock';
  private readonly client: ConverseClient;
  private readonly fallback = new RuleExtractor();

  constructor(private readonly options: BedrockExtractorOptions) {
    this.client = options.client ?? new BedrockRuntimeClient({ region: options.region });
  }

  async extract(transcript: string, ctx: ExtractionContext): Promise<VoicemailExtraction> {
    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.options.modelId,
          system: [
            {
              text:
                `You read voicemails left for ${ctx.business.name}, a ${ctx.business.trade} business. ` +
                'Record the caller details with the tool. Use null for anything the caller did not say. Never guess an address or number.',
            },
          ],
          messages: [{ role: 'user', content: [{ text: `Caller ID: ${ctx.callerId}\nVoicemail transcript:\n${transcript}` }] }],
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: 'Record the structured details of one voicemail',
                  inputSchema: { json: extractionToolJsonSchema as unknown as ToolInputSchema.JsonMember['json'] },
                },
              },
            ],
            toolChoice: { tool: { name: TOOL_NAME } },
          },
          inferenceConfig: { maxTokens: 400, temperature: 0 },
        }),
      );
      const toolUse = response.output?.message?.content?.find((block) => block.toolUse)?.toolUse;
      const parsed = ModelExtractionSchema.parse(toolUse?.input);
      // The model may only report what the caller said. Anything it cannot point to in the
      // transcript is dropped rather than texted to a stranger or driven to.
      const callback =
        parsed.callbackNumber && numberIsGrounded(parsed.callbackNumber, transcript, ctx.callerId)
          ? parsed.callbackNumber
          : ctx.callerId;
      const address = parsed.address && addressIsGrounded(parsed.address, transcript) ? parsed.address : null;
      return { ...parsed, callbackNumber: formatPhone(callback), address, source: 'bedrock' };
    } catch {
      return this.fallback.extract(transcript, ctx);
    }
  }
}
