# SDK types & webhook events (`@freemius/sdk@0.3.0`)

Real TypeScript stumbles captured while building the reference app against
`@freemius/sdk@0.3.0`. Version-specific — re-check against your installed
version if it differs (`npm ls @freemius/sdk`).

## Entitlement `type` is `subscription | oneoff` (not `lifetime`)

**Symptom:** TS error
`Type '"lifetime"' is not assignable to type 'PurchaseEntitlementType'`, or a
runtime branch on `type === 'lifetime'` never matches.

**Root cause:** the entitlement record's `type` is the enum
`subscription | oneoff`. A one-time/lifetime purchase has `type: 'oneoff'` —
"lifetime" is a **billing cycle** on the checkout side, not an entitlement type.

**Fix:**

- Model the column as `enum FsEntitlementType { subscription, oneoff }` (see
  `freemius-core` → `references/entitlement-table.md`).
- Branch on `type === 'oneoff'`, never `'lifetime'`.
- On the checkout side, the one-off modality opens the overlay with
  `billing_cycle: 'lifetime'` — that string belongs to `@freemius/checkout`, not
  to the entitlement type. Don't conflate the two.

## `entitlement.getActive()` ignores one-off Lifetime licenses (still gated after buying Lifetime)

**Symptom:** a user upgrades to a one-off **Lifetime** plan. The invoice is
correct (payment happened), but in the app they are still treated as
un-entitled: Lifetime never shows as "active", the credits pack is still
offered, and metered features (e.g. OCR) keep charging page credits.
`getUserEntitlement()` returns `null` even though a valid Lifetime license
exists.

**Root cause:** `freemius.entitlement.getActive(rows)` (and `getActives`) filter
with `if (entitlement.type !== "subscription") return false;` — verify in
`node_modules/@freemius/sdk/dist/index.mjs` (`getActives`). A one-off purchase
is stored as `type: 'oneoff'` (`PurchaseInfo.toEntitlementRecord()` sets
`type: this.isSubscription() ? 'subscription' : 'oneoff'`, and a lifetime
license has no subscription). So **a one-off Lifetime row can never be returned
by `getActive()`.** If you pass all rows to `getActive()`, Lifetime is
invisible.

This bites hardest after a messy multi-step account state — e.g. a
**canceled-but-still-in-period** Pro subscription row plus a new Lifetime
one-off. Passing both rows to `getActive()` is also unsafe the other way: if the
canceled sub is not yet flagged canceled, `getActive()` can find it and
**throw** `"Multiple active entitlements found"`, which a try/catch in
`/api/entitlement` swallows into `null` — same visible symptom.

**Fix:** resolve one-offs yourself; let a valid non-credits one-off (Lifetime)
supersede a stale subscription row. Filter to `type: 'subscription'` _before_
calling `getActive()`, then fall back to a one-off lookup:

```ts
export async function getUserEntitlement(userId: string) {
  const rows = await db.userFsEntitlement.findMany({ where: { userId } });

  const subscription = freemius.entitlement.getActive(
    rows.filter((r) => r.type === 'subscription')
  );
  if (subscription) return subscription;

  const now = new Date();
  return (
    rows.find(
      (r) =>
        r.type === 'oneoff' &&
        !isCreditsPlan(r.fsPlanId) && // credits pack is a voucher, not an entitlement
        !r.isCanceled &&
        (r.expiration === null || r.expiration > now)
    ) ?? null
  );
}
```

The canonical version lives in `freemius-core` →
[`references/entitlement-logic.md`](../../freemius-core/references/entitlement-logic.md)
→ "Get the active entitlement". A related contributing cause is a **plan-id/env
mismatch**: if the purchased Lifetime plan id doesn't equal `LIFETIME_PLAN_ID`,
`planTier()` returns `null` and the user falls through to credits even once the
row is resolved — log loudly when a non-credits purchase maps to no tier (see
`freemius-core` → `references/purchase-processing.md`).

## There is no `license.quota.changed` event in this SDK version

**Symptom:** subscribing a listener to `license.quota.changed` is a no-op, or a
TS error that the event name is not assignable to `WebhookEventType`.

**Root cause:** `@freemius/sdk@0.3.0`'s `WebhookEventType` union does **not**
include `license.quota.changed`, even though the Dashboard webhook UI lists it.

**Fix:** subscribe only to the license events the SDK actually types:
`license.created`, `license.updated`, `license.extended`, `license.shortened`,
`license.cancelled`, `license.expired`, `license.plan.changed`, and (separately)
`license.deleted`. Quota changes that matter to you will arrive as a
`license.updated` re-fetch anyway, since every license event funnels through
`retrievePurchase` (one sync path). See `freemius-core` →
`references/webhooks.md`.

## Array-subscription `license` is a union that can be `false`

**Symptom:** TS error `Object is possibly 'false'` /
`Property 'id' does not exist on type 'false'` when reading `objects.license.id`
in a handler registered for an **array** of license events.

**Root cause:** when you subscribe one handler to an array of events, the
`license` object is typed as a union that includes the deleted-license shape
(`false`). The narrowing the SDK does for a single event name isn't available
for the array form.

**Fix:** guard with `license && license.id` before using it:

```ts
listener.on(LICENSE_EVENTS, async ({ objects: { license } }) => {
  if (license && license.id) {
    await syncEntitlementByLicenseId(license.id);
  }
});
```

Handle `license.deleted` in its own `listener.on('license.deleted', …)` using
`data.license_id` (different payload shape). See `freemius-core` →
`references/webhooks.md`.

## General approach for SDK type surprises

The SDK ships its own `.d.ts`. When a type doesn't match the docs (which are
Next.js/older-version flavored), trust the installed types: hover the symbol,
read `node_modules/@freemius/sdk/dist/*.d.ts`, and pin the version in the gate
pass protocol so the finding is reproducible.
