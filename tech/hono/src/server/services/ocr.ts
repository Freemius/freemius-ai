import { Mistral } from '@mistralai/mistralai';
import { env } from '../env';

// Deliberately thin: one mistral-ocr-latest call. This is DocVault's paywalled feature.
const client = new Mistral({ apiKey: env.mistralApiKey });

/**
 * OCR a PDF (or image) supplied as a base64 data URL or a public URL, returning the
 * combined markdown text of all pages plus the page count (the credit-metering
 * cost unit: 1 credit per processed page).
 */
export async function ocrDocument(input: {
  /** base64 data URL (e.g. "data:application/pdf;base64,...") OR a public document URL */
  source: string;
  kind: 'document' | 'image';
}): Promise<{ text: string; pages: number }> {
  const document =
    input.kind === 'image'
      ? ({ type: 'image_url', imageUrl: input.source } as const)
      : ({ type: 'document_url', documentUrl: input.source } as const);

  const response = await client.ocr.process({
    model: 'mistral-ocr-latest',
    document,
  });

  const pages = response.pages ?? [];
  const text = pages
    .map((page) => page.markdown ?? '')
    .join('\n\n')
    .trim();

  // Cost basis for credit metering: at least 1 page per run.
  return { text, pages: Math.max(pages.length, 1) };
}
