import { Hono } from 'hono';
import { requireUser, requireSubscriptionOrCredits } from '../middleware/auth';
import { ocrDocument } from '../services/ocr';
import { debitCredits, getCreditBalance } from '../services/credits';
import { tierForPlan, allowsImageOcr } from '../services/plans';
import { db } from '../db';
import type { OcrResult } from '@shared/types';

export const ocrRoute = new Hono();

// Paywalled feature: PDF/image -> OCR text via one mistral-ocr-latest call.
// Gate: active entitlement (subscription or lifetime one-off) = unlimited (no
// credits consumed); otherwise the run is metered against the user's credit
// balance (1 credit per processed page, debited atomically AFTER the work
// succeeds — a failed OCR run must not burn credits). No entitlement and
// no/insufficient credits → 402.
//
// Plan-tier feature mapping (services/plans.ts): Premium is PDF-only — image
// uploads on a Premium entitlement get a 403 { error: 'image_requires_pro' }
// the frontend routes to an upgrade hint. Pro and Lifetime allow images; the
// credits path allows images too (metered, not tier-gated).
ocrRoute.post('/', requireUser, requireSubscriptionOrCredits(1), async (c) => {
  const user = c.get('user');
  const access = c.get('access');
  const body = await c.req
    .json<{ filename?: string; source?: string; kind?: 'document' | 'image' }>()
    .catch(() => null);

  if (!body?.source) {
    return c.json({ error: 'missing_source' }, 400);
  }

  const kind = body.kind ?? 'document';

  // Tier gate — server-side and authoritative. Only the entitlement path is
  // tier-gated; a credits run may process images (it pays per page).
  if (kind === 'image' && access === 'subscription') {
    const entitlement = c.get('entitlement');
    if (entitlement && !allowsImageOcr(tierForPlan(entitlement.fsPlanId))) {
      return c.json({ error: 'image_requires_pro' }, 403);
    }
  }

  try {
    const { text, pages } = await ocrDocument({
      source: body.source,
      kind,
    });

    const doc = await db.document.create({
      data: {
        userId: user.id,
        filename: body.filename ?? 'document.pdf',
        text,
      },
    });

    // Metered path only: subscription users never consume credits.
    let creditBalance: number | null = null;
    if (access === 'credits') {
      await debitCredits(user.id, pages);
      creditBalance = await getCreditBalance(user.id);
    }

    const result: OcrResult = {
      documentId: doc.id,
      filename: doc.filename,
      text,
      pages,
      creditsUsed: access === 'credits' ? pages : 0,
      creditBalance,
    };
    return c.json(result);
  } catch (err) {
    console.error('[ocr] processing failed', err);
    return c.json({ error: 'ocr_failed' }, 500);
  }
});
