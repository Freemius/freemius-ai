# Entitlement table

A Freemius **license** is the primary entitlement: a purchase of a product +
plan + pricing. A license may be tied to a subscription (recurring billing
cycle) or stand alone (one-time / lifetime purchase). Mirror the relevant fields
into a local `user_fs_entitlement` table so your app can check access without a
network round-trip on every request.

## Columns

| Column (snake_case) | SDK field (camelCase) | Notes                                                                          |
| ------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `id`                | —                     | Local primary key (cuid/uuid).                                                 |
| `user_id`           | `userId`              | FK to your user table.                                                         |
| `fs_license_id`     | `fsLicenseId`         | **Unique.** The upsert conflict key.                                           |
| `fs_plan_id`        | `fsPlanId`            | Freemius plan id.                                                              |
| `fs_pricing_id`     | `fsPricingId`         | Freemius pricing id — use this to decide access level (unique per plan+cycle). |
| `fs_user_id`        | `fsUserId`            | Freemius user id (for payments/invoices/portal lookups).                       |
| `type`              | `type`                | Enum: `subscription` \| `oneoff` (matches `PurchaseEntitlementType`).          |
| `expiration`        | `expiration`          | Nullable timestamp; null = no expiry (lifetime).                               |
| `is_canceled`       | `isCanceled`          | Boolean.                                                                       |
| `created_at`        | `createdAt`           | Timestamp.                                                                     |

## Prisma schema (recommended)

Prisma's `@map`/`@@map` bridges camelCase ↔ snake_case, so SDK output drops
straight in.

```prisma
enum FsEntitlementType {
  subscription
  oneoff
}

model UserFsEntitlement {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Matches PurchaseInfo.toEntitlementRecord() from @freemius/sdk.
  fsLicenseId String            @unique
  fsPlanId    String
  fsPricingId String
  fsUserId    String
  type        FsEntitlementType
  expiration  DateTime?
  isCanceled  Boolean
  createdAt   DateTime

  @@index([type])
  @@map("user_fs_entitlement")
}
```

The `@unique` on `fsLicenseId` is what makes the webhook/redirect upsert
idempotent and race-safe.

## SQL equivalent

```sql
CREATE TYPE fs_entitlement_type AS ENUM ('subscription', 'oneoff');

CREATE TABLE user_fs_entitlement (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    fs_license_id TEXT NOT NULL UNIQUE,
    fs_plan_id    TEXT NOT NULL,
    fs_pricing_id TEXT NOT NULL,
    fs_user_id    TEXT NOT NULL,
    type          fs_entitlement_type NOT NULL,
    expiration    TIMESTAMP(3) WITHOUT TIME ZONE,
    is_canceled   BOOLEAN NOT NULL,
    created_at    TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT    fk_user FOREIGN KEY (user_id) REFERENCES "User"(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_fs_entitlement_type ON user_fs_entitlement (type);
```

If your DB enforces row-level security (e.g. Supabase): users may **READ** only
their own entitlements; only the server (service role) may INSERT/UPDATE/DELETE.

## Usage-based / credit balance (tracked separately)

For a top-up / page-credit model, do **not** extend this table — the balance is
a user-level running total, tracked **separately** (e.g. a `credit` integer on
the user, or a per-user balance table), which the app owns and decrements as
credits are consumed. Freemius sells the top-up but does not meter usage.

The full pattern (separate balance keyed by user, grant on `license.created`,
402 gate on insufficient balance, atomic success-time decrement,
`plan_id → credits` mapping, or a separate `credit_ledger` table) is documented
canonically in [entitlement-logic.md](entitlement-logic.md) → "Usage-based /
credit metering (top-up model)".

## Multiple licenses per user

The schema supports many rows per user (e.g. a canceled-in-period subscription
plus a freshly bought one-off Lifetime). `freemius.entitlement.getActive(rows)`
selects the currently valid **subscription** — it filters out `type: 'oneoff'`
rows entirely, so a one-off Lifetime license is **never** returned by it. If you
sell a Lifetime (or any one-off unlimited) plan, resolve one-offs yourself and
let a valid one supersede a stale subscription row — see
[entitlement-logic.md](entitlement-logic.md) → "Get the active entitlement".
Filter to `type: 'subscription'` before `getActive()` only if recurring access
is the _only_ thing you sell.
