# Next.js → Vite/Hono porting (Checkout)

The React Starter Kit Checkout components are documented for Next.js. Porting
them to React + Vite / Hono is mechanical. This file lists only the
checkout-specific deltas; the general mapping is in the `freemius-core` Skill's
`vite-hono-notes.md`.

> **Vite/Hono is just the worked example.** The same port applies to any
> bundler + any backend with Web-Standard `Request`/`Response` routing — map the
> concepts (env-var prefix, path alias, dev proxy, the three endpoints below)
> onto the app's real stack.

## The two server endpoints the overlay needs

| Endpoint                | Method | Purpose                                                               |
| ----------------------- | ------ | --------------------------------------------------------------------- |
| `/api/checkout`         | GET    | Returns the user-scoped base `CheckoutSerialized` for the provider.   |
| `/api/checkout/pricing` | GET    | Returns `PricingResponse` (`subscription` + `oneoff`) for the tables. |
| `/api/purchase`         | POST   | The overlay `purchaseCompleted` callback target (entitlement sync).   |

`/api/purchase` and the entitlement sync are implemented in `freemius-core`;
this Skill only _calls_ them.

## Environment variables

- The overlay is primed entirely from the **server-created** checkout, so the
  browser needs **no** Freemius keys.
- If you reference any config in client code, it must be `VITE_`-prefixed and is
  therefore public. Never put `FREEMIUS_SECRET_KEY` / `FREEMIUS_API_KEY` behind
  a `VITE_` var.
- `import.meta.env.VITE_*` replaces `process.env.NEXT_PUBLIC_*`.

## Path alias

The ported components import shared types via `@shared` and frontend code via
`@`. Mirror the Starter Kit's `@/` alias in `vite.config.ts`:

```ts
// vite.config.ts
resolve: {
  alias: {
    '@': fileURLToPath(new URL('./src/web', import.meta.url)),
    '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  },
},
```

## Dev proxy

The React app and Hono API run on separate ports in dev. Proxy `/api` to the
Hono server so the overlay's sync POST and the pricing fetch hit the backend:

```ts
// vite.config.ts
server: {
  proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
},
```

## What stays identical

- The `@freemius/checkout` overlay logic (`new Checkout(...)`, `open()`,
  `purchaseCompleted`).
- The component structure, props, and shadcn/ui styling.
- Plan IDs and prices always originate server-side from the Freemius dashboard.
