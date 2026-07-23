# Runtime & expected interfaces (+ Vite/Hono porting example)

What the Freemius pieces expect from the app's stack — check these before
picking or adapting a framework:

1. **JS SDK (`@freemius/sdk`)** runs on **Node.js, Deno, or Bun**.
2. The SDK's API relies on **Web-Standard `Request`/`Response` based routing**.
   Any framework that supports it can be used directly (Hono, Next.js route
   handlers, serverless Fetch handlers, …). For anything else, write a small
   compatible adapter that converts the framework's request/response objects
   to/from `Request`/`Response`.
3. The **React Starter Kit** is **React 19+** with **shadcn UI + Tailwind**.
   Install with the official shadcn CLI:
   `npx shadcn@latest add https://shadcn.freemius.com/all.json`. If the app is
   not using shadcn/React, use the Starter Kit as a **reference** to implement
   the UI in any other framework.

## The endpoints the flow needs

Whatever the framework, the integration exposes the same surface:

```
POST /api/checkout            create server-side checkout (link + overlay options)
GET  /api/checkout/redirect   hosted-checkout redirect handler → syncs entitlement
POST /api/purchase            overlay success callback → syncs entitlement
POST /api/webhooks/freemius   webhook listener → license-lifecycle sync
GET|POST /api/portal          customer portal session (freemius-customer-portal Skill)
GET  /api/entitlement         read current entitlement for UI gating
POST /api/ocr (example)       a paywall-guarded premium feature
```

## Env var split

- **Server only** (never exposed to the browser bundle): `FREEMIUS_PRODUCT_ID`,
  `FREEMIUS_API_KEY`, `FREEMIUS_SECRET_KEY`, `FREEMIUS_PUBLIC_KEY`,
  `DATABASE_URL`, `PUBLIC_APP_URL`, and any third-party API keys.
- **Browser-safe** (framework-specific public prefix, e.g. `VITE_`,
  `NEXT_PUBLIC_`; optional): e.g. a public API base URL.

Anything with a public prefix is bundled into client JS and is public. Keep all
Freemius keys server-side.

## Example: porting the Next.js-flavored docs to React + Vite / Hono

The upstream Freemius docs and React Starter Kit examples assume **Next.js**. On
a **React + Vite / Hono + TS** stack the mapping is shallow and mechanical. The
SDK calls do not change — they are server-side either way and land in Hono
routes.

| Next.js pattern                                  | React + Vite / Hono replacement                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `getServerSideProps` / server data loading       | Hono route the React app `fetch`es (e.g. `POST /api/checkout`, `GET /api/portal`) |
| `next/headers`, server components                | Plain client components + the Hono API                                            |
| `process.env.NEXT_PUBLIC_*` in the browser       | `import.meta.env.VITE_*`                                                          |
| `process.env.*` server secrets                   | `process.env.*` in the Hono server (Node) — unchanged                             |
| `@/` path alias                                  | `resolve.alias` in `vite.config.ts` (one entry)                                   |
| Next API routes (`/pages/api/*`, route handlers) | Hono routes                                                                       |

### What does NOT change

- The Freemius **JS SDK** (`@freemius/sdk`) calls — always server-side, always
  in server services.
- The frontend **Checkout SDK** (`@freemius/checkout`) overlay logic — same
  props/behavior.
- Starter Kit component logic and styling (shadcn/ui + Tailwind) port unchanged.
