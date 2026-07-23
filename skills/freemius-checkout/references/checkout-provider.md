# Checkout Provider

A React context that owns a single `@freemius/checkout` `Checkout` instance and
exposes `useCheckout()` to open/close the overlay anywhere below it.

## Why a provider

- The overlay SDK expects **one** long-lived instance per page; recreating it on
  every render leaks iframes and breaks the cart-recovery flow.
- Every "Subscribe" / "Buy" / "Upgrade" button shares that one instance.
- The post-purchase sync (POST to your backend) is wired once, centrally.
- The provider is also where the two checkout defaults live:
  `show_confirmation_dialog: false` (skip Freemius' confirmation modal) and the
  in-app success message that replaces it.

## Props

| Prop           | Type                                                | Purpose                                                        |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `checkout`     | `CheckoutSerialized` (`{ options, link, baseUrl }`) | Server-created base checkout from `GET /api/checkout`.         |
| `syncEndpoint` | `string`                                            | Backend route the success callback POSTs to (`/api/purchase`). |
| `fetcher`      | `(url, init?) => Promise<Response>`                 | Optional; attach auth headers (defaults to `fetch`).           |
| `onPurchase`   | `() => void`                                        | Called after a successful purchase is synced (refresh UI).     |

## Implementation (ported, editable)

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  Checkout,
  type CheckoutOptions,
  type CheckoutPopupOptions,
} from '@freemius/checkout';
import type { CheckoutSerialized } from '@shared/types';

type OpenOptions = Partial<Omit<CheckoutPopupOptions, 'plugin_id'>> & {
  [key: string]: unknown; // plan_id, billing_cycle, trial, coupon, …
};

// CheckoutResponse is declared-but-not-exported by @freemius/checkout, so recover
// it from the open() callback signature — the single source of truth.
type PurchaseCompleted = NonNullable<
  Parameters<Checkout['open']>[0]
>['purchaseCompleted'];
type CheckoutResponse = Parameters<NonNullable<PurchaseCompleted>>[0];

type CheckoutContextValue = {
  open: (options?: OpenOptions) => Promise<void>;
  close: () => void;
};
const CheckoutContext = createContext<CheckoutContextValue | null>(null);

export function CheckoutProvider({
  checkout,
  syncEndpoint,
  fetcher = fetch,
  onPurchase,
  children,
}: {
  checkout: CheckoutSerialized;
  syncEndpoint: string;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  onPurchase?: () => void;
  children: ReactNode;
}) {
  const instanceRef = useRef<Checkout | null>(null);
  if (instanceRef.current === null) {
    instanceRef.current = new Checkout(
      checkout.options as unknown as CheckoutOptions,
      false,
      checkout.baseUrl ?? null
    );
  }
  useEffect(
    () => () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    },
    []
  );

  const value = useMemo<CheckoutContextValue>(() => {
    const syncPurchase = async (data: CheckoutResponse | null) => {
      if (!data) return;
      await fetcher(syncEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).catch((err) => console.error('[checkout] sync failed', err));
      onPurchase?.();
    };
    return {
      open: (options: OpenOptions = {}) =>
        instanceRef.current!.open({
          // Default: skip Freemius' post-purchase confirmation modal — the app
          // shows its own success state (see "In-app success message" below).
          show_confirmation_dialog: false,
          ...options,
          purchaseCompleted: (data) => void syncPurchase(data),
        }),
      close: () => instanceRef.current?.close(),
    };
  }, [fetcher, syncEndpoint, onPurchase]);

  return (
    <CheckoutContext.Provider value={value}>
      {children}
    </CheckoutContext.Provider>
  );
}

export function useCheckout(): CheckoutContextValue {
  const ctx = useContext(CheckoutContext);
  if (!ctx)
    throw new Error('useCheckout must be used within a <CheckoutProvider>.');
  return ctx;
}
```

## The `syncEndpoint` backend (`POST /api/purchase`) — copy this shape

`syncEndpoint` above is `/api/purchase`. That backend route receives the overlay
`purchaseCompleted` **payload as a JSON body** (not a signed redirect). It reads
the license id from the payload and calls `syncEntitlementByLicenseId` — the
same idempotent upsert the webhooks use. Keep it this simple:

```ts
// server: routes/purchase.ts  — mounted at POST /api/purchase
import { Hono } from 'hono';
import { requireUser } from '../middleware/auth';
import { syncEntitlementByLicenseId } from '../services/freemius/entitlement';

export const purchaseRoute = new Hono();

// The overlay's purchaseCompleted(data) callback POSTs `data` here. Its shape
// varies by @freemius/checkout version — pull the license id defensively.
purchaseRoute.post('/', requireUser, async (c) => {
  const data = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const licenseId =
    (data as any)?.purchase?.license_id ??
    (data as any)?.license_id ??
    (data as any)?.licenseId;
  if (!licenseId) return c.json({ error: 'no_license_in_payload' }, 400);

  // Re-fetch the authoritative purchase from Freemius and upsert the row.
  await syncEntitlementByLicenseId(String(licenseId));
  return c.json({ ok: true });
});
```

> ⛔️ **Do NOT implement `/api/purchase` with
> `freemius.checkout.request.createProcessor(...)` or
> `freemius.checkout.processRedirect(...)`.** Those are for the **signed hosted
> redirect** (`GET /api/checkout/redirect`), not the overlay POST. Feeding the
> overlay JSON body into them returns
> **`400 "License ID is required in the request body"`**, the frontend
> `.catch()` hides it, and **no entitlement is ever written** (empty
> `user_fs_entitlement` for every user, app looks fine). The overlay POST and
> the hosted redirect are two different endpoints with two different payload
> contracts — keep them apart.

## In-app success message

With `show_confirmation_dialog: false` (the default above), Freemius shows no
post-purchase modal — **the app must confirm the purchase itself**, or the user
pays and sees nothing change. Wire it in `onPurchase`, after the
`purchaseCompleted → POST /api/purchase` sync:

```tsx
// Wherever the provider is mounted:
<CheckoutProvider
  checkout={checkout}
  syncEndpoint="/api/purchase"
  fetcher={portalFetch}
  onPurchase={async () => {
    const next = await refreshEntitlement(); // re-fetch entitlement (and credit balance)
    // Branch the copy on WHAT WAS ACTUALLY BOUGHT — three distinct cases.
    // Never show "credits added" for a subscription (a common, maker-reported bug).
    const tier = next?.tier; // 'premium' | 'pro' | 'lifetime' | undefined
    toast.success(
      tier === 'lifetime'
        ? 'Purchase complete — Lifetime access unlocked.'
        : tier // an active subscription (premium/pro)
          ? `Purchase complete — ${tier} unlocked.`
          : 'Purchase complete — page credits added to your account.' // credits top-up
    );
  }}
>
```

- Use whatever the app already has for transient feedback (toast, banner, an
  inline success card) — the pattern matters, not the widget.
- **Clear stale gate state.** `onPurchase` fires after the sync POST resolves,
  so the entitlement is already written server-side. Alongside the success
  message and entitlement re-check, also hide the paywall **and clear any inline
  gate error/result** the gated action set on its 402 (e.g. "need subscription"
  / "upgrade"). Otherwise that stale message lingers on the gated surface until
  a manual reload even though the user is now entitled. (Auto-retrying the
  original action is an optional nicety, not required.)
- The message must reflect the **synced** state (fires after the `/api/purchase`
  POST), so "premium unlocked" is true when shown.
- **Hosted-redirect path:** hosted checkouts (and upgrades opened via
  `window.location.href = link`) return by **redirecting the browser** to
  `/checkout-result?success=true|false`, NOT via the overlay `purchaseCompleted`
  callback. That path needs a **real SPA route** `/checkout-result` (in
  `App.tsx` `<Routes>`) that refreshes entitlement + shows the confirmation +
  routes the user onward. If the route is missing the user lands on a **blank
  page with only the header** after paying. See `freemius-core` →
  purchase-processing.md → "Hosted-checkout redirect handler" for the required
  page. Don't leave it as a bare redirect back to the app.

## Gotchas

- **`CheckoutResponse` is not exported.** Recover it from the callback type as
  above — don't import it.
- **`CheckoutOptions` differs between packages.** The SDK (`@freemius/sdk`) and
  the overlay (`@freemius/checkout`) each declare a `CheckoutOptions`. Keep the
  serialized shape loose (`Record<string, unknown>`) in shared types and cast at
  the `new Checkout(...)` boundary.
- **`purchaseCompleted` vs `success`.** Both fire on a completed purchase;
  `purchaseCompleted` is the modern callback. Wire one and POST the payload.
- **Stability.** Keep the `checkout` prop stable across renders (load it once,
  store in state) so the instance isn't torn down mid-flow.
