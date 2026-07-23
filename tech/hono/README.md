# DocVault — Freemius x Claude reference app

DocVault is the **proof app** for the Freemius Claude Agent Skills. It
demonstrates the `freemius-core` flow end-to-end: a logged-in user subscribes
via a server-side Freemius checkout, the entitlement is synced to a local
Postgres mirror (redirect + webhooks), and a **paywalled PDF → text feature**
runs one `mistral-ocr-latest` call only for entitled users. It also demos the
**top-up / credit-metering model**: a one-off "credits" plan grants OCR
page-credits that are consumed per run (see below).

> Prototype-level by design. Auth is a simple email header, not a real session
> system. Phase 2 adds the Starter Kit checkout/portal UI.

## Stack

- **Backend:** Hono + TypeScript. All Freemius/Mistral calls are server-side, in
  plain-TS services (`src/server/services/`) separate from routes
  (`src/server/routes/`).
- **Frontend:** React + Vite (`src/web/`).
- **DB:** Prisma + PostgreSQL. The `user_fs_entitlement` table mirrors the
  proven Lovable/Bolt pattern and matches `PurchaseInfo.toEntitlementRecord()`.
  The `user_credit` table holds the top-up credit balance — deliberately
  **separate** from the entitlement mirror (per the `freemius-core` Skill's
  credit-metering pattern).

## Plan tiers — feature mapping

DocVault maps Freemius plans to features **server-side, in one place**
(`src/server/services/plans.ts`), with plan IDs supplied via env — never
hardcoded:

| Tier         | Plan (env var)                            | What it grants                                                           |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| **Premium**  | default subscription plan (no env needed) | unlimited **PDF-only** OCR — image uploads get 403 `image_requires_pro`  |
| **Pro**      | `PRO_PLAN_ID` (subscription)              | unlimited **PDF + image** OCR                                            |
| **Lifetime** | `LIFETIME_PLAN_ID` (one-off)              | unlimited everything, forever (a valid `oneoff` license passes the gate) |
| **Credits**  | `CREDITS_PLAN_ID` (one-off, consumable)   | **not a tier** — metered top-up: PDF + image allowed, 1 credit/page      |

The credits plan's one-off license is deliberately excluded from the entitlement
gate — it is a voucher, not an unlimited entitlement. On a Premium plan, an
image upload is rejected with `403 { "error": "image_requires_pro" }` and the
frontend shows an upgrade hint linking to `/account` (the Customer Portal
handles the upgrade).

## Credits / top-up demo

DocVault gates OCR on **active entitlement = unlimited, otherwise credits are
consumed per run** (1 credit per processed page):

1. A one-off (lifetime-priced) "credits" plan is configured in the Freemius
   Dashboard and referenced via `CREDITS_PLAN_ID`. Each purchase grants
   `CREDITS_PER_PURCHASE` credits — resolved **server-side**, never trusted from
   the client. Top-ups **stack** (increments; never overwrites), with a
   double-grant guard so a re-delivered webhook cannot credit twice.
2. The balance lives in the separate user-keyed `user_credit` table (E7) — not
   in `user_fs_entitlement`, which is overwritten on every license re-sync.
3. `POST /api/ocr` passes if the user has an active subscription (no credits
   consumed) **or** a sufficient credit balance; the balance is decremented
   atomically after a successful run. Otherwise it returns 402 with
   `no_subscription` (never had credits → subscribe) or `insufficient_credits`
   (ran out → top up), and the frontend paywall offers the matching pricing
   table.
4. `GET /api/entitlement` includes `creditBalance` so the UI shows the badge
   (nav + OCR page) and updates it after each run; a toast confirms "N credits
   added" after a top-up checkout.

Env vars: `CREDITS_PLAN_ID` (empty = credit grants disabled),
`CREDITS_PER_PURCHASE` (e.g. 100 for a 100-pack), plus the tier plan IDs
`PRO_PLAN_ID` and `LIFETIME_PLAN_ID` (empty = tier distinction disabled). See
`.env.example` — placeholders only; real IDs live in the deployment env.

## Endpoints

| Method    | Path                     | Purpose                                                                      |
| --------- | ------------------------ | ---------------------------------------------------------------------------- |
| POST      | `/api/checkout`          | Create a server-side checkout (hosted link + overlay options).               |
| GET       | `/api/checkout/pricing`  | Pricing-table data (plans, prices, per-plan checkout links).                 |
| GET       | `/api/checkout/redirect` | Hosted-checkout redirect handler → syncs entitlement.                        |
| POST      | `/api/purchase`          | Overlay-checkout success callback → syncs entitlement.                       |
| POST      | `/api/webhooks/freemius` | Webhook listener → license-lifecycle sync.                                   |
| GET\|POST | `/api/portal`            | Customer Portal session (P1 stub: hosted portal link by email).              |
| POST      | `/api/ocr`               | **Paywalled** PDF/image → OCR text (subscription or credits; 1 credit/page). |
| GET       | `/api/entitlement`       | Read current entitlement + credit balance for UI gating.                     |

## Prerequisites

- Node 20+
- A PostgreSQL database (local or hosted)
- A Freemius product with plans + keys (Developer Dashboard)
- A Mistral API key

## Local run

```bash
cd tech/hono
npm install

# 1. Configure secrets
cp .env.example .env
#    …fill in Freemius keys, MISTRAL_API_KEY, DATABASE_URL

# 2. Create the schema in your Postgres database
npm run prisma:generate
npm run db:push          # or: npm run prisma:migrate

# 3. Run backend (8787) + frontend (5173) together
npm run dev
```

Open <http://localhost:5173>. Sign in with any email (prototype auth
auto-provisions the user).

### Validating the full subscription flow

The checkout redirect and webhooks require a **public URL** Freemius can reach.
For real end-to-end validation, deploy to a public host (e.g. Railway) and
configure in the Freemius Developer Dashboard:

- **Product → Plans → Customization** → checkout redirect URL →
  `https://<domain>/api/checkout/redirect`
- **Product → Webhooks** → `https://<domain>/api/webhooks/freemius`, subscribe
  to all `license.*` **and** `subscription.*` events (see the `freemius-core`
  Skill `references/webhooks.md`). Both families matter: a user cancelling a
  _subscription_ fires `subscription.cancelled` (not a `license.*` event), so a
  license-only listener silently 200-drops it and the entitlement cache goes
  stale. The handler re-syncs the entitlement on both.

Use Freemius **sandbox** mode for free validation runs (sandbox checkouts take
test credit cards; no real charge). `IS_SANDBOX` comes from `FREEMIUS_SANDBOX`
(defaults to sandbox unless `NODE_ENV=production`).

## Production build

```bash
npm run build     # builds the Vite frontend + compiles the server
npm run start     # serves the API and the built frontend from one process
```

## Project layout

```
docvault/
├── prisma/schema.prisma              user_fs_entitlement + user_credit + user + document
├── src/
│   ├── shared/types.ts               types shared by server + web
│   ├── server/
│   │   ├── index.ts                  Hono app, route mounting, static serving
│   │   ├── env.ts                    env var access (no hardcoded secrets)
│   │   ├── db.ts                     Prisma client
│   │   ├── middleware/auth.ts        requireUser + paywall (subscription or credits)
│   │   ├── services/
│   │   │   ├── freemius/             client, entitlement, checkout, portal
│   │   │   ├── plans.ts              plan-tier feature mapping (env-driven plan IDs)
│   │   │   ├── credits.ts            credit balance: grant / gate / atomic debit
│   │   │   └── ocr.ts                one mistral-ocr-latest call
│   │   └── routes/                   checkout, purchase, webhooks, portal, ocr, entitlement
│   └── web/                          React + Vite: pricing → checkout → OCR → account
└── .env.example
```
