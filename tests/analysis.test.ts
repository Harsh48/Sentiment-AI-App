import { describe, it, expect } from 'vitest';
import { AnalysisResultSchema } from '@/lib/analysis';

const VALID = {
  overallSummary: 'Customers are split between liking integrations and disliking onboarding.',
  overallSentiment: 'mixed',
  themes: [
    {
      name: 'Onboarding friction',
      description: 'Several users find setup confusing.',
      sentiment: 'negative',
      evidenceFeedbackIds: ['fb_001', 'fb_006'],
    },
  ],
  recommendedActions: ['Improve onboarding flow.'],
  uncertaintyNotes: null,
};

describe('AnalysisResultSchema', () => {
  it('accepts a well-formed result', () => {
    const r = AnalysisResultSchema.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  it('rejects invalid sentiment value', () => {
    const bad = { ...VALID, overallSentiment: 'happy' };
    const r = AnalysisResultSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects themes with no evidence', () => {
    const bad = {
      ...VALID,
      themes: [{ ...VALID.themes[0], evidenceFeedbackIds: [] }],
    };
    const r = AnalysisResultSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects results with zero themes', () => {
    const bad = { ...VALID, themes: [] };
    const r = AnalysisResultSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
