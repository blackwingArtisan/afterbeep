import { z } from 'zod';

/** What a model may return for a voicemail. Validated before use; anything else falls back to rules. */
export const ModelExtractionSchema = z.object({
  callerName: z.string().trim().min(1).max(80).nullable(),
  callbackNumber: z.string().trim().max(32).nullable(),
  address: z.string().trim().max(160).nullable(),
  job: z.string().trim().min(1).max(120),
  jobCategory: z.enum([
    'water-heater', 'leak', 'drain', 'appliance', 'heating', 'cooling', 'roofing', 'electrical', 'general',
  ]),
  urgency: z.enum(['emergency', 'soon', 'routine']),
  summary: z.string().trim().min(1).max(300),
  language: z.enum(['en', 'es']).nullish(),
});

export type ModelExtraction = z.infer<typeof ModelExtractionSchema>;

/** JSON Schema handed to the model as a tool, so it answers in exactly this shape. */
export const extractionToolJsonSchema = {
  type: 'object',
  required: ['callerName', 'callbackNumber', 'address', 'job', 'jobCategory', 'urgency', 'summary'],
  properties: {
    callerName: { type: ['string', 'null'], description: "Caller's name as they said it, or null" },
    callbackNumber: { type: ['string', 'null'], description: 'Phone number they asked to be called on, digits only, or null' },
    address: { type: ['string', 'null'], description: 'Street address of the job, or null' },
    job: { type: 'string', description: 'Short job description, e.g. "Water heater: burst, flooding"' },
    jobCategory: {
      type: 'string',
      enum: ['water-heater', 'leak', 'drain', 'appliance', 'heating', 'cooling', 'roofing', 'electrical', 'general'],
    },
    urgency: {
      type: 'string',
      enum: ['emergency', 'soon', 'routine'],
      description: 'emergency = active water, gas, sparks, no heat; soon = wants today or tomorrow; routine otherwise',
    },
    summary: { type: 'string', description: 'One or two sentences the tradesperson reads before calling back, always in English' },
    language: { type: 'string', enum: ['en', 'es'], description: 'The language the caller spoke' },
  },
} as const;
