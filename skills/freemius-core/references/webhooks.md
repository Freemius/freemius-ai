# Webhook license-lifecycle sync

Billing state changes outside your app — renewals, cancellations, plan changes,
expirations, admin deletions. Webhooks are the **only** reliable way to keep
`user_fs_entitlement` correct. Skipping them means users keep access after
cancelling, or lose it despite an active subscription.

## The listener route (Hono)

```ts
// src/routes/webhooks.ts
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

webhooksRoute.post('/freemius', async (c) => {
  const listener = freemius.webhook.createListener();

  // For array subscriptions the `license` object is typed as a union that can be
  // `false` (the deleted shape), so guard with `license && license.id`.
  listener.on(LICENSE_EVENTS, async ({ objects: { license } }) => {
    if (license && license.id) {
      await syncEntitlementByLicenseId(license.id);
    }
  });

  // license.deleted carries a different payload shape — handle separately.
  listener.on('license.deleted', async ({ data }) => {
    await deleteEntitlement(data.license_id);
  });

  // Verifies the signature, dispatches matching events, returns a 2xx Response.
  return await freemius.webhook.processFetch(listener, c.req.raw);
});
```

`freemius.webhook.processFetch(listener, request)` does signature verification,
event dispatch, and builds the HTTP response for you on Fetch-based runtimes
(Hono, serverless). Authentication method defaults appropriately; pass
`{ authenticationMethod: WebhookAuthenticationMethod.Api }` to
`createListener()` if your dashboard is configured for API-token auth.

## Why every event funnels through `retrievePurchase`

For all the license-\* events except deletion, we ignore the event payload
details and just re-fetch the authoritative purchase by license id
(`syncEntitlementByLicenseId`). This keeps one sync code path, avoids drift
between event shapes, and is naturally idempotent thanks to the `fsLicenseId`
upsert.

`license.deleted` is the exception: there is no purchase to retrieve, so we
delete the local row using `data.license_id`.

## Respond fast, process safely

Freemius retries on non-2xx. `processFetch` returns promptly. If you add heavy
work, do it inside the event handlers (which `processFetch` awaits) but keep
them lean — the retrieve+upsert is already light. Log inside each handler so
failures are debuggable:

```ts
listener.on(LICENSE_EVENTS, async ({ objects: { license } }) => {
  console.log('[webhook] license event', license?.id);
  if (license?.id) await syncEntitlementByLicenseId(license.id);
});
```

## Raw body matters

Signature verification needs the **unmodified raw body**. On Hono, `c.req.raw`
is the original `Request` — pass it straight to `processFetch`. Do not
read/JSON-parse the body before handing it to the listener, or verification will
fail.

## Dashboard setup (human step)

In the Freemius Developer Dashboard → **Product → Webhooks**, add the public URL
of this route (`https://<your-domain>/api/webhooks/freemius`) and subscribe to:
`license.created`, `license.updated`, `license.extended`, `license.shortened`,
`license.cancelled`, `license.expired`, `license.plan.changed`,
`license.quota.changed`, `license.deleted`.

> **Propagation timing.** After setting the webhook URL in the Dashboard, allow
> a few minutes for it to become active; events fired before the URL is active
> are **not** delivered (and not retro-sent). When validating, trigger the
> lifecycle change **after** confirming the URL is live, or use the Dashboard's
> **resend** on the existing event — otherwise a missed early event looks
> exactly like a broken handler.
