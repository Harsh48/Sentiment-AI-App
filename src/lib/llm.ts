import OpenAI from 'openai';
import { AnalysisResultSchema, ANALYSIS_JSON_SCHEMA, type AnalysisResult } from './analysis';
import type { FeedbackItem } from './pdf';

const SYSTEM_PROMPT = `You are an analyst summarizing customer feedback.

Rules:
- Be faithful to the source. Do not invent feedback IDs that are not present.
- Every theme must cite at least one real feedback ID drawn from the input.
- "overallSentiment" reflects the document as a whole, not any single comment.
- Return between 1 and 7 themes total (hard cap: never more than 7). Aim for 3–7 when the input supports it; collapse near-duplicates aggressively.
- Recommended actions must be concrete and grounded in the feedback.
- If the input is sparse, ambiguous, or you are uncertain about something, say so in "uncertaintyNotes". Otherwise set it to null.
- Output must match the provided JSON schema exactly.`;

function buildUserPrompt(items: FeedbackItem[]): string {
  const lines = items.map((f) => `- [${f.id}] ${f.comment}`);
  return `Analyze the following ${items.length} customer feedback responses:\n\n${lines.join('\n')}`;
}

export interface LlmClient {
  analyze(items: FeedbackItem[]): Promise<AnalysisResult>;
}

export class OpenAiLlmClient implements LlmClient {
  private client: OpenAI;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    this.client = new OpenAI({ apiKey });
    this.model = opts?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  async analyze(items: FeedbackItem[]): Promise<AnalysisResult> {
    if (items.length === 0) throw new Error('No feedback items to analyze');

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(items) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: ANALYSIS_JSON_SCHEMA,
      },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty content');

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`LLM returned non-JSON content: ${(err as Error).message}`);
    }

    const result = AnalysisResultSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`LLM output failed schema validation: ${result.error.message}`);
    }

    const validIds = new Set(items.map((i) => i.id));
    for (const theme of result.data.themes) {
      theme.evidenceFeedbackIds = theme.evidenceFeedbackIds.filter((id) => validIds.has(id));
    }
    return result.data;
  }
}
