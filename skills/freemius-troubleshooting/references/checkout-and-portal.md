# Checkout & Customer Portal wiring

Stumbles specific to the frontend checkout overlay and the headless Customer
Portal, captured while wiring the reference app's UI.

## Symptom: a Freemius secret leaks to the browser / 401 from Freemius

**Root cause:** a Freemius call (checkout creation, portal data, purchase
retrieval, API reads) was made from client code. The `secretKey` / `apiKey` must
never reach the browser; if they do, you've both leaked a secret and will hit
auth errors when the client tries to call privileged endpoints.

**Fix:** every Freemius SDK/API call stays **server-side**. The browser only
ever receives:

- a server-created `CheckoutSerialized` (`{ options, link, baseUrl }`) to prime
  the overlay, and
- pricing data from `GET /api/checkout/pricing`, and
- portal data + **signed** action URLs from `GET /api/portal`.

See `freemius-core` → golden rules, and `freemius-checkout` →
`references/checkout-provider.md`.

## Symptom: checkout overlay opens empty or unconfigured

**Root cause:** the overlay was constructed client-side from raw options instead
of being primed with a **server-created** serialized checkout.

**Fix:** the base checkout is created server-side
(`freemius.checkout.create(...).serialize()`) and exposed at
`GET /api/checkout`. The provider loads that `CheckoutSerialized` once and
`open()` merges per-plan params over it. See `freemius-checkout` → quick start +
`checkout-provider.md`.

## Symptom: upgrade route 500s: "Payment method update is not allowed for lifetime licenses"

**Root cause:** the upgrade checkout was built with
`freemius.checkout.create({ licenseId })`. That option looks like the right
plan-change primitive, but in SDK ≤0.3.0 it internally POSTs
`licenses/{id}/checkout/link.json` with `is_payment_method_update: true`
(`getLicenseUpgradeAuth` → `retrieveCheckoutUpgradeAuthorization`) — a
**payment-method-update** authorization endpoint, not a general plan-change one.
The API rejects any license with `expiration: null` on that path with "Payment
method update is not allowed for lifetime licenses". An actively-renewing
subscription license has `expiration: null` (the subscription, not the license,
carries the renewal date), so it is misclassified as "lifetime" and the route
500s for exactly the users who should be able to upgrade.

**Fix:** use the same checkout builder but set the license key directly: fetch
the license server-side (`freemius.api.license.retrieve(fsLicenseId)` — the
entitlement mirror stores `fsLicenseId` but not the secret key), then
`checkout.setLicenseUpgradeByKey(license.secret_key)`. That sets `license_key`
on the checkout options with no restrictive authorization call; plan-picker and
`?planId=` variants both work. Keep the key server-side — it only leaves the
server inside the generated link returned to the authenticated owner. See
`freemius-customer-portal` → `references/subscription-and-upgrade.md`.

## Symptom: user "upgraded" but now has TWO subscriptions / is double-billed

**Root cause:** the upgrade was offered as a **plain subscribe checkout** — the
paywall or pricing page opened a regular `<Subscribe />` checkout
(`checkout.open({ plan_id })` without a license authorization) for a user who
**already has an active subscription**. Freemius treats that as a brand-new
purchase: it either creates a **second parallel subscription** (double-billing)
or hard-fails with "you are already on an active subscription."

**Fix (two parts):**

1. **Already subscribed → license-upgrade checkout, never plain subscribe.**
   Route the upgrade through the server route above (license fetch +
   `setLicenseUpgradeByKey`) so the checkout is a plan change of the existing
   license.
2. **Entitlement-aware purchase surfaces.** The pricing page / paywall must
   adapt to what the viewer already owns: mark the current plan as owned
   ("manage in Account") instead of a Subscribe button; hide the credits top-up
   for active-unlimited subscribers; note (or hide) Lifetime for active
   subscribers — buying it does NOT auto-cancel the running subscription. See
   `freemius-checkout` → `references/pricing-tables.md` ("Entitlement-aware
   rendering") and `references/paywall.md` (`tier_upgrade_required`).

## Symptom: portal actions 404 or fail token verification

**Root cause:** trying to split portal data and portal actions across multiple
endpoints, or calling Freemius directly from the component.

**Fix:** there is **one** endpoint — `GET|POST /api/portal`. The SDK's
`PortalRequestProcessor` serves the data (`?action=portal_data`) **and** every
token-signed action (cancel, coupon, billing update, invoice) through that same
endpoint, dispatching on `?action=`. `portalEndpoint` passed to the processor
must exactly match the public URL the browser hits (`PUBLIC_APP_URL/api/portal`)
or token verification fails. See `freemius-customer-portal` →
`references/headless-endpoint.md`.

## Symptom: a coupon'd subscription "renews" ~100 years out (e.g. `renews 26/06/2126`, `USD 0`)

**Root cause:** the test/discount coupon was created as **100% off** with the
discount scope set to **"First payment and renewals"** (not "First payment
only"). When _every_ renewal of a recurring plan is fully discounted to `0`,
Freemius has nothing to ever charge, so the next-renewal date is pushed far into
the future (~100 years). The portal then renders that date verbatim
(`renews <date>`), which looks like a bug but is the literal subscription state
returned by Freemius — there is **no date math in the app** (`renewalDate` from
the headless portal data is rendered as-is via `toLocaleDateString()`).

**Fix (dashboard, not code):** in the Freemius Dashboard → Coupons, set the
coupon's discount scope to **"First payment only"**. Renewals then bill normally
and the next-renewal date reads **+1 billing cycle** (e.g. +1 year for an annual
plan). Use 100%-off **"First payment and renewals"** only for permanently-free
comp licenses, and prefer it on one-off/top-up plans rather than recurring ones.

**Optional UI hardening:** if a demo must tolerate comp'd licenses, guard absurd
far-future renewal dates in the portal (e.g. render "no scheduled renewal" when
the date is decades out) instead of printing the raw 2126 date. The underlying
value is still Freemius's — the guard is cosmetic.

## Symptom: an admin-cancelled license leaves the subscription orphaned → re-subscribe is blocked + the portal label is misleading

**Root cause:** Freemius models the **license** (entitlement / access) and the
**subscription** (recurring billing agreement) as **independent** objects that
are cancellable separately, in both directions. A subscription cannot exist
without a license, but the two are **not auto-linked on cancel** — the dashboard
even prompts _"do you also want to cancel the associated license?"_ when you
cancel a subscription (for SaaS the recommended default is to **retain** the
license so it rides out its paid term).

When an admin cancels the **license directly** in the Freemius Dashboard (rather
than the subscription), the license goes `is_cancelled: true` with a past
expiration, so entitlement is correctly revoked (`getActive()` → `null`, the API
returns `402`). **But the subscription stays `active`/orphaned** — an admin
license-cancel never touches the subscription object. Two downstream symptoms:

1. **Re-subscribe is blocked.** When the same user tries to buy again, the
   Freemius checkout refuses with _"Sorry, you are already on an active
   subscription. You can update your plan in the billing section."_ — the
   orphaned active subscription blocks a fresh checkout.
2. **Misleading portal label.** The Customer Portal "Current subscription" card
   can still render the old cancelled subscription as _"Canceled — active until
   period end,"_ which is wrong once that period has passed or the subscription
   is superseded.

The **normal** real-world flow does _not_ hit this: the user-portal _"Cancel
auto-renew"_ cancels the **subscription**, the license then rides out its paid
term and expires naturally — no orphan, no block. Admin
direct-**license**-cancel is the unusual entry point that strands the
subscription. See the Freemius events/webhooks docs
(<https://freemius.com/help/documentation/saas/events-webhooks/>) and the
Freemius changelog entries _"New API endpoints to access and cancel
subscriptions from a license"_ and _"Smarter License Retention Guidance."_

**Fix:**

- To cleanly stop a customer's billing **and** access, cancel the
  **subscription**, not the license — via the customer portal _"Cancel
  subscription"_ **or** the API
  `DELETE https://api.freemius.com/v1/products/{productId}/licenses/{licenseId}/subscription.json`.
  The license then expires at period end (retention-by-default).
- If you are already in the orphaned-active-subscription state (re-subscribe
  blocked), cancel the leftover subscription too so the license and subscription
  states match. A fresh checkout then mints a new license + subscription pair.
- **Portal display:** a cancelled subscription should only be labelled _"active
  until period end"_ when its period-end is in the **future** _and_ there is no
  other active subscription; otherwise label it _"ended / expired."_ The
  reference app's `customer-portal.tsx` was fixed to do exactly this.

## Symptom: a one-off / lifetime purchase behaves wrong vs the subscription demo

**Root cause:** the subscription demo path doesn't cover one-off purchases — a
different modality (the Lovable FAQ calls this out explicitly).

**Fix:**

- Open the overlay with `billing_cycle: 'lifetime'` for one-off/top-up plans
  (render them in the `Topup` table, not `Subscribe`).
- The resulting entitlement has `type: 'oneoff'` (not `'lifetime'` — see
  `sdk-types-and-events.md`).
- A plan with only a lifetime price renders in `Topup`; plans with
  monthly/annual prices render in `Subscribe`. See `freemius-checkout` →
  `references/pricing-tables.md`.

## Symptom: a subscribed user still sees the paywall / 402 despite an active subscription, and `user_fs_entitlement` is empty

**Root cause:** the pricing page did a **bare hosted-checkout redirect**
(`window.location.href = link`) and never opened the Freemius overlay nor called
`processPurchase()` / `POST /api/purchase`. There are **two** in-app sync paths
that write the `user_fs_entitlement` row, and this code wired **neither**:

1. **Overlay `purchaseCompleted` callback** — the Freemius Checkout overlay
   (`@freemius/checkout`) fires `purchaseCompleted(data)` after a successful
   purchase. The frontend POSTs that payload to `POST /api/purchase`, which
   re-fetches the authoritative purchase from Freemius and upserts the
   entitlement. This syncs in-app **regardless of Dashboard config**.
2. **Dashboard hosted checkout-redirect URL + webhook** — the hosted redirect
   only syncs if **Dashboard → Plans → Customization → checkout-redirect URL**
   is configured, so Freemius redirects back to your handler (and/or the webhook
   fires) after payment.

A bare `window.location.href = link` opens the hosted checkout but, with **no**
Dashboard checkout-redirect URL set, nothing ever calls back into the app — so
**no `user_fs_entitlement` row is written**. The user pays, Freemius shows an
active subscription, but `getActive()` returns `null` and the API keeps
returning `402`: the user stays paywalled.

**Fix:**

- Wire the **overlay `purchaseCompleted` callback** as the primary in-app sync
  path: open the overlay with `@freemius/checkout`, and in `purchaseCompleted`
  POST the payload to `POST /api/purchase`. Do **not** rely on a bare hosted
  redirect for entitlement sync. See `freemius-core` → `references/checkout.md`
  (Frontend consumption) and `freemius-checkout` →
  `references/checkout-provider.md`.
- If you must use the hosted redirect, configure **Dashboard → Plans →
  Customization → checkout-redirect URL** so the purchase is synced on return.
  Treat this as a fallback to the overlay callback, not a substitute.
- **Verify:** after a sandbox purchase, confirm a row appears in
  `user_fs_entitlement` for the user. If it does not, the sync path is not wired
  — fix that before shipping.
