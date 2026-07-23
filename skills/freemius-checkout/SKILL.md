---
name: freemius-checkout
description:
  Build the customer-facing Freemius Checkout UI in a React app — the Checkout
  Provider (overlay context), Subscribe (subscription pricing table), Topup
  (one-off / credit pricing table), Paywall, and custom checkout buttons. Use
  when adding a pricing page, an "upgrade"/"buy credits" button, an overlay
  checkout, or a paywall to a React frontend. Covers the React Starter Kit
  Checkout components and the frontend Checkout SDK (`@freemius/checkout`), plus
  the thin checkout-specific backend endpoints the front end depends on (the
  purchase-sync `POST /api/purchase`, `GET /api/checkout/pricing`, and the
  hosted-redirect handler); the underlying checkout-creation and
  entitlement-sync engine still belongs to `freemius-core`.
---

# Freemius Checkout

Render pricing and open the Freemius Checkout overlay from a React frontend so a
user can buy **any** modality — a recurring **subscription** or a **one-off /
top-up (credit)** purchase — and have the result synced server-side.

Source: React Starter Kit Checkout components
<https://freemius.com/help/documentation/saas-sdk/react-starter/components/#checkout-components>

> **Framework note.** The examples in this Skill are Vite/Hono-flavored, but
> nothing here requires that stack: the server side (owned by `freemius-core`)
> works with any framework supporting Web-Standard `Request`/`Response` routing,
> and the React Starter Kit components target **React 19+ with shadcn UI +
> Tailwind** — install them via
> `npx shadcn@latest add https://shadcn.freemius.com/all.json`. If the app
> doesn't use shadcn/React, **download** the Starter Kit and use it as a
> **reference** to implement the same UI in the app's own framework. Prefer
> **reusing the application's existing components** (buttons, inputs, cards,
> dialogs) over re-creating primitives — port the Starter Kit's structure and
> behaviour onto the app's own design system rather than introducing new
> primitives.

> **Sandbox.** Build and validate in **sandbox mode** — a checkout mode that
> accepts test credit cards (not a discount; no coupon is needed or involved).
> It is wired to the dedicated `FREEMIUS_SANDBOX` env var (**never** `NODE_ENV`)
> and owned by `freemius-core` — the server-created checkout already carries the
> sandbox flag; this Skill inherits it.

## Golden rules (do not violate)

1. **The overlay is the only thing that runs in the browser.** It is primed with
   a _server-created_ serialized checkout (`checkout.serialize()` from
   `freemius-core`). The `secretKey`/`apiKey` never reach the client.
2. **The browser never trusts itself.** A successful overlay purchase fires a
   callback that POSTs the payload to your backend, which re-fetches the
   authoritative purchase from Freemius and upserts the entitlement. The paywall
   is enforced server-side (HTTP 402); the UI gate is only UX.
   - ⛔️ **The overlay sync and the hosted redirect are TWO SEPARATE endpoints
     with DIFFERENT payload contracts — never merge them.** The overlay
     `purchaseCompleted` callback POSTs a JSON body to a dedicated
     **`POST /api/purchase`**; that handler reads the `license_id` out of the
     overlay payload and calls `syncEntitlementByLicenseId(licenseId)`. The
     hosted return is a separate **`GET /api/checkout/redirect`** that runs
     `freemius.checkout.processRedirect(url, PUBLIC_URL)` on the **signed query
     string** (see `freemius-core` → purchase-processing). Do **NOT** route the
     overlay POST through `freemius.checkout.request.createProcessor(...)` /
     `processRedirect(...)`, and do **NOT** point `syncEndpoint` at
     `/api/checkout/redirect?action=process_purchase`. Those SDK paths expect a
     signed redirect / `license_id` in a shape the overlay payload does **not**
     provide — the POST then returns
     **`400 "License ID is required in the request body"`**, the frontend
     `.catch()` swallows it, and `user_fs_entitlement` stays **empty for every
     user** while the UI looks fine. (`createProcessor` belongs to the
     customer-portal headless endpoint, not to overlay purchase sync — don't
     borrow it here.)
3. **Pricing data comes from one server endpoint.** The frontend fetches plans +
   prices + per-plan checkout context from your backend
   (`GET /api/checkout/pricing`); it never calls the Freemius API directly.
4. **Cover every modality.** Subscriptions use a billing-cycle toggle
   (`monthly`/`annual`); one-off/top-up plans open the overlay with
   `billing_cycle: 'lifetime'`. Render both — don't hardcode the demo's
   subscription-only path.
5. **Never ask the maker to restate the subscription model.** The pricing tables
   **auto-fetch** plans + prices from `GET /api/checkout/pricing`, which is
   sourced from the Freemius Dashboard. The Dashboard is the single source of
   truth for plans/pricing — detect the modalities from that data (a
   lifetime-only plan → `Topup`; monthly/annual plans → `Subscribe`); don't
   hard-specify them in a build prompt or intake question.
6. **The app owns the post-purchase confirmation UX.** Open the overlay with
   `show_confirmation_dialog: false` (skip Freemius' confirmation modal) and
   show an in-app success state instead — see
   [In-app success message](#in-app-success-message-after-purchase). In the same
   `onPurchase` handler, hide the paywall and **clear any stale gate
   error/result** from the gated action's 402, then re-check entitlement —
   otherwise a "need subscription"/"upgrade" message lingers on the gated
   surface until reload.
7. **Purchase surfaces are entitlement-aware.** Never show a plain Subscribe
   button to an already-subscribed user (a plain subscribe checkout creates a
   **second parallel subscription** — double-billing); their path is the
   server-built **license-upgrade checkout** (license fetch +
   `setLicenseUpgradeByKey` — see `freemius-customer-portal`; not
   `checkout.create({ licenseId })`, which 500s for renewing licenses). Hide the
   credits top-up for active-unlimited subscribers; mark the owned plan; note or
   hide Lifetime for subscribers. See
   [references/pricing-tables.md](references/pricing-tables.md) →
   "Entitlement-aware rendering".

## The components

Port these as editable shadcn/ui-style React source (not an opaque package).
Each has a focused reference — read the one you need:

| Component          | What it does                                               | Reference                                                          |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `CheckoutProvider` | Holds one overlay instance; exposes `useCheckout()`        | [references/checkout-provider.md](references/checkout-provider.md) |
| `Subscribe`        | Subscription pricing table (monthly/annual toggle)         | [references/pricing-tables.md](references/pricing-tables.md)       |
| `Topup`            | One-off / credit pricing table (`lifetime` billing)        | [references/pricing-tables.md](references/pricing-tables.md)       |
| `Paywall`          | Overlay that shows the right table when a feature is gated | [references/paywall.md](references/paywall.md)                     |
| Custom buttons     | Any element that calls `useCheckout().open(...)`           | [references/custom-buttons.md](references/custom-buttons.md)       |

The Next.js→Vite/Hono porting surface (env vars, the `@`/`@shared` alias, the
two server endpoints) is in
[references/vite-hono-porting.md](references/vite-hono-porting.md).

## Quick start

### 1. Install the frontend SDK

```bash
npm install @freemius/checkout
```

### 2. Prime the provider with a server-created checkout

```tsx
// The base checkout is created server-side (freemius-core) and exposed at
// GET /api/checkout → { options, link, baseUrl }. Load it, then wrap the UI.
const checkout = await getBaseCheckout(); // CheckoutSerialized

<CheckoutProvider
  checkout={checkout}
  syncEndpoint="/api/purchase" // POST target for the success callback
  fetcher={portalFetch} // attaches auth headers
  onPurchase={refreshEntitlement} // re-fetch entitlement after success
>
  <Subscribe />
  <Topup />
</CheckoutProvider>;
```

### 3. Open the overlay for a chosen plan

```tsx
const checkout = useCheckout();

// Subscription (with billing cycle):
checkout.open({
  plan_id: planId,
  billing_cycle: 'annual',
  show_confirmation_dialog: false, // default — the app shows its own success state
});

// One-off / top-up (consumable credits):
checkout.open({
  plan_id: planId,
  billing_cycle: 'lifetime',
  show_confirmation_dialog: false,
});
```

`open()` merges your params over the base options and wires the
`purchaseCompleted` callback, which POSTs to `syncEndpoint`.

Default `show_confirmation_dialog: false` in every `open()` call (or bake it
into the provider): Freemius' own post-purchase confirmation modal is skipped in
favor of the app's success state — better UX, one dialog instead of two. Because
the Freemius dialog is off, the app **must** show its own confirmation (next
section).

## In-app success message (after purchase)

With `show_confirmation_dialog: false`, the app owns the confirmation UX on
**both** purchase paths:

- **Overlay path** — `purchaseCompleted` → the provider POSTs to `/api/purchase`
  (entitlement sync) → `onPurchase` fires. Use it to (1) re-fetch the
  entitlement/balance and (2) show a visible success state — a toast/banner like
  **"Purchase complete — premium unlocked"** (subscription) or **"Credits added
  to your account"** (top-up). Never complete a purchase silently.
- **Hosted-redirect path** — Freemius redirects back to your purchase-redirect
  handler (`freemius-core` → purchase-processing); its result page must render
  the same success message.

See [references/checkout-provider.md](references/checkout-provider.md) → "In-app
success message" for the wiring.

## Mental model

```
Server (freemius-core)              Frontend (this Skill)                 Freemius
  GET /api/checkout ───────────────▶ getBaseCheckout()
  { options, link, baseUrl } ──────▶ new Checkout(options,…) (one instance)
  GET /api/checkout/pricing ───────▶ <Subscribe/> + <Topup/> tables
                                      user clicks "Subscribe"/"Buy"
                                      useCheckout().open({plan_id, billing_cycle}) ─▶ overlay
                                      user pays ───────────────────────────────────▶ license/payment
  POST /api/purchase ◀────────────── purchaseCompleted(data) callback
  (re-fetch + upsert entitlement)
  402 on gated feature ────────────▶ <Paywall/> shows the right table
```

## Hosted-checkout fallback

If you can't load `@freemius/checkout` (or want the simplest path), every plan
in the pricing response also carries a hosted `checkoutLink`. Navigate the
browser to it; Freemius redirects back to your purchase-redirect handler
(handled in `freemius-core` → purchase-processing). Prefer the overlay for UX;
keep the link as a graceful degradation.

## Dashboard configuration (hand to the human)

In the Freemius Developer Dashboard (<https://dashboard.freemius.com/>):

- **Product → Plans** → define each plan and its pricing. A plan with only a
  **lifetime** price (no monthly/annual) renders in the `Topup` table; plans
  with monthly/annual prices render in `Subscribe`.
- **Top-up precondition:** the one-off/top-up modality only appears if a
  lifetime-only plan exists in the product. If the maker wants top-ups (or you
  need to demo/validate that modality), ask them to create one first — treat it
  as an intake/precondition question, and hide the `Topup` table gracefully when
  `oneoff` comes back empty.
- **Checkout → appearance / behaviour** → optional overlay branding.
- The webhook + redirect URL setup is owned by `freemius-core`.

Granting what a purchase entitles the user to (feature unlock, credit balance)
is server-side and owned by `freemius-core` — for top-up credits, follow
`freemius-core` → `entitlement-logic.md` → "Usage-based / credit metering
(top-up model)" (balance in a **separate user-keyed table**, never an extension
of `user_fs_entitlement`).
