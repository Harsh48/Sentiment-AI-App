import { z } from 'zod';

export const SentimentEnum = z.enum(['positive', 'neutral', 'mixed', 'negative']);
export type Sentiment = z.infer<typeof SentimentEnum>;

export const ThemeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  sentiment: SentimentEnum,
  evidenceFeedbackIds: z.array(z.string().min(1)).min(1),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const AnalysisResultSchema = z.object({
  overallSummary: z.string().min(1).max(800),
  overallSentiment: SentimentEnum,
  themes: z.array(ThemeSchema).min(1).max(7),
  recommendedActions: z.array(z.string().min(1).max(300)).min(1).max(7),
  uncertaintyNotes: z.string().max(600).nullable().optional(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const ANALYSIS_JSON_SCHEMA = {
  name: 'AnalysisResult',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      overallSummary: { type: 'string' },
      overallSentiment: { type: 'string', enum: ['positive', 'neutral', 'mixed', 'negative'] },
      themes: {
        type: 'array',
        minItems: 1,
        maxItems: 7,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            sentiment: { type: 'string', enum: ['positive', 'neutral', 'mixed', 'negative'] },
            evidenceFeedbackIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          },
          required: ['name', 'description', 'sentiment', 'evidenceFeedbackIds'],
        },
      },
      recommendedActions: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string' } },
      uncertaintyNotes: { type: ['string', 'null'] },
    },
    required: [
      'overallSummary',
      'overallSentiment',
      'themes',
      'recommendedActions',
      'uncertaintyNotes',
    ],
  },
} as const;
