import { Hono } from 'hono';
import { requireUser } from '../middleware/auth';
import { getUserEntitlement } from '../services/freemius/entitlement';
import { getCreditBalance } from '../services/credits';
import type { EntitlementDTO } from '@shared/types';

export const entitlementRoute = new Hono();

// Read-only entitlement + credit-balance check for UI gating (Free vs Premium,
// credit badge). Not a security boundary — the authoritative gate is the
// paywall middleware on protected routes.
entitlementRoute.get('/', requireUser, async (c) => {
  const user = c.get('user');
  const [e, creditBalance] = await Promise.all([
    getUserEntitlement(user.id),
    getCreditBalance(user.id),
  ]);

  const dto: EntitlementDTO = e
    ? {
        fsLicenseId: e.fsLicenseId,
        fsPlanId: e.fsPlanId,
        fsPricingId: e.fsPricingId,
        type: e.type as 'subscription' | 'oneoff',
        expiration: e.expiration ? new Date(e.expiration).toISOString() : null,
        isCanceled: e.isCanceled,
      }
    : null;

  // creditBalance is null when the user never had credits granted.
  return c.json({ entitlement: dto, creditBalance });
});
