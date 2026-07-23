import { env } from '../env';

// Plan-tier feature mapping — the ONE server-side place that translates a
// Freemius plan id into DocVault features (per the freemius-core Skill,
// references/entitlement-logic.md "Check access level": prefer fsPlanId /
// fsPricingId comparisons; never hardcode ids — they come from env).
//
//   Premium (default subscription tier) → unlimited PDF OCR only
//   Pro       (PRO_PLAN_ID)             → unlimited PDF + image OCR
//   Lifetime  (LIFETIME_PLAN_ID, oneoff)→ unlimited everything, forever
//   Credits   (CREDITS_PLAN_ID, oneoff) → NOT an entitlement tier — a metered
//                                         top-up voucher (PDF + image, per page)

export type PlanTier = 'premium' | 'pro' | 'lifetime';

/** Map an entitlement's plan id to its feature tier. Unknown/legacy plan ids
 *  fall back to the base 'premium' tier (PDF-only) — the safe default. */
export function tierForPlan(planId: string): PlanTier {
  const id = String(planId);
  if (env.plans.lifetimePlanId && id === env.plans.lifetimePlanId) {
    return 'lifetime';
  }
  if (env.plans.proPlanId && id === env.plans.proPlanId) {
    return 'pro';
  }
  return 'premium';
}

/** Image OCR is a Pro/Lifetime feature; Premium is PDF-only.
 *  (The credits path allows images too — it is metered, not tier-gated.) */
export function allowsImageOcr(tier: PlanTier): boolean {
  return tier === 'pro' || tier === 'lifetime';
}

/** The metered credits plan: its one-off license is a top-up voucher, not an
 *  unlimited entitlement — it must never pass the entitlement gate by itself. */
export function isCreditsPlan(planId: string): boolean {
  return Boolean(env.credits.planId) && String(planId) === env.credits.planId;
}
