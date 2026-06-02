import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAiLlmClient } from '@/lib/llm';
import type { FeedbackItem } from '@/lib/pdf';

const createMock = vi.fn();
vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat = { completions: { create: createMock } };
      constructor(_: unknown) {}
    },
  };
});

const ITEMS: FeedbackItem[] = [
  { id: 'fb_001', comment: 'Onboarding is confusing.' },
  { id: 'fb_002', comment: 'Pricing too high.' },
];

const GOOD_RESULT = {
  overallSummary: 'Mixed feedback; users dislike onboarding and pricing.',
  overallSentiment: 'negative',
  themes: [
    {
      name: 'Onboarding',
      description: 'Setup is confusing.',
      sentiment: 'negative',
      evidenceFeedbackIds: ['fb_001'],
    },
    {
      name: 'Pricing',
      description: 'Considered too expensive.',
      sentiment: 'negative',
      evidenceFeedbackIds: ['fb_002'],
    },
  ],
  recommendedActions: ['Simplify onboarding.', 'Introduce a startup tier.'],
  uncertaintyNotes: null,
};

beforeEach(() => {
  createMock.mockReset();
  process.env.OPENAI_API_KEY = 'sk-test';
});

describe('OpenAiLlmClient.analyze', () => {
  it('parses, validates, and returns the LLM output', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(GOOD_RESULT) } }],
    });
    const client = new OpenAiLlmClient();
    const out = await client.analyze(ITEMS);
    expect(out.overallSentiment).toBe('negative');
    expect(out.themes).toHaveLength(2);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it('throws on non-JSON content', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json at all' } }],
    });
    const client = new OpenAiLlmClient();
    await expect(client.analyze(ITEMS)).rejects.toThrow(/non-JSON/);
  });

  it('throws on schema-invalid content', async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify({ ...GOOD_RESULT, overallSentiment: 'happy' }) } },
      ],
    });
    const client = new OpenAiLlmClient();
    await expect(client.analyze(ITEMS)).rejects.toThrow(/schema validation/);
  });

  it('propagates upstream OpenAI errors', async () => {
    createMock.mockRejectedValueOnce(new Error('rate limit'));
    const client = new OpenAiLlmClient();
    await expect(client.analyze(ITEMS)).rejects.toThrow(/rate limit/);
  });

  it('filters out evidence IDs the model invented', async () => {
    const withFakeId = {
      ...GOOD_RESULT,
      themes: [
        { ...GOOD_RESULT.themes[0], evidenceFeedbackIds: ['fb_001', 'fb_999_fake'] },
        GOOD_RESULT.themes[1],
      ],
    };
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(withFakeId) } }],
    });
    const client = new OpenAiLlmClient();
    const out = await client.analyze(ITEMS);
    expect(out.themes[0].evidenceFeedbackIds).toEqual(['fb_001']);
  });

  it('refuses empty feedback list', async () => {
    const client = new OpenAiLlmClient();
    await expect(client.analyze([])).rejects.toThrow(/No feedback/);
  });
});
