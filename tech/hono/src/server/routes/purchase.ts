import { Hono } from 'hono';
import { syncEntitlementByLicenseId } from '../services/freemius/entitlement';

export const purchaseRoute = new Hono();

// Overlay-checkout success callback. The frontend POSTs the purchase payload here.
purchaseRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const licenseId = body?.purchase?.license_id ?? body?.trial?.license_id;
  if (!licenseId) {
    return c.text('Bad Request: missing license_id', 400);
  }

  try {
    await syncEntitlementByLicenseId(String(licenseId));
    return c.text('Purchase recorded', 200);
  } catch (err) {
    console.error('[purchase] sync failed', err);
    return c.text('Internal Server Error', 500);
  }
});
