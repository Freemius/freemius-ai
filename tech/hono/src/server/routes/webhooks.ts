import { Hono } from 'hono';
import type { WebhookEventType } from '@freemius/sdk';
import { freemius } from '../services/freemius/client';
import {
  syncEntitlementByLicenseId,
  deleteEntitlement,
} from '../services/freemius/entitlement';

export const webhooksRoute = new Hono();

const LICENSE_EVENTS: WebhookEventType[] = [
  'license.created',
  'license.extended',
  'license.shortened',
  'license.updated',
  'license.cancelled',
  'license.expired',
  'license.plan.changed',
];

// Subscription-lifecycle events. Freemius fires these for subscription changes
// (e.g. a customer cancelling their subscription) — distinct from license.*
// events. Each payload carries the associated license object, so we re-sync the
// entitlement by license id to pull Freemius truth into the local cache.
// Only the event types that exist in the SDK's WebhookEventType are listed.
const SUBSCRIPTION_EVENTS: WebhookEventType[] = [
  'subscription.created',
  'subscription.cancelled',
  'subscription.renewal.failed',
  'subscription.renewal.failed.last',
];

// Freemius webhook listener — license-lifecycle sync. Configure this URL in
// Dashboard → Webhooks. The raw request must reach the SDK unmodified for
// signature verification, so we pass c.req.raw straight through.
webhooksRoute.post('/freemius', async (c) => {
  const listener = freemius.webhook.createListener();

  listener.on(LICENSE_EVENTS, async ({ objects: { license } }) => {
    if (license && license.id) {
      console.log('[webhook] license event', license.id);
      await syncEntitlementByLicenseId(license.id);
    }
  });

  listener.on('license.deleted', async ({ data }) => {
    console.log('[webhook] license.deleted', data.license_id);
    await deleteEntitlement(data.license_id);
  });

  listener.on(SUBSCRIPTION_EVENTS, async ({ type, objects: { license } }) => {
    if (license && license.id) {
      console.log('[webhook] subscription event', type, license.id);
      await syncEntitlementByLicenseId(license.id);
    }
  });

  return await freemius.webhook.processFetch(listener, c.req.raw);
});
