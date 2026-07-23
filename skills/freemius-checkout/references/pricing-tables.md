# Pricing tables: Subscribe & Topup

Two tables, one data source. `Subscribe` renders recurring plans with a
monthly/annual toggle; `Topup` renders one-off / credit plans. Both open the
shared overlay via `useCheckout().open(...)`.

## The data source

The backend exposes `GET /api/checkout/pricing` returning a `PricingResponse`
split into the two modalities so each table renders independently:

```ts
export type PricingResponse = {
  subscription: PlanPricing[]; // monthly/annual recurring plans
  oneoff: PlanPricing[]; // lifetime-only (top-up / credit) plans
};
```

The server builds it from `freemius.pricing.retrieve()`: a plan with only a
`lifetime_price` (no monthly/annual) is classified `isOneOff` and routed to
`oneoff`; everything else goes to `subscription`. Annual discount is computed as
`(monthly*12 − annual) / (monthly*12)`. See `freemius-core` → `getPricingData`
for the server side.

## Subscribe (subscription modality)

```tsx
import { useEffect, useState } from 'react';
import type { PlanPricing } from '@shared/types';
import { getPricing, ApiError } from '../../api';
import { useCheckout } from './checkout-provider';

type Cycle = 'monthly' | 'annual';

export function Subscribe() {
  const checkout = useCheckout();
  const [plans, setPlans] = useState<PlanPricing[]>([]);
  const [cycle, setCycle] = useState<Cycle>('annual');

  useEffect(() => {
    getPricing()
      .then((r) => setPlans(r.subscription))
      .catch(() => {});
  }, []);

  return (
    <section>
      {/* monthly/annual toggle */}
      {plans.map((plan) => {
        const price = cycle === 'monthly' ? plan.monthly : plan.annual;
        return (
          <div className="card" key={plan.planId}>
            <h3>{plan.title}</h3>
            <p>
              <strong>${price}</strong>{' '}
              {cycle === 'monthly' ? '/ month' : '/ year'}
            </p>
            <button
              className="btn"
              onClick={() =>
                checkout.open({ plan_id: plan.planId, billing_cycle: cycle })
              }
            >
              Subscribe
            </button>
          </div>
        );
      })}
    </section>
  );
}
```

## Topup (one-off / credit modality)

Identical data fetch, but render `r.oneoff` and open the overlay in `lifetime`
billing mode. Render nothing if no one-off plans are configured.

> Selling the top-up is only half the job: Freemius sells the credits but does
> not meter consumption. Crediting the balance on purchase, gating on it, and
> decrementing as credits are used is your app's responsibility — see
> `freemius-core` → `entitlement-logic.md` → "Usage-based / credit metering
> (top-up model)".

```tsx
export function Topup() {
  const checkout = useCheckout();
  const [plans, setPlans] = useState<PlanPricing[]>([]);

  useEffect(() => {
    getPricing()
      .then((r) => setPlans(r.oneoff))
      .catch(() => {});
  }, []);

  if (plans.length === 0) return null; // no one-off plans → hide the table

  return (
    <section>
      {plans.map((plan) => (
        <div className="card" key={plan.planId}>
          <h3>{plan.title}</h3>
          <p>
            <strong>${plan.lifetime}</strong> one-time
          </p>
          <button
            className="btn"
            onClick={() =>
              checkout.open({ plan_id: plan.planId, billing_cycle: 'lifetime' })
            }
          >
            Buy now
          </button>
        </div>
      ))}
    </section>
  );
}
```

## Entitlement-aware rendering

Purchase surfaces must adapt to what the viewer **already owns** (from the app's
entitlement endpoint, e.g. `GET /api/entitlement`). Two hard failures this
prevents: a plain subscribe checkout shown to an already-subscribed user creates
a **second parallel subscription** (double-billing), and buying Lifetime does
**not** auto-cancel a running subscription (independent objects).

| Viewer state                                 | What to render                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No active entitlement                        | Full `Subscribe` + `Topup` tables (the plain path).                                                                                                        |
| Active subscription — this plan              | Mark the plan **owned** — "Current plan · manage in Account" instead of a Subscribe button.                                                                |
| Active subscription — other plan             | "Upgrade" button → **server license-upgrade checkout** (license fetch + `setLicenseUpgradeByKey` — see `freemius-customer-portal`), never plain Subscribe. |
| Active unlimited subscription — credits pack | **Hide/disable the credits top-up** — under the "subscription wins" gate their credits would never be consumed.                                            |
| Active subscription — Lifetime plan          | Hide it, or show a note: "replaces your subscription — cancel it after purchase" (buying it does NOT auto-cancel).                                         |
| Lifetime / unlimited holder                  | Nothing left to sell — **render a short "you own everything" empty-state, never a blank page** (see below).                                                |

Showing _prices_ to everyone is fine; it's the **buy buttons** that must be
entitlement-aware.

> ⛔️ **A Lifetime/unlimited holder must NOT see an empty pricing page.** When a
> viewer already owns the top tier (Lifetime), every purchase surface is
> correctly hidden — but hiding them all leaves a blank page that looks broken
> to the user (a real symptom seen in testing: "on /pricing nothing is shown
> anymore"). Render an explicit friendly empty-state instead, e.g.:
>
> ```tsx
> if (entitlement?.tier === 'lifetime') {
>   return (
>     <div className="card">
>       <h3>You're on Lifetime</h3>
>       <p className="muted">
>         You already have permanent full access — there's nothing to buy.
>         Manage your account in <a href="/account">Account</a>.
>       </p>
>     </div>
>   );
> }
> ```
>
> This is distinct from the credits-only viewer (no sub, no lifetime), who MUST
> still see BOTH the `Subscribe` and `Topup` tables — buying credits never
> removes the option to subscribe.

## Notes

- **A standalone pricing page is a required deliverable — don't skip it.** The
  integration MUST ship a dedicated pricing route (e.g. `/pricing`) that renders
  the `Subscribe` + `Topup` tables from `GET /api/checkout/pricing`, AND a
  visible nav link to it. It is separate from the paywall (which only appears on
  a gated action): a signed-out or free user must be able to browse plans and
  buy without first hitting a 402. A build that has a working paywall but no
  reachable pricing page is incomplete — verify the route exists and is linked
  before calling the checkout integration done.
- **The tables auto-fetch — never ask the maker for the pricing model.** Plans,
  prices, and modalities all come from the Dashboard via
  `GET /api/checkout/pricing`; a build prompt like "add a pricing page" is
  enough. Don't request plan lists, price points, or a subscription-vs-top-up
  decision that the pricing response already answers.
- **Billing cycle is the modality switch.** `monthly`/`annual` → subscription;
  `lifetime` → one-off. Pass it as `billing_cycle` to `open()`.
- **Show pricing to everyone, but make the buy buttons entitlement-aware**
  (previous section) — the server still decides what a purchase grants.
- **`plan_id`** comes from the pricing response, which is sourced from the
  Freemius dashboard — never hardcode plan IDs in the frontend.
