# Server-side checkout creation

Create checkouts on the backend so you can scope them to the authenticated user,
pre-fill customer data, and apply plan/trial/discount logic without exposing
secrets.

## The service

```ts
// src/services/freemius/checkout.ts
import { freemius, IS_SANDBOX } from './client';

export type CheckoutUser = {
  email: string;
  firstName?: string;
  lastName?: string;
};

export async function createCheckout(user: CheckoutUser, planId?: string) {
  const checkout = await freemius.checkout.create({
    user,
    planId,
    isSandbox: IS_SANDBOX,
  });

  // serialize() returns both: the hosted `link` and the overlay `options`.
  return checkout.serialize(); // { link: string, options: object }
}
```

`freemius.checkout.create()` accepts at minimum a `user` with an `email` (plus
`name` or `firstName`/`lastName`). `planId` targets a specific plan; omit it to
let the customer choose on the checkout. `isSandbox` controls which mode the
checkout opens in — **sandbox mode accepts test credit cards**, so end-to-end
validation runs are free (no coupon needed; sandbox is a checkout mode, not a
discount). Drive it from a **dedicated `FREEMIUS_SANDBOX` env var, NOT from
`NODE_ENV`**: you deploy to a remote host (`NODE_ENV=production`) while still
validating in sandbox, so tying it to `NODE_ENV` would open the LIVE checkout by
mistake. Keep `isSandbox: true` (FREEMIUS_SANDBOX unset/`true`) while testing;
set `FREEMIUS_SANDBOX=false` only at go-live.

## The route (Hono)

Routes stay thin — auth, call service, respond.

```ts
// src/routes/checkout.ts
import { Hono } from 'hono';
import { createCheckout } from '../services/freemius/checkout';
import { requireUser } from '../middleware/auth';

export const checkoutRoute = new Hono();

checkoutRoute.post('/', requireUser, async (c) => {
  const user = c.get('user'); // { id, email, firstName?, lastName? }
  const { planId } = await c.req.json<{ planId?: string }>();

  const { link, options } = await createCheckout(
    { email: user.email, firstName: user.firstName, lastName: user.lastName },
    planId
  );

  return c.json({ link, options });
});
```

## Frontend consumption

Two modalities (both detailed further in the `freemius-checkout` Skill).
**Prefer the overlay path** — it syncs the entitlement in-app regardless of
Dashboard config. Treat the hosted redirect as a fallback.

- **Overlay checkout (recommended in-app sync path)** — pass `options` to the
  frontend Freemius Checkout SDK (`@freemius/checkout`) and call
  `checkout.open({ purchaseCompleted })`. The `purchaseCompleted` callback POSTs
  the purchase payload to your backend (`POST /api/purchase`), which re-fetches
  the authoritative purchase and upserts the entitlement row. This works even
  when no Dashboard checkout-redirect URL is configured.
- **Hosted checkout (fallback)** — redirect the browser to `link`. After payment
  Freemius redirects back to your configured redirect URL (handled in
  [purchase-processing.md](purchase-processing.md)), **only if** that URL is set
  in the Dashboard.

```ts
// Frontend (overlay): recommended — syncs in-app via the purchaseCompleted callback.
import { Checkout } from '@freemius/checkout';

// `options` + `baseUrl` come from the server-created checkout (serialize()).
const fs = new Checkout(options, false, baseUrl ?? null);

fs.open({
  plan_id: planId,
  billing_cycle: 'monthly',
  // Recommended default: skip Freemius' post-purchase confirmation modal —
  // the app shows its own success state, which is better UX.
  show_confirmation_dialog: false,
  // Fired after a successful checkout. POST the payload to the backend, which
  // re-fetches the purchase from Freemius and upserts `user_fs_entitlement`.
  purchaseCompleted: (data) => {
    void fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
});
```

```ts
// Frontend (hosted): fallback path, no extra SDK.
const res = await fetch('/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ planId }),
});
const { link } = await res.json();
window.location.href = link;
```

> ⚠️ The hosted redirect only syncs the entitlement if **Dashboard → Plans →
> Customization → checkout-redirect URL** is configured. Without either the
> overlay `purchaseCompleted` callback **or** that Dashboard URL, **no
> `user_fs_entitlement` row is written and the user stays paywalled despite an
> active subscription.** Prefer the overlay callback as the in-app sync path;
> treat the hosted redirect as a fallback.

## Pricing data (for a pricing page)

To render plans + prices + per-plan checkout links in one call:

```ts
const pricing = await freemius.api.product.retrievePricingData();
// pricing.plans[].pricing[].monthly_price / .annual_price, plan.title, plan.features, ...
```

Annual-as-discount: compute `(monthly*12 - annual) / (monthly*12)` for the "save
X%" badge. Add `?billing_cycle=monthly` to a checkout link to preselect monthly.
The full pricing-table builder (upgrade authorization, current-plan detection,
button text) belongs to the `freemius-checkout` Skill; for `freemius-core` the
single-plan `createCheckout` above is enough to prove the flow.
