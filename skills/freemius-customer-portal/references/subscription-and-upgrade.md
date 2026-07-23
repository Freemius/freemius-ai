# Subscription & upgrade

The portal data's `subscriptions` field has three buckets; render `active` and
`past` (and optionally highlight `primary`).

```ts
data.subscriptions = {
  primary: PortalSubscription | null,
  active: PortalSubscription[],
  past: PortalSubscription[],
};
```

## PortalSubscription (fields you render)

| Field                               | Use                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| `planTitle`, `billingCycle`         | "Pro (annual)"                                        |
| `renewalAmount`, `currency`         | price line                                            |
| `renewalDate`                       | "renews / ends <date>"                                |
| `isActive`                          | whether to show upgrade/cancel actions                |
| `cancelledAt`                       | non-null → "Canceled, active until period end"        |
| `cancelRenewalUrl`                  | signed POST target to cancel renewal                  |
| `applyRenewalCancellationCouponUrl` | signed POST target for the retention coupon (or null) |

## Rendering

A canceled subscription only keeps access **"until period end"** when (a) its
period hasn't ended yet **and** (b) no _other_ active subscription supersedes
it. Don't label every `cancelledAt` row "active until period end" — with two
canceled in-period rows that wrongly shows both as active. Pick a single
**winner** (the newest still-in-period canceled sub when there's no active sub);
everything else reads "Canceled — ended."

```tsx
function SubscriptionSection({ subscriptions, onUpgrade, onCancel }) {
  if (subscriptions.length === 0) return <p>No active subscription.</p>;

  const hasActiveSub = subscriptions.some((s) => s.isActive);
  const inPeriod = (s) =>
    s.renewalDate ? new Date(s.renewalDate).getTime() > Date.now() : false;

  // Only ONE canceled-in-period sub actually grants access until period end:
  // the newest (highest numeric subscriptionId), and only if nothing is active.
  const periodEndWinnerId = !hasActiveSub
    ? subscriptions
        .filter((s) => Boolean(s.cancelledAt) && inPeriod(s))
        .reduce(
          (win, s) =>
            win === null || Number(s.subscriptionId) > Number(win)
              ? s.subscriptionId
              : win,
          null
        )
    : null;

  return subscriptions.map((sub) => {
    const canceled = Boolean(sub.cancelledAt);
    const activeUntilPeriodEnd =
      canceled &&
      inPeriod(sub) &&
      !hasActiveSub &&
      sub.subscriptionId === periodEndWinnerId;
    return (
      <div key={sub.subscriptionId} className="portal-row">
        <div>
          <p>
            <strong>{sub.planTitle}</strong> ({sub.billingCycle ?? 'one-off'})
          </p>
          <p>
            {sub.currency?.toUpperCase()} {sub.renewalAmount}
            {sub.renewalDate &&
              ` · ${activeUntilPeriodEnd ? 'ends' : canceled ? 'ended' : 'renews'} ${new Date(sub.renewalDate).toLocaleDateString()}`}
          </p>
          {canceled && (
            <p>
              {activeUntilPeriodEnd
                ? 'Canceled — active until period end.'
                : 'Canceled — ended.'}
            </p>
          )}
        </div>
        {!canceled && sub.isActive && (
          <div className="portal-actions">
            <button onClick={() => onUpgrade(sub)}>
              Upgrade / change plan
            </button>
            <button onClick={() => onCancel(sub)}>Cancel subscription</button>
          </div>
        )}
      </div>
    );
  });
}
```

## Access state = license AND subscription (not the sub list alone)

The portal's `subscriptions` list is for **management UI**; it is **not** the
source of truth for "can this user use the product right now?". Access requires
an **active license AND an active (or in-period) subscription** — both. A
license can be cancelled while a subscription lingers (and vice-versa), so
derive the real gate from your `user_fs_entitlement` mirror via
`freemius-core`'s `getUserEntitlement()`, and show that as the headline state on
the Account page (e.g. "Premium — active", "Lifetime — active", vs. "No active
plan"). Render the subscription rows underneath for management. Never infer
access from a single `isActive` subscription flag in isolation.

> **A one-off Lifetime is not a subscription**, so it will **not** appear in the
> portal's `subscriptions` list at all (only the invoice/payment shows) — that
> is expected. The headline must therefore come from `getUserEntitlement()`
> (which resolves one-off Lifetime), **not** from the subscription list. And
> note `getUserEntitlement()` is more than
> `freemius.entitlement.getActive(rows)`: that helper only returns
> `type: 'subscription'` rows and never a one-off Lifetime — see `freemius-core`
> → `references/entitlement-logic.md`.

## Upgrade flow

The upgrade path is a **license-upgrade checkout built server-side**. It's the
robust path: it avoids the double-subscription pitfall (sending an
already-subscribed user to a plain subscribe checkout creates a second parallel
subscription) and the renewing-license 500 (see the note below).

> ⚠️ **`checkout.create({ licenseId })` looks right but 500s for
> actively-renewing licenses.** The `licenseId` option internally POSTs
> `licenses/{id}/checkout/link.json` with `is_payment_method_update: true` — a
> **payment-method-update** authorization endpoint, not a general plan-change
> one. The API rejects any license with `expiration: null` on that path
> ("Payment method update is not allowed for lifetime licenses"), and an
> actively-renewing subscription license has `expiration: null` — so it is
> misclassified as "lifetime" and rejected. Use `setLicenseUpgradeByKey`
> instead.

The working pattern is a **license-upgrade checkout built server-side**: a small
route resolves the user's `fsLicenseId` from the entitlement mirror
(`freemius-core`'s `getUserEntitlement()`), fetches the license server-side to
get its `secret_key` (the mirror does not store it), then builds a checkout and
calls `builder.setLicenseUpgradeByKey(license.secret_key)` — this sets
`license_key` directly on the checkout options, turning the checkout into a
**plan change** for that license, not a new purchase. Return `getLink()` (hosted
URL) or `serialize()` (overlay options carrying `license_key`) and have the
client navigate/open it:

```ts
// Server: GET /api/checkout/upgrade?planId=… (behind your auth middleware)
upgradeRoute.get('/upgrade', requireUser, async (c) => {
  const user = c.get('user');
  const entitlement = await getUserEntitlement(user.id);
  if (!entitlement) return c.json({ error: 'no_active_entitlement' }, 404);

  // Fetch the license server-side — the entitlement mirror has fsLicenseId
  // but not the license secret key.
  const license = await freemius.api.license.retrieve(entitlement.fsLicenseId);
  if (!license?.secret_key)
    return c.json({ error: 'license_unavailable' }, 502);

  const checkout = await freemius.checkout.create({
    planId: c.req.query('planId'), // optional: target plan
    isSandbox: IS_SANDBOX,
  });
  checkout.setLicenseUpgradeByKey(license.secret_key); // ← PLAN CHANGE, not new purchase

  return c.json({ link: checkout.getLink() });
});
```

```tsx
// Client: fetch the link, then navigate. Surface errors — never fail silently.
onUpgrade={async () => {
  try {
    const res = await fetcher('/api/checkout/upgrade');
    if (!res.ok) throw new Error(String(res.status));
    const { link } = await res.json();
    window.location.href = link;
  } catch {
    setError('Could not start the upgrade. Please try again.');
  }
}}
```

Rules:

- **Never render an upgrade button wired to a field that may not exist** — no
  silently dead buttons. Show the button whenever the subscription is active;
  wire it to the server route; surface fetch errors visibly.
- **Never send an already-subscribed user to a plain subscribe checkout** for an
  "upgrade" — that creates a **second parallel subscription** (double-billing)
  or hard-fails. `setLicenseUpgradeByKey` is what turns the checkout into a plan
  change.
- **Keep the license secret key server-side.** Fetch it in the route, set it on
  the builder, return only the link/options to the authenticated owner — never
  store it in the browser or expose it to other users.

The plan change arrives in your entitlement mirror as a `license.plan.changed`
webhook (`freemius-core`), so re-loading the portal — and the app's own premium
gate — reflects the new plan.

## Notes

- Show actions only when `isActive && !cancelledAt`.
- After any action, re-fetch `?action=portal_data` to reflect new state.
- Past/expired subscriptions render read-only for history.
- **If "Change plan" is a router `<Link>` (navigates to `/pricing`) instead of a
  `<button>`, style it so it matches the sibling Cancel button.** A shared
  button class that only inherits its padding / border-radius /
  `text-decoration: none` from a base `.btn` class (i.e. it's written to be used
  as `class="btn btn-outline"`) will render a **bare underlined link with no
  padding** when applied alone to an `<a>`/`<Link>` — the "Change plan" control
  looks broken next to the real Cancel button. Fix: make the outline/button
  class **self-contained** (its own
  `display:inline-block; padding; border-radius; text-decoration:none; font:inherit`)
  so it looks identical whether it wraps a `<button>` or an `<a>`, or apply BOTH
  the base and modifier classes to the `<Link>`.
