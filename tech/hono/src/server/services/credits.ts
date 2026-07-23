import { db } from '../db';
import { env } from '../env';

// Credit metering for the top-up model. Freemius sells the top-up plan and
// grants a license; counting consumption is entirely the app's job. The balance
// lives in the separate user-keyed `user_credit` table — NOT in
// user_fs_entitlement (that mirror tracks licenses and is overwritten on every
// webhook re-sync; the balance is a running total that must survive license
// changes and stack across top-ups). See the freemius-core Skill,
// references/entitlement-logic.md ("Usage-based / credit metering").

/**
 * How many credits a plan grants — resolved server-side, keyed by plan id.
 * Simplest honest option: an env-configured map (CREDITS_PLAN_ID →
 * CREDITS_PER_PURCHASE). A production app can instead model the quota as a plan
 * feature in the Freemius Dashboard and read it from the retrieved plan.
 */
export function creditsForPlan(planId: string): number {
  if (!env.credits.planId) return 0; // credits demo not configured
  return String(planId) === env.credits.planId ? env.credits.perPurchase : 0;
}

/**
 * Current balance, or null when the user has never been granted credits (no
 * row). The null case lets the paywall distinguish "never bought credits →
 * offer subscription" from "had credits, ran out → offer top-up".
 */
export async function getCreditBalance(userId: string): Promise<number | null> {
  const row = await db.userCredit.findUnique({ where: { userId } });
  return row?.credit ?? null;
}

/** Grant credits on a top-up purchase. Top-ups STACK — increment, never overwrite. */
export async function grantCredits(
  userId: string,
  amount: number,
  client: Pick<typeof db, 'userCredit'> = db
): Promise<void> {
  await client.userCredit.upsert({
    where: { userId },
    update: { credit: { increment: amount } },
    create: { userId, credit: amount },
  });
}

/**
 * Debit after the metered work succeeded. The conditional UPDATE (credit >= cost)
 * is atomic, so two parallel calls cannot both pass and drive the balance
 * negative. If the balance no longer covers the cost (e.g. a multi-page run on
 * a 1-credit balance), clamp to zero — the work already succeeded, never store
 * a negative balance.
 */
export async function debitCredits(
  userId: string,
  cost: number
): Promise<void> {
  const updated = await db.userCredit.updateMany({
    where: { userId, credit: { gte: cost } },
    data: { credit: { decrement: cost } },
  });
  if (updated.count === 0) {
    await db.userCredit.updateMany({
      where: { userId, credit: { gt: 0 } },
      data: { credit: 0 },
    });
  }
}
