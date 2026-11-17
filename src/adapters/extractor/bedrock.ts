import { BedrockRuntimeClient, ConverseCommand, type ToolInputSchema } from '@aws-sdk/client-bedrock-runtime';
import { formatPhone } from '../../domain/voicemail-rules';
import type { VoicemailExtraction } from '../../domain/types';
import { RuleExtractor } from './local';
import { extractionToolJsonSchema, ModelExtractionSchema } from './schema';
import type { ExtractionContext, Extractor } from './types';

export interface BedrockExtractorOptions {
  region: string;
  modelId: string;
}

const TOOL_NAME = 'record_voicemail';

/**
 * Amazon Bedrock extraction through the Converse API with a single forced tool, so the model can
 * only answer with the validated shape. Any failure falls back to the rule-based extractor: the
 * caller still gets a text back.
 */
export class BedrockExtractor implements Extractor {
  readonly name = 'bedrock';
  private readonly client: BedrockRuntimeClient;
  private readonly fallback = new RuleExtractor();

  constructor(private readonly options: BedrockExtractorOptions) {
    this.client = new BedrockRuntimeClient({ region: options.region });
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
      return {
        ...parsed,
        callbackNumber: parsed.callbackNumber ? formatPhone(parsed.callbackNumber) : formatPhone(ctx.callerId),
        source: 'bedrock',
      };
    } catch {
      return this.fallback.extract(transcript, ctx);
    }
  }
}
