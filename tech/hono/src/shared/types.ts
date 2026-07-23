// Shared types used by both the Hono backend and the React frontend.

/** A single pricing option within a plan (one billing cycle / tier). */
export type PlanPrice = {
  pricingId: string;
  /** Recurring monthly price, if the plan is billed monthly. */
  monthly: number | null;
  /** Recurring annual price, if the plan is billed annually. */
  annual: number | null;
  /** One-time / lifetime price, if the plan is a one-off (top-up) purchase. */
  lifetime: number | null;
};

export type PlanPricing = {
  planId: string;
  pricingId: string | null;
  title: string;
  description: string | null;
  monthly: number | null;
  annual: number | null;
  /** One-off / lifetime price for top-up (consumable) plans, or null. */
  lifetime: number | null;
  /** Percentage saved choosing annual over monthly, or null if not computable. */
  annualDiscount: number | null;
  /** True when this plan has no recurring price (a one-off / top-up plan). */
  isOneOff: boolean;
  /** True when this is the consumable credits top-up plan (server-resolved
   *  from CREDITS_PLAN_ID) — hidden for viewers with an active unlimited
   *  entitlement, whose credits would never be consumed. */
  isCredits: boolean;
  /** Hosted-checkout link (fallback when the overlay SDK is unavailable). */
  checkoutLink: string;
  features: { title: string; value: string | null }[];
};

export type PricingResponse = {
  /** Recurring (subscription) plans. */
  subscription: PlanPricing[];
  /** One-off / top-up (consumable) plans. */
  oneoff: PlanPricing[];
};

/**
 * Server-created checkout, ready to prime the Starter Kit <CheckoutProvider>.
 * Mirrors the SDK's `checkout.serialize()` output. `options` is left structurally
 * loose here so the shared module stays free of SDK-package coupling; the provider
 * casts it to the `@freemius/checkout` `CheckoutOptions` when instantiating.
 */
export type CheckoutSerialized = {
  options: Record<string, unknown>;
  link: string;
  baseUrl: string;
};

export type EntitlementDTO = {
  fsLicenseId: string;
  fsPlanId: string;
  fsPricingId: string;
  type: 'subscription' | 'oneoff';
  expiration: string | null;
  isCanceled: boolean;
} | null;

export type OcrResult = {
  documentId: string;
  filename: string;
  text: string;
  /** Pages processed by this run (the credit-metering cost unit). */
  pages: number;
  /** Credits debited for this run (0 for subscription users). */
  creditsUsed: number;
  /** Balance after the run, or null when access was subscription-based. */
  creditBalance: number | null;
};
