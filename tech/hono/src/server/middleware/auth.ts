import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { getUserEntitlement } from '../services/freemius/entitlement';
import { getCreditBalance } from '../services/credits';

// Prototype auth: the frontend sends the signed-in user's email in `x-user-email`.
// A real app replaces this with session/JWT auth. The user is auto-provisioned on
// first sight so the demo flow has a local user to attach entitlements to.
export type AuthUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    entitlement: Awaited<ReturnType<typeof getUserEntitlement>>;
    /** How the current request passed the paywall (set by requireSubscriptionOrCredits). */
    access: 'subscription' | 'credits';
  }
}

export const requireUser = createMiddleware(async (c, next) => {
  const email = c.req.header('x-user-email');
  if (!email) {
    return c.json({ error: 'unauthenticated' }, 401);
  }

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  c.set('user', {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  await next();
});

// Paywall: 402 unless the user has an active Freemius entitlement.
export const requireEntitlement = createMiddleware(async (c, next) => {
  const user = c.get('user');
  const entitlement = await getUserEntitlement(user.id);
  if (!entitlement) {
    return c.json({ error: 'subscription_required' }, 402);
  }
  c.set('entitlement', entitlement);
  await next();
});

// Credit-aware paywall for the OCR route: an active entitlement (subscription
// OR a lifetime one-off license — see getUserEntitlement) grants unlimited
// access (no credits consumed); otherwise the request needs at least
// `minCredits` on the balance (the route debits the actual page count after the
// work succeeds). 402 bodies distinguish the two failure modes so the frontend
// can offer the right pricing table: "no_subscription" (never bought anything →
// subscribe) vs "insufficient_credits" (had credits, ran out → top up).
export const requireSubscriptionOrCredits = (minCredits: number) =>
  createMiddleware(async (c, next) => {
    const user = c.get('user');

    const entitlement = await getUserEntitlement(user.id);
    if (entitlement) {
      c.set('entitlement', entitlement);
      c.set('access', 'subscription');
      return next();
    }

    const balance = await getCreditBalance(user.id);
    if (balance !== null && balance >= minCredits) {
      c.set('access', 'credits');
      return next();
    }

    if (balance === null) {
      // Never granted credits → primary offer is the subscription.
      return c.json({ error: 'no_subscription' }, 402);
    }
    return c.json({ error: 'insufficient_credits', balance }, 402);
  });
