# Dashboard configuration & secrets

## Environment variables

**Fastest path:** in the **Freemius Developer Dashboard → Products → Settings →
API & Keys** there is a ready-made **JS SDK `.env` snippet** — copy it and you
have the product ID and all keys in one paste. Screenshots + step-by-step:
[Retrieving keys from the Developer Dashboard](https://freemius.com/help/documentation/saas-sdk/js-sdk/installation/#retrieving-keys-from-the-developer-dashboard).

**Detect-first, don't re-prompt.** If these values are already in the repo
(`.env`, `.env.example`, README, an existing `client.ts`/env module), read and
reuse them. When `FREEMIUS_API_KEY` + `FREEMIUS_PRODUCT_ID` are already set the
product is identified — the SDK client is constructed _with_ `productId` (it's
config, not derived from the API key), so don't re-ask for it. Point the maker
at the Dashboard snippet only for values that are genuinely missing.

## Plan roles (name → role → id fallback)

A product usually has several plans, each playing a **role** in the app (a Pro
tier, a one-off Lifetime, a credits top-up, …). The app README declares that
mapping in a **"Plans configured"** table so the skill can resolve the role
env-var ids without asking the maker to paste each one:

```
## Plans configured
| Role (env var)     | Plan name        | Plan ID (fallback) |
| ------------------ | ---------------- | ------------------ |
| PRO_PLAN_ID        | Pro              | <pro_plan_id>      |
| LIFETIME_PLAN_ID   | Lifetime         | <lifetime_plan_id> |
| CREDITS_PLAN_ID    | Credits 100-pack | <credits_plan_id>  |
```

Resolve each role in this order (the product id stays in config throughout — the
API key only **enumerates that product's plans**, it does not derive the product
id):

1. **API lookup by name** — enumerate the product's plans with the API key and
   match each **Plan name** to its role to get the live id.
2. **README id fallback** — if a name is ambiguous / doesn't resolve / the API
   lookup is unavailable, use the pinned **Plan ID (fallback)** (or an existing
   `.env`).
3. **Ask** — only for roles that resolve via neither.

Confirm the resolved role → id map before building.

All server-side. Never hardcode; never `VITE_`-prefix the Freemius keys (or any
other secret).

| Var                   | Where to find it                                         | Purpose                                                    |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `FREEMIUS_PRODUCT_ID` | Dashboard → Products → Settings → API & Keys             | Identifies your product.                                   |
| `FREEMIUS_PUBLIC_KEY` | Dashboard → Products → Settings → API & Keys             | Public key for the SDK.                                    |
| `FREEMIUS_SECRET_KEY` | Dashboard → Products → Settings → API & Keys             | **Secret** — signs/authenticates SDK calls.                |
| `FREEMIUS_API_KEY`    | Dashboard → Products → Settings → API & Keys (API token) | REST API + webhook auth.                                   |
| `PUBLIC_APP_URL`      | Your deployment                                          | Public base URL; used for redirect signature verification. |
| `DATABASE_URL`        | Your Postgres                                            | Prisma connection string.                                  |

Construct the SDK from these (see SKILL.md Quick start). Keep them in a secret
manager / env file that is never committed. Provide a `.env.example` documenting
the names with placeholder values.

## Provisioning Postgres on the deploy host (Railway project-token gotcha)

`DATABASE_URL` points at a Postgres you provision on the deploy host. When that
host is **Railway** driven by a **project token** (non-interactive/CI), one trap
causes duplicate databases and must be guarded:

- **Never judge `railway add --database postgres` by its output.** With a
  project token the add can print **`Project not found`** (or another
  error-looking line) on stderr **and/or exit non-zero while still creating the
  DB server-side**. Reading that as "it failed" and **retrying provisions a
  SECOND Postgres**.
- **Verify by state, not stdout: poll `railway status` and COUNT the Postgres
  services.** Add again **only** if the count settles at **zero**; if it is **≥
  1, STOP** — never add a second.
- **Recover from a duplicate:** keep the one the app's `DATABASE_URL` references
  (`railway variables --service <app> --kv | grep DATABASE_URL`), confirm the
  other is empty + unreferenced, and delete the stray from the **Dashboard** (a
  project token cannot delete a service via CLI). Never adopt an
  `isPendingDeletion: true` leftover — always start from a **fresh** Postgres.

The full CLI-only, check-first procedure (provision → poll/count → recover)
lives in the reference app's **`railway.md`** deploy runbook; see the kit's
[`deploy-guide.md`](../../../deploy-guide.md) for the host-agnostic overview.

## Dashboard checklist (human, after public deploy)

1. **Webhooks** — Product → Webhooks → add
   `https://<domain>/api/webhooks/freemius`. Subscribe to:
   - `license.created`
   - `license.updated`
   - `license.extended`
   - `license.shortened`
   - `license.cancelled`
   - `license.expired`
   - `license.plan.changed`
   - `license.quota.changed`
   - `license.deleted`
2. **Checkout redirect** — Product → Plans → (plan) → Customization → set the
   redirect URL to `https://<domain>/api/checkout/redirect`.
3. **Sandbox** — validate in **sandbox mode**: the checkout opens in sandbox and
   accepts **test credit cards**, so end-to-end runs are free (no coupon needed
   — sandbox is a checkout mode, not a discount). Drive `isSandbox` from a
   dedicated **`FREEMIUS_SANDBOX`** env var (`true`/unset while testing),
   **not** from `NODE_ENV` — you validate on a deployed host where
   `NODE_ENV=production`, so coupling them opens the LIVE checkout by mistake.
   Set `FREEMIUS_SANDBOX=false` only at go-live.
4. **Plans/pricing** — confirm plans and monthly/annual pricing exist before a
   live Gate run.

## Going live

- Flip `isSandbox` to `false` by setting `FREEMIUS_SANDBOX=false` (a dedicated
  env var, independent of `NODE_ENV`).
- Point all URLs at the production domain (no localhost).
- Re-verify the webhook + redirect URLs use the production domain.
