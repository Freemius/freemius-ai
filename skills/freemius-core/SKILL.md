---
name: freemius-core
description:
  Integrate Freemius monetization into a JavaScript/TypeScript backend —
  entitlement table, server-side checkout creation, purchase processing, and
  webhook license-lifecycle sync. Use when adding subscriptions, licensing,
  paywalls, or "unlock premium feature" gating to a SaaS/App/Web app whose
  backend is JS/TS (Hono, Express, Next.js, Fastify, serverless Fetch handlers).
  Covers the Freemius JS SDK (`@freemius/sdk`), not the frontend Checkout SDK.
---

# Freemius Core

Wire Freemius billing into a JS/TS backend so a logged-in user can buy a plan
and your app can reliably answer one question: **"does this user have an active
entitlement right now?"**

This Skill follows the official Freemius JS SDK integration guide:
<https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/>

> **Framework note.** The examples in this Skill are written in the Hono
> framework, but the JS SDK supports any framework that supports the Web
> Standard's Request/Response based routing. Adapt the examples to the real HTTP
> framework used in the app.

When you need the upstream docs, pick by the app's stack:

- **Next.js app** →
  <https://freemius.com/help/documentation/saas-sdk/framework/nextjs.md>
- **Any other JS/TS runtime** →
  <https://freemius.com/help/documentation/saas-sdk/js-sdk/integration.md>

## Golden rules (do not violate)

1. **All Freemius SDK/API calls are server-side.** The product `secretKey` and
   `apiKey` must never reach the browser. Only the public Checkout link/options
   cross to the frontend.
2. **Integration logic lives in plain-TS services, separate from
   routes/controllers.** Put it in files like `src/services/freemius/*.ts`.
   Routes only parse the request, call a service, and shape the response.
3. **The local DB is a mirror, not the source of truth.** Freemius owns billing
   state. Your `user_fs_entitlement` table is a cache kept in sync via
   purchase-redirect + webhooks. When in doubt, re-fetch from Freemius with
   `freemius.purchase.retrievePurchase(licenseId)`.
4. **Webhooks are mandatory.** Without them, cancellations/renewals/expirations
   never reach your DB and users keep or lose access incorrectly.
5. **Secrets come from env vars only.** Never hardcode keys, the API token, or
   URLs.

## Step 0 — Intake (run this first)

Before building anything, **derive the Freemius setup from the maker's product**
and ask only for what you genuinely can't infer. This is detect-first, not a
questionnaire — you still apply judgment.

Offer two modes up front (the maker can switch to guided at any point):

- **Autonomous** — "I'll detect what I can and only stop when I need you."
- **Guided** — "walk me through it, ask as we go."

**Also ask where it should run — this changes what you install and where the
database lives.** Don't assume; makers have different environments and some keep
their machine clean:

- **Local-first** — install/run the app + a local Postgres, validate on
  `localhost`, then optionally deploy. Choose this only if the maker confirms
  it's OK to install a database locally.
- **Remote-only** — **do not** install a database locally, apply schema
  migrations against a local DB, or start a local dev server. Build/type-check
  locally is fine (touches no DB); the app and its database run only on the
  deploy target (e.g. Railway/Render/Fly), and all validation happens against
  the deployed URL.

Ask: _"Should I set this up **local-first** (install a local Postgres + run on
localhost) or **remote-only** (no local install — provision + run everything on
your host, e.g. Railway)?"_ Honor the answer for every install/run/migrate step.

**And ask sandbox vs. live up front** — _"Build in **sandbox** first (default —
the checkout opens in sandbox mode and accepts test credit cards, so end-to-end
runs are free) or straight to **live**?"_ Almost always sandbox while
validating. Sandbox is a **checkout mode**, not a discount: no coupon is needed
or involved. **Wire this to a dedicated `FREEMIUS_SANDBOX` env var, never to
`NODE_ENV`** — you'll deploy remote-only with `NODE_ENV=production` while still
in sandbox, and coupling the two opens the LIVE checkout by mistake. Set
`FREEMIUS_SANDBOX=false` only at go-live.

### a. Detect (scan before asking)

Inspect the target repo and classify each needed input as **KNOWN / MISSING /
UNVERIFIED**. Never re-ask for anything already KNOWN. **Read existing config
first** (`.env`, `.env.example`, README, an existing
`services/freemius/client.ts` or env module) and reuse the IDs/keys it already
carries instead of asking the maker to re-paste them.

| Look for                                                                                                                          | Tells you                               |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `.env` / `.env.example` for `FREEMIUS_PRODUCT_ID`, `FREEMIUS_PUBLIC_KEY`, `FREEMIUS_SECRET_KEY`, `FREEMIUS_API_KEY`, sandbox flag | Which secrets are set vs. missing       |
| `user_fs_entitlement` table / Prisma model / migration                                                                            | Whether building block 1 already exists |
| `src/services/freemius/*`, `/api/checkout`, `/api/webhooks/freemius` routes                                                       | Which building blocks are scaffolded    |
| `package.json` deps / server entry (Hono, Express, Next, Fastify)                                                                 | The framework + route style             |
| `PUBLIC_APP_URL` / deploy config / a live domain                                                                                  | Whether there's a public URL yet        |

**When `FREEMIUS_API_KEY` + `FREEMIUS_PRODUCT_ID` are both present in config,
the product is already identified — do not re-ask for the product ID.** (The SDK
client is constructed _with_ `productId`, so it lives in config; it is not
derived from the API key.) For each **plan-id role** the app needs (e.g.
`PRO_PLAN_ID`, `LIFETIME_PLAN_ID`, `CREDITS_PLAN_ID`), resolve it in this order
— don't blank-ask the maker to paste ids:

1. **API lookup by name** — the app README declares each plan **name → role**
   (the "Plans configured" table convention — see
   [references/dashboard-and-secrets.md](references/dashboard-and-secrets.md) →
   "Plan roles"). Enumerate the product's plans via the API key, match each
   declared name to its role, and read off the live plan id.
2. **README id fallback** — if a name is ambiguous, doesn't resolve, or the API
   lookup is unavailable, use the id pinned in that table's "Plan ID (fallback)"
   column (or an existing `.env`).
3. **Ask** — only for roles that resolve via neither.

Confirm the resolved role → id map before building. Only prompt for inputs that
are genuinely MISSING, pointing to Dashboard → API & Keys for the `.env`
snippet.

### b. Derive from the product

The Freemius setup follows from the maker's **monetization intent**, not a fixed
script. Infer from the codebase + a few targeted questions:

- which **plan(s)** to gate, and the **shape**: subscription (monthly/annual),
  one-off / top-ups, or credits;
- which **feature/endpoint** sits behind the paywall;
- the **webhook URL** = deployed origin + `/api/webhooks/freemius`;
- the **checkout redirect URL** = deployed origin + your redirect handler path.

### c. Ask only the gaps (one copy-paste block)

For everything still MISSING, present a **single concise block** the maker fills
in one shot (they usually already have these values). For UNVERIFIED items, ask
"is this still right?" rather than re-asking blind. Request in dependency order:

```
Run mode:                   local-first (install local Postgres) | remote-only (no local install; run on host)
Freemius Product ID:        e.g. <your_product_id>
Plan ID(s) to sell/gate:    e.g. <your_plan_id>
Public key (pk_...):        SDK public key
Secret key (sk_...):        SERVER-ONLY — goes in .env, never committed
API key (token):            SERVER-ONLY — goes in .env, never committed
Sandbox or live?:           sandbox while validating (sets FREEMIUS_SANDBOX, independent of NODE_ENV)
Monetization shape:         subscription monthly/annual | one-off/top-ups | credits
Feature/endpoint to gate:   e.g. POST /api/ocr
Deploy target + access:     e.g. Railway project token — for remote-only, this is where it runs
Public/deployed URL:        for webhook + redirect (the deployed origin; only localhost if local-first)
```

For the Freemius IDs/keys, tell the maker: go to the **Freemius Developer
Dashboard → Products → Settings → API & Keys** and copy the ready-made **JS SDK
`.env` snippet** — it contains the product ID and all keys in one paste.
Screenshots + step-by-step:
[Retrieving keys from the Developer Dashboard](https://freemius.com/help/documentation/saas-sdk/js-sdk/installation/#retrieving-keys-from-the-developer-dashboard).

Secret/API keys go in a **git-ignored `.env`**, never committed, never
client-side (Golden rules #1 + #5). For the full env var list and where each
value lives in the Dashboard, see
[references/dashboard-and-secrets.md](references/dashboard-and-secrets.md) —
don't duplicate it here.

### d. Confirm a plan, then build

Restate: detected state + the values just provided + the build order (the four
blocks below, skipping what already exists). **Pause for the maker's go-ahead**,
then proceed.

### e. Resume-friendly

If blocks already exist (entitlement table present, services/routes present),
**extend or skip** them — don't recreate. Pick the build up where it left off.

### f. Checkpoints (pauses, not guesses)

- confirm the **schema** before applying it — apply it with the stack's own
  migration tool (e.g. with Prisma: `prisma db push` / `prisma migrate`; with
  raw SQL: run the provided DDL; other ORMs: their equivalent);
- confirm the **public URL** before wiring purchase processing + webhooks;
- hand the **Dashboard steps** (webhook URL, checkout redirect) to the human as
  an explicit "do this now, tell me when done" pause — see
  [Dashboard configuration](#dashboard-configuration-hand-to-the-human) below.

## The four building blocks

Build these in order. Each has a focused reference file — read the one you need:

| Step | What you build                                                              | Reference                                                              |
| ---- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | The `user_fs_entitlement` table (Prisma/SQL/Drizzle)                        | [references/entitlement-table.md](references/entitlement-table.md)     |
| 2    | Server-side checkout creation (`POST /api/checkout`)                        | [references/checkout.md](references/checkout.md)                       |
| 3    | Purchase processing (redirect handler + overlay endpoint)                   | [references/purchase-processing.md](references/purchase-processing.md) |
| 4    | Webhook listener for license-lifecycle sync (`POST /api/webhooks/freemius`) | [references/webhooks.md](references/webhooks.md)                       |

## Quick start

### 1. Install + construct the SDK (server only)

```bash
npm install @freemius/sdk
```

```ts
// src/services/freemius/client.ts
import { Freemius } from '@freemius/sdk';

export const freemius = new Freemius({
  productId: process.env.FREEMIUS_PRODUCT_ID!,
  apiKey: process.env.FREEMIUS_API_KEY!,
  secretKey: process.env.FREEMIUS_SECRET_KEY!,
  publicKey: process.env.FREEMIUS_PUBLIC_KEY!,
});

// Sandbox is its OWN flag — decouple it from NODE_ENV. You will deploy to a
// remote host with NODE_ENV=production while STILL validating in sandbox, so
// `NODE_ENV !== 'production'` would wrongly send checkout to the LIVE URL.
// Default to sandbox unless FREEMIUS_SANDBOX is explicitly "false".
export const IS_SANDBOX = process.env.FREEMIUS_SANDBOX !== 'false';
```

> ⚠️ **Do not tie sandbox to `NODE_ENV`.** A common first error: validating on a
> deployed host (where `NODE_ENV=production`) flips sandbox off and the checkout
> opens the **live** store instead of the sandbox. Keep `FREEMIUS_SANDBOX` as a
> dedicated env var: `true`/unset while testing, set to `false` only for
> go-live.

### 2. Create a checkout for the logged-in user

```ts
const checkout = await freemius.checkout.create({
  user: { email: session.user.email, firstName, lastName },
  planId,
  isSandbox: IS_SANDBOX,
});
const { options, link } = checkout.serialize();
// Send `link` (hosted) or `options` (overlay) to the frontend.
```

### 3. Sync entitlements on purchase + webhook

`freemius.purchase.retrievePurchase(licenseId)` →
`purchase.toEntitlementRecord()` →
`db.userFsEntitlement.upsert({ where: { fsLicenseId }, ... })`. Same code path
for the checkout redirect, the overlay `success` callback, and every webhook
event. See
[references/purchase-processing.md](references/purchase-processing.md).

### 4. Gate a paywalled feature

```ts
const entitlement = await getUserEntitlement(userId); // active subscription OR valid one-off (Lifetime)
if (!entitlement) return new Response('Payment required', { status: 402 });
// ...run the premium feature...
```

> `getUserEntitlement()` is **not** just `freemius.entitlement.getActive(rows)`:
> that SDK helper only returns `type: 'subscription'` rows, so a one-off
> **Lifetime** license would be missed. Resolve one-offs yourself — see
> [references/entitlement-logic.md](references/entitlement-logic.md).

Gate features with the entitlement helpers in
[references/entitlement-logic.md](references/entitlement-logic.md).

## Mental model

```
Frontend (pricing page)                Backend services (plain TS)            Freemius
  │  POST /api/checkout  ───────────▶  freemius.checkout.create() ──────────▶  checkout
  │  ◀── { link, options } ──────────  checkout.serialize()
  │  user pays on Freemius checkout ───────────────────────────────────────▶  license created
  │  redirect ?…  ──────────────────▶  checkout.processRedirect()
  │                                    purchase.retrievePurchase(licenseId)
  │                                    upsert user_fs_entitlement  ◀──────────  PurchaseInfo
  │  later: cancel/renew/expire ───────────────────────────────────────────▶  webhook event
  │                                    POST /api/webhooks/freemius
  │                                    re-sync user_fs_entitlement
  │  GET premium feature ───────────▶  getUserEntitlement() → 402 or run
```

## Data-mapping gotcha

The SDK speaks **camelCase** (`fsLicenseId`, `fsPlanId`, `isCanceled`); SQL
columns are usually **snake_case** (`fs_license_id`, …). Handle the mapping with
whatever your stack provides: **if using Prisma**, prefer `@map`/`@@map` (then
`purchase.toEntitlementRecord()` drops straight into the model); **if using
another ORM/query layer**, apply its equivalent column-mapping feature; **with
raw SQL**, name columns snake_case directly and convert both directions
explicitly. See
[references/entitlement-table.md](references/entitlement-table.md).

## Runtime & expected interfaces

What the Freemius pieces need from the app's stack:

- **JS SDK (`@freemius/sdk`)** — runs on **Node.js, Deno, or Bun**. Its API
  relies on **Web-Standard `Request`/`Response` based routing**, so any
  framework that supports it works directly (Hono, Next.js route handlers,
  Fastify with a Fetch adapter, serverless Fetch handlers, …). For a framework
  that doesn't, write a small adapter that converts to/from `Request`/
  `Response`.
- **React Starter Kit** — **React 19+** with **shadcn UI + Tailwind**. Install
  via the official shadcn CLI:
  `npx shadcn@latest add https://shadcn.freemius.com/all.json`. If the app
  doesn't use shadcn/React, use the Starter Kit as a **reference** to implement
  the UI in the app's own framework.

For a worked example of porting the Next.js-flavored docs to another stack
(Vite + Hono), see
[references/vite-hono-notes.md](references/vite-hono-notes.md).

## Dashboard configuration (hand to the human)

This is the concrete checklist for the Dashboard hand-off flagged as a
checkpoint in [Step 0 — Intake](#step-0--intake-run-this-first). After deploying
with a public URL, configure in the Freemius Developer Dashboard
(<https://dashboard.freemius.com/>):

- **Product → Webhooks** → add `POST /api/webhooks/freemius`, subscribe to:
  `license.created`, `license.updated`, `license.extended`, `license.shortened`,
  `license.cancelled`, `license.expired`, `license.plan.changed`,
  `license.quota.changed`, `license.deleted`.
- **Product → Plans → Customization** → set the checkout redirect URL to your
  purchase-redirect handler.

See [references/dashboard-and-secrets.md](references/dashboard-and-secrets.md)
for the full env var list and dashboard checklist.

## Generate / update the app's `AGENTS.md`

After wiring the paywall, leave a short **`AGENTS.md`** at the repo root so the
next agent (or human) can find the premium features, understand how they are
paywalled with Freemius, and jump to the paywall library files. Keep it to ~one
screen and vendor-neutral — no app-specific narrative, just the map.

**Do this at the end of the build:** create `AGENTS.md` if absent, or, if one
already exists, **insert/refresh only a fenced `## Freemius paywall` section**
inside it (don't rewrite the maker's file). Fill every bracket from the real
integration you just built — the actual gated routes and the real service file
paths — don't ship the placeholders.

A ready-to-copy starting point ships with this Skill:
[assets/AGENTS.sample.md](assets/AGENTS.sample.md). Copy it, then replace the
brackets. The three sections mirror what the maker asked for:

1. **Premium features — how to identify them** — a table of gated feature →
   entry point (route) → the guard it carries (`requireEntitlement` /
   `requireCredits`). The rule: a route wrapped in the paywall middleware is a
   premium feature; free routes have no guard.
2. **Paywalling with Freemius** — the sell → sync → gate flow in three lines,
   plus "402 on no entitlement" and "all SDK calls server-side, secrets in env".
3. **Where the paywall library functions live** — a table pointing at the real
   files: the SDK client, checkout, entitlement sync + gating helpers, the
   paywall middleware, and (if used) the credit-metering file, plus the
   server-only env var list.

Copy-paste template (drop into `AGENTS.md`, replace every `[...]`):

```markdown
## Freemius paywall

### 1. Premium features — how to identify them

Premium features are the routes/actions gated behind a Freemius entitlement —
find them by the paywall guard they carry (§3), not by guesswork.

| Premium feature | Entry point       | Gated by               |
| --------------- | ----------------- | ---------------------- |
| `[feature]`     | `[METHOD /route]` | `[requireEntitlement]` |
| `[feature]`     | `[METHOD /route]` | `[requireCredits(n)]`  |

### 2. Paywalling premium features with Freemius

1. **Sell** — the frontend opens the Freemius Checkout for a plan (sandbox mode
   accepts test cards while validating).
2. **Sync** — the purchase redirect + Freemius webhooks upsert the local
   entitlement mirror (Freemius stays the source of truth).
3. **Gate** — before a premium feature runs, resolve the active entitlement (or
   credit balance for top-up/metered features). No entitlement → **HTTP 402**;
   the frontend branches on 402 to show the upgrade UI.

All Freemius SDK calls are **server-side**; `secretKey`/`apiKey` never reach the
browser; secrets come from env vars only.

### 3. Where the paywall library functions live

| Concern                                  | File                              |
| ---------------------------------------- | --------------------------------- |
| Freemius SDK client (keys, sandbox flag) | `[src/…/freemius/client.ts]`      |
| Checkout creation + pricing              | `[src/…/freemius/checkout.ts]`    |
| Entitlement sync (redirect + webhooks)   | `[src/…/freemius/entitlement.ts]` |
| Entitlement resolve + gating helpers     | `[src/…/freemius/entitlement.ts]` |
| Paywall guard (402 middleware)           | `[src/…/middleware/paywall.ts]`   |
| Credit balance / metering (if used)      | `[src/…/credits.ts]`              |

Env (server-only, git-ignored `.env`): `FREEMIUS_PRODUCT_ID`,
`FREEMIUS_PUBLIC_KEY`, `FREEMIUS_SECRET_KEY`, `FREEMIUS_API_KEY`,
`FREEMIUS_SANDBOX`.
```
