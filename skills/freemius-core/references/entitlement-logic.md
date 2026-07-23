# Entitlement logic — gating features

Once the entitlement mirror is in sync, gate access with a single helper.

## Get the active entitlement

> ⚠️ **`freemius.entitlement.getActive()` only ever returns a `subscription`
> row.** Its filter hard-excludes one-offs
> (`if (entitlement.type !== "subscription") return false;` — SDK
> `dist/index.mjs`, `getActives`). So if you sell a **one-off Lifetime** plan
> and pass all rows to `getActive()`, the Lifetime license is invisible: the
> user shows as un-entitled, the paywall re-gates them, credits get charged, and
> the plan never appears as active. Resolve one-offs yourself.

```ts
// src/services/freemius/entitlement.ts (continued)
import { freemius } from './client';
import { db } from '../../db';
import { isCreditsPlan } from '../plans';

// Two kinds of row unlock the app, and the SDK helper only sees one of them:
//  - subscriptions  → freemius.entitlement.getActive() (type 'subscription' only)
//  - one-off LIFETIME licenses (type 'oneoff') → resolve ourselves.
// The one-off CREDITS plan is deliberately excluded: its license is a metered
// top-up voucher (tracked by the credit balance), not an unlimited entitlement —
// it must never pass the paywall by itself.
export async function getUserEntitlement(userId: string) {
  const rows = await db.userFsEntitlement.findMany({ where: { userId } });

  // An active subscription wins (portal/upgrade flows attach to it)…
  const subscription = freemius.entitlement.getActive(
    rows.filter((r) => r.type === 'subscription')
  );
  if (subscription) return subscription;

  // …otherwise a valid non-credits one-off (Lifetime) is the entitlement, and it
  // supersedes any stale (canceled-in-period) subscription row still on file.
  const now = new Date();
  return (
    rows.find(
      (r) =>
        r.type === 'oneoff' &&
        !isCreditsPlan(r.fsPlanId) &&
        !r.isCanceled &&
        (r.expiration === null || r.expiration > now)
    ) ?? null
  );
}
```

`freemius.entitlement.getActive(rows)` encapsulates the subscription validity
rules (expiration + cancellation) so you never re-implement them — but **filter
to `type: 'subscription'` before calling it** (it ignores one-offs anyway, and
passing a lifetime one-off + a canceled sub can make it throw "Multiple active
entitlements"). Pass the DB rows directly when using Prisma (camelCase already
matches via `@map`). With raw SQL, map snake_case → camelCase first.

> **If you only sell subscriptions** (no one-off/Lifetime plan), the one-off
> branch is dead code — drop it and just
> `return freemius.entitlement.getActive(rows.filter(r => r.type === 'subscription'))`.
> Add the one-off branch the moment you introduce a Lifetime plan.

> **One subscription per user.** The `getActive()` call assumes the product is
> configured in the Freemius Developer Dashboard to allow **only one
> subscription per user** — it **throws** if it finds more than one active
> subscription row. If the app lets a user hold **multiple** subscriptions, use
> `freemius.entitlement.getActives(rows)` instead and map the multiple active
> entitlements to features yourself.

## Check access level

Prefer `fsPricingId` to distinguish tiers — it is unique per plan+cycle.

```ts
export function hasActiveEntitlement(entitlement: unknown): boolean {
  return Boolean(entitlement);
}

export function hasPricing(
  entitlement: { fsPricingId?: string } | null,
  pricingId: string
) {
  return entitlement?.fsPricingId === pricingId;
}

export function hasPlan(
  entitlement: { fsPlanId?: string } | null,
  planId: string
) {
  return String(entitlement?.fsPlanId) === String(planId);
}
```

## Protect a route / paywalled feature

Return HTTP **402 Payment Required** when access is denied — it is the
semantically correct status for a missing entitlement and easy for the frontend
to branch on.

```ts
// src/middleware/paywall.ts
import { createMiddleware } from 'hono/factory';
import { getUserEntitlement } from '../services/freemius/entitlement';

export const requireEntitlement = createMiddleware(async (c, next) => {
  const user = c.get('user');
  const entitlement = await getUserEntitlement(user.id);
  if (!entitlement) {
    return c.json({ error: 'subscription_required' }, 402);
  }
  c.set('entitlement', entitlement);
  await next();
});
```

```ts
// usage
ocrRoute.post('/', requireUser, requireEntitlement, async (c) => {
  /* premium feature runs only for entitled users */
});
```

## Frontend entitlement check

Expose a tiny read endpoint the frontend can poll on load to flip UI between
"Free" and "Premium":

```ts
// GET /api/entitlement → { entitlement: Entitlement | null }
entitlementRoute.get('/', requireUser, async (c) => {
  const entitlement = await getUserEntitlement(c.get('user').id);
  return c.json({ entitlement });
});
```

Never trust the frontend check for security — it only drives UI. The
authoritative gate is the server-side `requireEntitlement` middleware on the
protected route.

## Usage-based / credit metering (top-up model)

> **Freemius sells, your app meters.** Freemius processes the top-up purchase
> (e.g. "1000 OCR pages") and grants a license — it does **not** count how many
> pages you actually consume. Metering the balance is entirely your app's
> responsibility. Implement it following the golden rules: all server-side,
> never trust the client, the balance lives in your DB.

The flow reuses the existing pieces — only a balance and a decrement are new:

```
Freemius checkout (top-up plan)  ──▶  license.created  ──▶  processPurchaseInfo()
                                                              upsert entitlement
                                                              + credit balance += planCredits   (top-ups STACK)
metered request  ──▶  requireCredits gate (balance >= cost? else 402)
                  ──▶  run work  ──▶  on success: balance -= pagesProcessed (atomic)
```

### 1. Track the balance separately from the entitlement table

The credit balance is **not** part of `user_fs_entitlement`
([entitlement-table.md](entitlement-table.md)) — do not extend that table. The
entitlement mirror tracks _licenses_ (per `fsLicenseId`, overwritten on every
webhook re-sync); the balance is a _user-level running total_ that must survive
license changes and stack across top-ups. Track it **keyed by user**: the
simplest form is a single integer on the user (or a small one-row-per-user
balance table):

```prisma
model User {
  // ...existing fields
  credit Int @default(0) // credited on top-up purchase, debited on use
}
```

If you need an audit trail (who spent what, when, refunds), prefer a separate
ledger and derive the balance as the sum of its rows:

```prisma
model CreditLedger {
  id        String   @id @default(cuid())
  userId    String
  delta     Int // +1000 on top-up grant, -3 on a 3-page OCR run
  reason    String // 'topup:license.created' | 'ocr' | 'refund'
  createdAt DateTime @default(now())

  @@index([userId])
  @@map("credit_ledger")
}
```

Pick one: a single user-level `credit` column is enough for most makers; a
ledger is worth it when you need history. Don't build both.

### 2. Grant credits on the top-up purchase

The grant hooks into the existing sync path
([purchase-processing.md](purchase-processing.md)) — `license.created` fires for
a top-up plan exactly like any other purchase. After the entitlement upsert,
credit the balance. Top-ups **stack** (buy 100 then 1000 → 1100), so increment;
never overwrite.

```ts
// extends processPurchaseInfo() — runs server-side, after the entitlement upsert
const planCredits = creditsForPlan(purchase.planId); // see step 5
if (planCredits > 0) {
  await db.user.update({
    where: { id: user.id },
    data: { credit: { increment: planCredits } },
  });
}
```

Because the upsert is idempotent on `fsLicenseId`, guard the increment so a
re-delivered `license.created` webhook does not double-grant — e.g. track a
`creditsGrantedAt` flag per license, or record the grant as a ledger row keyed
by license id.

### 3. Gate on balance, return 402 when insufficient

This is the credit-aware version of `requireEntitlement`. A pure subscription
gates on "an active entitlement exists"; a credit model gates on "balance is
sufficient for this operation". Check **before** running the work.

```ts
// src/middleware/paywall.ts (continued)
export const requireCredits = (cost: number) =>
  createMiddleware(async (c, next) => {
    const user = c.get('user');
    const balance = await getCreditsRemaining(user.id);
    if (balance < cost) {
      return c.json({ error: 'insufficient_credits', balance }, 402);
    }
    await next();
  });
```

### 4. Decrement on success, atomically

Decrement **after** the metered work succeeds, not on request — a failed OCR run
must not burn credits. Use a DB-level atomic decrement (or a conditional
`UPDATE ... WHERE credits_remaining >= cost`) so two parallel calls can't both
pass the gate and overspend the balance.

```ts
ocrRoute.post('/', requireUser, requireCredits(1), async (c) => {
  const user = c.get('user');
  const pagesProcessed = await runOcr(c); // the metered work

  // Atomic, conditional decrement: succeeds only if the balance still covers it.
  const updated = await db.user.updateMany({
    where: { id: user.id, credit: { gte: pagesProcessed } },
    data: { credit: { decrement: pagesProcessed } },
  });
  if (updated.count === 0) {
    // Lost the race against a concurrent call — handle/refund the work as needed.
    return c.json({ error: 'insufficient_credits' }, 402);
  }
  return c.json({ pagesProcessed });
});
```

The middleware check is a fast early-out; the conditional decrement is the real
guard against concurrent overspend.

> **Refresh the displayed balance after a metered action.** The server debit is
> only half the job: the UI credit badge/display still shows the **old** balance
> until something re-fetches it, so a user who runs OCR sees "100 credits" until
> a manual page reload — a stale-UI bug the maker will report. In the metered
> action's success handler, update the displayed balance **without a full
> reload**, using the simpler of: (a) return the new balance in the action's
> response (`return c.json({ pagesProcessed, creditBalance: newBalance })`) and
> update local state from it — no extra round-trip; or (b) re-call the existing
> balance/entitlement endpoint (`GET /api/entitlement`, which carries `credit`)
> via the **same** refresh function the purchase flow already uses
> (`refreshEntitlement` / `onPurchase`). This is the credit-consumption twin of
> the post-purchase entitlement refresh — see
> [freemius-checkout → references/paywall.md](../../freemius-checkout/references/paywall.md).

### 5. How many credits a plan grants (`plan_id → credits`)

Never trust a client-sent credit amount — resolve it server-side. Two honest
options:

- **(a) Read it from the Freemius plan** — if you model credits as a plan
  feature/quota value in the dashboard, read it from the retrieved plan so it is
  not hardcoded and can be changed without a deploy. **Prefer this.**
- **(b) Server-side map** — keep a small `plan_id → credits` map in your code as
  a fallback when the plan doesn't carry the quota.

```ts
// Prefer (a): read from the plan's feature/quota when modeled there.
// Fall back to (b): a server-side map. Never read the amount from the client.
const PLAN_CREDITS: Record<string, number> = {
  '<plan_id_100>': 100,
  '<plan_id_1000>': 1000,
};

function creditsForPlan(planId: string): number {
  return readQuotaFromFreemiusPlan(planId) ?? PLAN_CREDITS[planId] ?? 0;
}
```

### Subscription vs credit gating

- **Subscription** gates on "an active entitlement exists"
  (`requireEntitlement`).
- **Credit** gates on "balance sufficient" (`requireCredits`).

You can combine them (a subscription grants a monthly allotment, top-ups add
credits on top), but keep each feature simple: pick **one primary model per
feature** rather than blending both checks on the same route.
