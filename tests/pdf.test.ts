import { describe, it, expect } from 'vitest';
import { parseFeedback } from '@/lib/pdf';

const SAMPLE = `Acme Widget Co. - Q2 Survey (SAMPLE DATA)
Fictional feedback for evaluation only.

Feedback ID: fb_001
Comment: The onboarding was confusing and I could not figure out how to invite my team.

Feedback ID: fb_002
Comment: The product is powerful, but pricing feels too high for a small startup.

Feedback ID: fb_003
Comment: I love the Slack integration - it saved our team hours each week.
`;

describe('parseFeedback', () => {
  it('extracts feedback items from sample text', () => {
    const items = parseFeedback(SAMPLE);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      id: 'fb_001',
      comment: 'The onboarding was confusing and I could not figure out how to invite my team.',
    });
    expect(items[2].id).toBe('fb_003');
  });

  it('handles multi-line comments', () => {
    const txt = `Feedback ID: fb_a
Comment: line one
line two continues here

Feedback ID: fb_b
Comment: short.
`;
    const items = parseFeedback(txt);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('fb_a');
    expect(items[0].comment).toContain('line one');
    expect(items[0].comment).toContain('line two continues here');
    expect(items[1].comment).toBe('short.');
  });

  it('returns empty array on empty / unrelated text', () => {
    expect(parseFeedback('')).toEqual([]);
    expect(parseFeedback('just some random text\nwith no markers')).toEqual([]);
  });

  it('skips headers that lack a Comment line', () => {
    const txt = `Feedback ID: fb_x
Feedback ID: fb_y
Comment: only y has a comment.
`;
    const items = parseFeedback(txt);
    expect(items).toEqual([{ id: 'fb_y', comment: 'only y has a comment.' }]);
  });

  it('is case-insensitive on the header tokens', () => {
    const txt = `feedback id: FB_1\ncomment: hi`;
    const items = parseFeedback(txt);
    expect(items).toEqual([{ id: 'FB_1', comment: 'hi' }]);
  });
});
