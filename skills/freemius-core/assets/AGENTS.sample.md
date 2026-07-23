# AGENTS.md

> Vendor-neutral entry point for AI agents (and humans) working in this repo. It
> tells an agent where the **premium features** live, how they are **paywalled
> with Freemius**, and which files hold the **paywall library functions**.
> Replace the bracketed placeholders with this repo's specifics.

## 1. Premium features — how to identify them

Premium features are the endpoints/actions gated behind a Freemius entitlement.
Find them by the paywall guard they carry (see §3), not by guesswork.

| Premium feature      | Entry point               | Gated by               |
| -------------------- | ------------------------- | ---------------------- |
| `[e.g. OCR extract]` | `[e.g. POST /api/ocr]`    | `[requireEntitlement]` |
| `[e.g. Bulk export]` | `[e.g. POST /api/export]` | `[requireCredits(n)]`  |

Rule of thumb: a route wrapped in the paywall middleware, or any code path that
first checks `getUserEntitlement(userId)` / a credit balance before running, is
a premium feature. Free features have no such guard.

## 2. Paywalling premium features with Freemius

Freemius owns billing state; this app mirrors it and gates on it.

1. **Sell** — the frontend opens the Freemius Checkout for a plan; the user pays
   on Freemius (sandbox mode accepts test cards while validating).
2. **Sync** — the purchase redirect + Freemius webhooks upsert the local
   entitlement mirror (source of truth stays on Freemius; re-fetch when unsure).
3. **Gate** — before running a premium feature, resolve the user's active
   entitlement (or credit balance for metered/top-up features). No entitlement →
   return **HTTP 402 Payment Required**; the frontend branches on 402 to show
   the upgrade/checkout UI.

Subscriptions gate on "an active entitlement exists"; credit/top-up features
gate on "balance sufficient", then decrement atomically on success.

All Freemius SDK calls are **server-side** — the `secretKey`/`apiKey` never
reach the browser; secrets come from env vars only.

## 3. Where the paywall library functions live

Freemius integration is kept in plain-TS service files, separate from routes.
Point agents at these files (adjust paths to this repo's layout):

| Concern                                  | File                                     |
| ---------------------------------------- | ---------------------------------------- |
| Freemius SDK client (keys, sandbox flag) | `[src/services/freemius/client.ts]`      |
| Checkout creation + pricing              | `[src/services/freemius/checkout.ts]`    |
| Entitlement sync (redirect + webhooks)   | `[src/services/freemius/entitlement.ts]` |
| Entitlement resolve + gating helpers     | `[src/services/freemius/entitlement.ts]` |
| Paywall guard (402 middleware)           | `[src/middleware/paywall.ts]`            |
| Credit balance / metering (if used)      | `[src/services/credits.ts]`              |

Env vars (server-only, git-ignored `.env`): `FREEMIUS_PRODUCT_ID`,
`FREEMIUS_PUBLIC_KEY`, `FREEMIUS_SECRET_KEY`, `FREEMIUS_API_KEY`,
`FREEMIUS_SANDBOX`. Copy them from the Freemius Developer Dashboard → Products →
Settings → API & Keys (JS SDK `.env` snippet).

---

_Built with the `freemius-core` Agent Skill. To (re)generate or update this file
for a repo, ask the agent: "update AGENTS.md with the Freemius paywall map."_
