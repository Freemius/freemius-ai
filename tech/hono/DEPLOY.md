# Deploy guide — DocVault marketing demo (host-agnostic)

How to stand up the **DocVault** reference app as your own public marketing
demo, on any host, and how to tear it down afterwards. DocVault is the proof app
for the Freemius x Claude Skills; deploying it gives you a live "pricing →
checkout → paywalled feature → account/portal" walkthrough to show prospects.

> This deploys **your own** instance with **your own** keys. Nothing here uses
> the engagement's sandbox credentials. All secrets are runtime env vars — never
> commit them.

## What you supply (runtime prerequisites)

| Variable              | What it is                                                                   | Where to get it                                                |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `FREEMIUS_PRODUCT_ID` | Your Freemius product id                                                     | Dashboard → Product → Settings → API & Keys                    |
| `FREEMIUS_PUBLIC_KEY` | Product **public** key (`pk_…`)                                              | same                                                           |
| `FREEMIUS_SECRET_KEY` | Product **secret** key (`sk_…`) — server-side only                           | same                                                           |
| `FREEMIUS_API_KEY`    | API bearer/authorization token — server-side only                            | same                                                           |
| `MISTRAL_API_KEY`     | **Your own** Mistral API key (the OCR feature)                               | <https://console.mistral.ai/>                                  |
| `DATABASE_URL`        | A PostgreSQL connection string                                               | your managed Postgres (host add-on, Supabase, Neon, RDS, etc.) |
| `PUBLIC_APP_URL`      | The public HTTPS domain the demo is served from                              | your host (must be the live URL, not `localhost`)              |
| `PORT`                | Port the server listens on (often injected by the host)                      | your host                                                      |
| `NODE_ENV`            | Plain runtime flag (`production`/`development`) — **not** the sandbox switch | set explicitly                                                 |
| `FREEMIUS_SANDBOX`    | Drives Freemius **sandbox** checkout (`true`/unset = sandbox)                | default sandbox; set `false` only at go-live                   |

Sandbox vs live: Freemius sandbox is driven by a dedicated
**`FREEMIUS_SANDBOX`** env var — **not** `NODE_ENV`. You deploy on a host where
`NODE_ENV=production`, so coupling them would open the LIVE checkout by mistake.
Leave `FREEMIUS_SANDBOX` unset (or `true`) to run the demo in **sandbox** mode,
which accepts test credit cards for free end-to-end runs (sandbox is a checkout
mode, not a discount). Set `FREEMIUS_SANDBOX=false` **only** at go-live for a
real-money demo.

## Host-agnostic by design

DocVault is a single Node process (Hono serves the API **and** the built Vite
frontend) plus a Postgres database. That runs anywhere:

- **Railway / Render / Fly.io / Heroku-style PaaS:** point the service at the
  repo, set the build/start commands + env vars, attach managed Postgres.
- **Vercel / Netlify:** deploy the Node server as the app (it self-serves the
  static frontend); use an external Postgres (Neon/Supabase). Note these
  platforms are serverless-first — a long-lived Node server or their Node
  runtime both work since the SDK is Fetch-based.
- **Your own infra (VM / Docker / k8s):** `npm run build` then `npm run start`
  behind your reverse proxy with TLS.

Requirements are only: **Node 20+**, a reachable **PostgreSQL**, and a **public
HTTPS URL** (Freemius must reach your checkout-redirect + webhook endpoints).

## Build & start commands

From `tech/hono/`:

```bash
npm ci                       # install exact versions
npm run prisma:generate      # generate the Prisma client
npm run db:push              # create the schema on DATABASE_URL (first deploy)
npm run build                # build Vite frontend + compile the server
npm run start                # node dist/server/index.js — serves API + frontend
```

- **Build command:** `npm ci && npm run prisma:generate && npm run build`
- **Start command:** `npm run start`
- **Migrations:** `npm run db:push` once against the production `DATABASE_URL`
  (or `npm run prisma:migrate` if you prefer migration history). Some hosts run
  this as a release/predeploy step.

## Freemius Dashboard configuration (after the URL is live)

Both require your live `PUBLIC_APP_URL` — configure them once the demo has a
public domain (Developer Dashboard, <https://dashboard.freemius.com/>):

1. **Plans → Customization → checkout success redirect** →
   `https://<your-domain>/api/checkout/redirect`
2. **Product → Webhooks → Listeners** →
   `https://<your-domain>/api/webhooks/freemius`, subscribed to:
   `license.created`, `license.updated`, `license.extended`,
   `license.shortened`, `license.cancelled`, `license.expired`,
   `license.plan.changed`, `license.deleted`.
3. **(Optional) Product → Coupons** → a renewal-cancellation retention coupon so
   the Customer Portal cancellation wizard can offer it.

If the demo "stops working after publishing", it is almost always a redirect or
webhook URL still pointing at the old/local host — re-check both (see
`skills/freemius-troubleshooting/references/webhooks-and-redirect.md`).

## Smoke test the live demo

1. `GET https://<your-domain>/api/health` → `{ ok: true }`.
2. Sign in (prototype email auth), open the pricing page.
3. Buy a plan (sandbox + test coupon for a free run); confirm redirect →
   entitlement row created → OCR feature unlocks.
4. Upload a PDF → non-empty OCR text returned.
5. Open the account page → Customer Portal renders subscription + invoices.

## Protecting a public POC (HTTP Basic Auth)

The live demo runs on a public URL. To keep it from being world-open while still
letting monitoring and Freemius webhooks through, DocVault has an optional
site-level HTTP Basic Auth gate (Hono `basic-auth`) layered on top of the app's
prototype email sign-in.

- **Enable it** by setting BOTH env vars on the host (Railway):
  `BASIC_AUTH_USER` and `BASIC_AUTH_PASS`. The browser shows a login prompt with
  realm `DocVault POC`. Setting only one (or neither) leaves the gate **off**.
- **Leave both unset for local dev** — the app behaves exactly as before (no
  gate).
- **Exempt from the gate** (never prompted, so they keep working):
  - `GET /api/health` — uptime monitoring.
  - `/api/webhooks/*` — Freemius server-to-server POSTs. These cannot send
    basic-auth credentials, so gating them would silently break webhooks.
- Everything else (the static frontend and the remaining API routes, including
  the `/api/checkout/redirect` return-from-checkout GET) stays behind the gate.
  The checkout redirect works because the user's browser already holds the
  cached credentials for the origin.

**Demo credentials:** the username/password for the live POC are shared
separately / stored in the private delivery channel (not committed to this
repo).

## Cost notes

- **Postgres + host:** typically a few EUR/month or a free tier.
- **Mistral OCR:** pay-per-use on **your** key; each OCR is one
  `mistral-ocr-latest` call. Keep the demo in sandbox or limit access if you
  want to cap spend.
- **Freemius:** standard Freemius pricing applies to real (non-sandbox) sales.

## Decommissioning

1. Remove (or disable) the **webhook listener** and the **checkout redirect
   URL** in the Freemius Dashboard so Freemius stops calling a dead endpoint.
2. Stop / delete the app service on your host.
3. Delete the Postgres database (it holds only demo users, entitlement mirror
   rows, and OCR'd documents — no Freemius billing source data).
4. Revoke/rotate the keys if the instance was ever exposed: the Mistral key
   (Mistral console) and, if needed, regenerate the Freemius product keys.
5. Remove the env vars from the host's secret store.
