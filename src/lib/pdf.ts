import pdfParse from 'pdf-parse';
import { extractText } from 'unpdf';

export type FeedbackItem = { id: string; comment: string };

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfParseError';
  }
}

export async function extractTextFromPdf(buf: Buffer): Promise<string> {
  let primaryErr: unknown;
  try {
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
    if (typeof text === 'string' && text.trim()) return text;
    primaryErr = new Error('unpdf returned empty text');
  } catch (err) {
    primaryErr = err;
  }
  try {
    const data = await pdfParse(buf);
    if (data.text && data.text.trim()) return data.text;
  } catch (err) {
    throw new PdfParseError(
      `Failed to parse PDF: ${(err as Error).message} (also tried unpdf: ${(primaryErr as Error).message})`,
    );
  }
  throw new PdfParseError(`Failed to parse PDF: ${(primaryErr as Error).message}`);
}

export function parseFeedback(text: string): FeedbackItem[] {
  if (!text || !text.trim()) return [];

  const HEADER = /Feedback\s*ID\s*:\s*(\S+)/gi;
  const matches: Array<{ id: string; idx: number; endOfHeader: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = HEADER.exec(text)) !== null) {
    matches.push({ id: m[1], idx: m.index, endOfHeader: HEADER.lastIndex });
  }

  const items: FeedbackItem[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const block = text.slice(cur.endOfHeader, next ? next.idx : text.length);

    const cm = block.match(/Comment\s*:\s*([\s\S]*)$/i);
    if (!cm) continue;

    const comment = cm[1].trim().replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    if (!comment) continue;

    items.push({ id: cur.id, comment });
  }

  return items;
}

export const MAX_PDF_BYTES = 2 * 1024 * 1024;
export const MIN_FEEDBACK = 1;
export const MAX_FEEDBACK = 50;
