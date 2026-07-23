import { Hono } from 'hono';
import { requireUser } from '../middleware/auth';
import { processPortalRequest } from '../services/freemius/portal';

export const portalRoute = new Hono();

// Headless Customer Portal endpoint. The freemius-customer-portal Skill drives the
// ported Starter Kit <CustomerPortal /> component, which fetches portal data and
// performs actions (upgrade, cancel + coupon, billing, invoices) against this one
// endpoint. All Freemius calls stay server-side; the SDK request processor handles
// dispatch + per-action token verification. Route stays thin: auth, then delegate.
portalRoute.on(['GET', 'POST'], '/', requireUser, async (c) => {
  const user = c.get('user');
  return processPortalRequest(c.req.raw, user.email);
});
