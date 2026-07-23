import { Hono } from 'hono';
import { requireUser } from '../middleware/auth';
import {
  createBaseCheckout,
  createCheckout,
  createUpgradeCheckout,
  getPricingData,
  processCheckoutRedirect,
} from '../services/freemius/checkout';
import { getUserEntitlement } from '../services/freemius/entitlement';
import { env } from '../env';

export const checkoutRoute = new Hono();

// Pricing-table data: subscription plans + one-off/top-up plans, each with prices
// and a per-plan checkout link. Drives the Subscribe and Topup tables.
checkoutRoute.get('/pricing', requireUser, async (c) => {
  const user = c.get('user');
  const pricing = await getPricingData({
    email: user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
  });
  return c.json(pricing);
});

// License-upgrade checkout for an already-subscribed user (plan change, NOT a
// new purchase). The upgrade path is a server-built license-upgrade checkout
// (a plain subscribe checkout would create a SECOND subscription):
// resolve the user's fsLicenseId from the entitlement mirror, fetch the
// license server-side, then setLicenseUpgradeByKey → hosted link.
checkoutRoute.get('/upgrade', requireUser, async (c) => {
  const user = c.get('user');
  const entitlement = await getUserEntitlement(user.id);
  if (!entitlement) {
    return c.json({ error: 'no_active_entitlement' }, 404);
  }

  const planId = c.req.query('planId') || undefined;
  const { link } = await createUpgradeCheckout(entitlement.fsLicenseId, planId);
  return c.json({ link });
});

// Base serialized checkout for the Starter Kit <CheckoutProvider> (user-scoped,
// sandbox flag, no plan locked in). GET so the provider can prime the overlay once.
checkoutRoute.get('/', requireUser, async (c) => {
  const user = c.get('user');
  const checkout = await createBaseCheckout({
    email: user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
  });
  return c.json(checkout);
});

// Create a server-side checkout for a specific plan. Returns the hosted link + overlay options.
checkoutRoute.post('/', requireUser, async (c) => {
  const user = c.get('user');
  const { planId } = await c.req
    .json<{ planId?: string }>()
    .catch(() => ({ planId: undefined }));

  const checkout = await createCheckout(
    {
      email: user.email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
    },
    planId
  );
  return c.json(checkout);
});

// Hosted-checkout redirect handler. Configure this URL in Dashboard → Plans → Customization.
checkoutRoute.get('/redirect', async (c) => {
  try {
    await processCheckoutRedirect(c.req.url);
    return c.redirect(`${env.publicAppUrl}/checkout-result?success=true`);
  } catch (err) {
    console.error('[checkout] redirect processing failed', err);
    return c.redirect(`${env.publicAppUrl}/checkout-result?success=false`);
  }
});
