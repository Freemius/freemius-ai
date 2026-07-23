import type { CheckoutRedirectInfo, CheckoutSerialized } from '@freemius/sdk';
import { freemius, IS_SANDBOX } from './client';
import { env } from '../../env';
import { syncEntitlementByLicenseId } from './entitlement';
import { isCreditsPlan } from '../plans';
import type { PlanPricing, PricingResponse } from '@shared/types';

export type CheckoutUser = {
  email: string;
  firstName?: string;
  lastName?: string;
};

/** Create a server-side checkout scoped to the user. Returns hosted link + overlay options. */
export async function createCheckout(user: CheckoutUser, planId?: string) {
  // planId may be undefined (customer chooses on the checkout); the SDK accepts that.
  const checkout = await freemius.checkout.create({
    user,
    planId,
    isSandbox: IS_SANDBOX,
  } as Parameters<typeof freemius.checkout.create>[0]);

  return checkout.serialize(); // { options, link, baseUrl }
}

/**
 * Build a LICENSE-UPGRADE checkout for an already-subscribed user, so the
 * checkout is a PLAN CHANGE of the existing license — not a new purchase.
 * (This server-built checkout is the upgrade path. A plain subscribe checkout
 * here would create a SECOND subscription.)
 *
 * ⚠️ Do NOT use `checkout.create({ licenseId })` for this: in SDK ≤0.3.0 that
 * option internally POSTs `licenses/{id}/checkout/link.json` with
 * `is_payment_method_update: true` — a payment-method-update authorization,
 * not a general plan-change one. The API rejects actively-renewing licenses
 * on that path ("Payment method update is not allowed for lifetime licenses")
 * and the route 500s. Instead we fetch the license server-side (the secret
 * key is not stored in the local entitlement mirror) and pre-fill it with
 * `setLicenseUpgradeByKey`, which sets `license_key` directly on the checkout
 * options. Server-side only — the key never reaches the browser except inside
 * the generated checkout link for the authenticated owner.
 */
export async function createUpgradeCheckout(
  fsLicenseId: string,
  planId?: string
): Promise<{ link: string }> {
  const license = await freemius.api.license.retrieve(fsLicenseId);
  if (!license?.secret_key) {
    throw new Error(
      `Failed to retrieve license ${fsLicenseId} for upgrade checkout`
    );
  }

  const checkout = await freemius.checkout.create({
    planId,
    isSandbox: IS_SANDBOX,
  } as Parameters<typeof freemius.checkout.create>[0]);

  checkout.setLicenseUpgradeByKey(license.secret_key);

  return { link: checkout.getLink() };
}

/**
 * Build a base serialized checkout for the Starter Kit <CheckoutProvider>. It is
 * scoped to the user (email pre-filled, sandbox flag) but not to a specific plan;
 * the Subscribe/Topup/Paywall components set the plan when they open the overlay.
 */
export async function createBaseCheckout(
  user: CheckoutUser
): Promise<CheckoutSerialized> {
  return createCheckout(user);
}

/**
 * Build pricing-table data split into subscription plans and one-off/top-up plans,
 * each with prices and a per-plan hosted checkout link. The split lets the frontend
 * render the Subscribe table and the Topup table separately (both checkout
 * modalities), per the freemius-checkout Skill.
 */
export async function getPricingData(
  user: CheckoutUser
): Promise<PricingResponse> {
  const productPricing = await freemius.pricing.retrieve();
  const subscription: PlanPricing[] = [];
  const oneoff: PlanPricing[] = [];

  for (const plan of productPricing?.plans ?? []) {
    if (plan.is_hidden) continue;
    if (!plan.pricing?.length) continue; // free plan, nothing to sell

    const pricing = plan.pricing[0];
    const monthly = pricing?.monthly_price ?? null;
    const annual = pricing?.annual_price ?? null;
    const lifetime = pricing?.lifetime_price ?? null;

    let annualDiscount: number | null = null;
    if (annual != null && monthly != null) {
      const annualIfMonthly = monthly * 12;
      if (annualIfMonthly > 0) {
        annualDiscount = Math.round(
          ((annualIfMonthly - annual) / annualIfMonthly) * 100
        );
      }
    }

    // A plan with only a lifetime price (no recurring monthly/annual) is a
    // one-off / top-up purchase rather than a subscription.
    const isOneOff = monthly == null && annual == null && lifetime != null;

    const checkout = await createCheckout(user, plan.id!);

    const mapped: PlanPricing = {
      planId: plan.id!,
      pricingId: pricing?.id ?? null,
      title: plan.title!,
      description: plan.description ?? null,
      monthly,
      annual,
      lifetime,
      annualDiscount,
      isOneOff,
      isCredits: isCreditsPlan(plan.id!),
      checkoutLink: checkout.link,
      features:
        plan.features?.map((f) => ({
          title: f.title!,
          value: f.value ?? null,
        })) ?? [],
    };

    (isOneOff ? oneoff : subscription).push(mapped);
  }

  return { subscription, oneoff };
}

/**
 * Handle the hosted-checkout redirect. The SDK validates the signature against the
 * public URL the user actually saw, then we sync the entitlement.
 */
export async function processCheckoutRedirect(
  requestUrl: string
): Promise<CheckoutRedirectInfo | null> {
  // Verify against the public app URL (handles proxy host/scheme rewrites).
  const incoming = new URL(requestUrl);
  const verifyUrl = new URL(env.publicAppUrl);
  verifyUrl.pathname = '/api/checkout/redirect';
  verifyUrl.search = incoming.search;

  const info = await freemius.checkout.processRedirect(
    verifyUrl.toString(),
    env.publicAppUrl
  );

  if (info?.license_id) {
    await syncEntitlementByLicenseId(info.license_id);
  }
  return info;
}
