# Purchase processing

After a customer pays, you must pull the authoritative purchase from Freemius
and upsert it into `user_fs_entitlement`. The **same** sync function serves
three callers: the hosted-checkout redirect, the overlay `success` callback, and
every webhook event ([webhooks.md](webhooks.md)).

## The one sync function

```ts
// src/services/freemius/entitlement.ts
import { type PurchaseInfo } from '@freemius/sdk';
import { freemius } from './client';
import { db } from '../../db'; // Prisma client

export async function findUserByEmail(email: string) {
  return db.user.findUnique({ where: { email } });
}

/** Upsert a Freemius purchase into the local entitlement mirror. Idempotent. */
export async function processPurchaseInfo(purchase: PurchaseInfo) {
  const user = await findUserByEmail(purchase.email);
  if (!user) {
    // User hasn't registered locally yet. Either skip or auto-provision.
    return;
  }

  await db.userFsEntitlement.upsert({
    where: { fsLicenseId: purchase.licenseId },
    update: purchase.toEntitlementRecord(),
    create: purchase.toEntitlementRecord({ userId: user.id }),
  });
}

/** Fetch the full purchase from Freemius by license id, then sync. */
export async function syncEntitlementByLicenseId(licenseId: string) {
  const purchase = await freemius.purchase.retrievePurchase(licenseId);
  if (purchase) {
    await processPurchaseInfo(purchase);
  }
}

export async function deleteEntitlement(fsLicenseId: string) {
  await db.userFsEntitlement
    .delete({ where: { fsLicenseId } })
    .catch(() => undefined); // tolerate already-deleted
}
```

`purchase.toEntitlementRecord()` returns the camelCase shape matching the Prisma
model. On `update` you omit `userId` (it never changes); on `create` you pass
it. The `@unique` on `fsLicenseId` makes concurrent webhook deliveries collapse
to one row (race-safe).

### Fail loudly on an unmapped plan id

If you map plan id → feature tier from env (`FREEMIUS_PLAN_ID`, `PRO_PLAN_ID`,
`LIFETIME_PLAN_ID`, …), a purchase whose plan id matches **none** of them is a
silent lost sale: the row upserts fine, but downstream `planTier()` resolves it
to `null`, so the paid user is gated as if they never bought anything (or falls
through to metered credits). This happens when a `*_PLAN_ID` env is stale or the
Dashboard plan id changed. Don't swallow it — log it so one `grep` finds it:

```ts
// inside processPurchaseInfo(), before the upsert (credits handled separately)
if (planTier(String(purchase.planId)) === null) {
  console.error(
    '[entitlement] purchased plan id',
    purchase.planId,
    'maps to NO tier — check *_PLAN_ID env vs the Freemius Dashboard. License',
    purchase.licenseId
  );
}
```

A one-off Lifetime is especially prone to this: it is a _different plan id_ from
the subscription tiers, so forgetting `LIFETIME_PLAN_ID` (or setting it to the
wrong value) makes a paid Lifetime user look un-entitled even after the
entitlement row itself resolves correctly (see
[entitlement-logic.md](entitlement-logic.md) → "Get the active entitlement").

## Hosted-checkout redirect handler

Freemius redirects the browser back to your configured URL with signed query
params. The SDK validates the signature and extracts the license id.

```ts
// src/services/freemius/checkout.ts (continued)
import type { CheckoutRedirectInfo } from '@freemius/sdk';
import { freemius } from './client';
import { syncEntitlementByLicenseId } from './entitlement';

// The public URL the user actually sees (used for signature verification).
const PUBLIC_URL = process.env.PUBLIC_APP_URL!;

export async function processCheckoutRedirect(requestUrl: string) {
  const info: CheckoutRedirectInfo = await freemius.checkout.processRedirect(
    requestUrl,
    PUBLIC_URL
  );
  if (info?.license_id) {
    await syncEntitlementByLicenseId(info.license_id);
  }
  return info;
}
```

```ts
// src/routes/checkout.ts (continued) — GET handler for the redirect
checkoutRoute.get('/redirect', async (c) => {
  try {
    await processCheckoutRedirect(c.req.url);
    return c.redirect(
      `${process.env.PUBLIC_APP_URL}/checkout-result?success=true`
    );
  } catch (err) {
    console.error('[checkout] redirect processing failed', err);
    return c.redirect(
      `${process.env.PUBLIC_APP_URL}/checkout-result?success=false`
    );
  }
});
```

> ⛔️ **The `/checkout-result` page is a REQUIRED frontend route — not just a
> server redirect target.** This GET handler bounces the browser to
> `/checkout-result?success=true|false`, but that path only exists on the server
> side of the redirect. If the SPA router (`App.tsx` `<Routes>`) has no
> `/checkout-result` route, the browser lands on a **blank page with only the
> nav/header** after a real payment (a symptom seen in testing: hosted
> Pro-upgrade → pay → blank `/checkout-result?success=true`). Ship a matching
> client page that: reads the `success` query param, **calls the app's
> entitlement refresh once on mount** (the server already synced in this
> handler, so one `GET /api/entitlement` reflects the new plan — no polling),
> shows a brief confirmation on success and a friendly "nothing was charged" on
> failure, and **routes the user back into the app** (e.g. buttons to `/ocr` /
> `/account`, or a "back to pricing" link on failure). Never leave the redirect
> landing on a bare shell.
>
> ```tsx
> // src/web/pages/CheckoutResultPage.tsx (sketch)
> const [params] = useSearchParams();
> const ok = params.get('success') === 'true';
> const ran = useRef(false);
> useEffect(() => {
>   if (ok && !ran.current) {
>     ran.current = true;
>     void refreshEntitlement();
>   }
> }, [ok, refreshEntitlement]);
> // ok  -> "<tier> unlocked" + buttons to /ocr and /account
> // !ok -> "Checkout didn't complete — nothing was charged" + back to /pricing
> ```
>
> This is the hosted-redirect counterpart to the overlay `purchaseCompleted` →
> `POST /api/purchase` sync ([webhooks.md](webhooks.md) and `freemius-checkout`
> cover the overlay side). A build that wires the server GET redirect but
> forgets the client route is incomplete.

### Signature gotcha behind a proxy

The signed redirect is computed against the **public** URL the customer saw, but
your server may observe a different internal URL (proxy/load balancer rewrites
host/scheme). If signature verification fails, reconstruct the URL by copying
the query string onto your public base before passing it to `processRedirect`:

```ts
const incoming = new URL(c.req.url);
const verifyUrl = new URL(PUBLIC_URL);
verifyUrl.search = incoming.search;
await freemius.checkout.processRedirect(verifyUrl.toString(), PUBLIC_URL);
```

## Overlay-checkout endpoint

When using the overlay, the frontend `success` callback POSTs the purchase
payload. Validate it, then sync by license id.

```ts
// src/routes/purchase.ts
import { Hono } from 'hono';
import { syncEntitlementByLicenseId } from '../services/freemius/entitlement';

export const purchaseRoute = new Hono();

purchaseRoute.post('/', async (c) => {
  const body = await c.req.json();
  const licenseId = body?.purchase?.license_id ?? body?.trial?.license_id;
  if (!licenseId) return c.text('Bad Request: missing license_id', 400);

  try {
    await syncEntitlementByLicenseId(String(licenseId));
    return c.text('Purchase recorded', 200);
  } catch (err) {
    console.error('[purchase] sync failed', err);
    return c.text('Internal Server Error', 500);
  }
});
```

Always log around these handlers — purchase/webhook bugs are otherwise
invisible.
