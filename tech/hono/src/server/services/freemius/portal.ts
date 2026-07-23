import { freemius, IS_SANDBOX } from './client';
import { env } from '../../env';

// Customer Portal logic lives here, in a plain-TS service separate from the route.
// The SDK ships a *headless* Customer Portal: one server endpoint serves the portal
// data (subscriptions, billing, payments) and processes every portal action
// (upgrade, cancel + coupon, billing update, invoice download) behind signed,
// per-action tokens. See the freemius-customer-portal Skill.

// The absolute, public URL of the portal endpoint. The SDK bakes signed action
// URLs that point back here, so it must match what the browser actually hits.
const PORTAL_ENDPOINT = `${env.publicAppUrl}/api/portal`;

/**
 * Resolve the Freemius user id for a local email. The portal data + actions are
 * keyed by the Freemius user id, not our local user id.
 */
export async function getFreemiusUserId(email: string): Promise<string | null> {
  const fsUser = await freemius.api.user.retrieveByEmail(email);
  return fsUser?.id ? String(fsUser.id) : null;
}

/**
 * Process a Customer Portal request (data fetch or action) for the signed-in user.
 *
 * The SDK's request processor dispatches by the `?action=` query param:
 *   - GET  ?action=portal_data                  → subscriptions + billing + payments
 *   - POST ?action=billing                       → update billing information
 *   - POST ?action=subscription_cancellation     → cancel renewal (+ optional feedback)
 *   - POST ?action=subscription_cancellation_coupon → apply churn-reducing coupon
 *   - GET  ?action=invoice                        → stream the invoice PDF
 *
 * Every action URL is signed with a token the SDK issues inside the portal data,
 * so we only need to supply the authenticated user's Freemius id here.
 */
export async function processPortalRequest(
  request: Request,
  email: string
): Promise<Response> {
  const processor = freemius.customerPortal.request.createProcessor({
    portalEndpoint: PORTAL_ENDPOINT,
    isSandbox: IS_SANDBOX,
    getUser: async () => {
      const id = await getFreemiusUserId(email);
      return id ? { id, email } : { email };
    },
  });

  return processor(request);
}
