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

// Ported Starter Kit component (Next.js → Vite/Hono). The Freemius docs assume
// Next.js; the only changes here are env access and the post-purchase sync endpoint
// (our Hono `POST /api/purchase`). The component logic is otherwise unchanged.
// See skills/freemius-checkout/references/vite-hono-porting.md.

type OpenOptions = Partial<Omit<CheckoutPopupOptions, 'plugin_id'>> & {
  // arbitrary extra params (plan_id, billing_cycle, trial, coupon, …)
  [key: string]: unknown;
};

// `CheckoutResponse` is declared but not exported by @freemius/checkout, so we
// recover the post-purchase payload type from the `purchaseCompleted` callback
// of Checkout.open() — the single source of truth for the overlay's success data.
type PurchaseCompleted = NonNullable<
  Parameters<Checkout['open']>[0]
>['purchaseCompleted'];
type CheckoutResponse = Parameters<NonNullable<PurchaseCompleted>>[0];

type CheckoutContextValue = {
  /** Open the Freemius Checkout overlay. Extra options override the base ones. */
  open: (options?: OpenOptions) => Promise<void>;
  /** Programmatically close the overlay. */
  close: () => void;
};

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

export type CheckoutProviderProps = {
  /** Server-created checkout (from the SDK's `checkout.serialize()`). */
  checkout: CheckoutSerialized;
  /**
   * Backend endpoint that records the purchase after a successful checkout.
   * Maps to our Hono `POST /api/purchase` (overlay success callback).
   */
  syncEndpoint: string;
  /** Optional fetch wrapper so callers can attach auth headers. */
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Called after a successful purchase has been synced (e.g. refresh entitlement). */
  onPurchase?: () => void;
  children: ReactNode;
};

export function CheckoutProvider({
  checkout,
  syncEndpoint,
  fetcher = fetch,
  onPurchase,
  children,
}: CheckoutProviderProps) {
  // Keep one Checkout instance for the provider's lifetime. The `checkout` object
  // must be stable between renders to avoid recreating the overlay (per the docs).
  const instanceRef = useRef<Checkout | null>(null);

  if (instanceRef.current === null) {
    instanceRef.current = new Checkout(
      checkout.options as unknown as CheckoutOptions,
      false,
      checkout.baseUrl ?? null
    );
  }

  useEffect(() => {
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  const value = useMemo<CheckoutContextValue>(() => {
    const syncPurchase = async (data: CheckoutResponse | null) => {
      if (!data) return;
      // POST the post-purchase payload to the backend, which re-fetches the
      // authoritative purchase from Freemius and upserts the entitlement.
      await fetcher(syncEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).catch((err) => console.error('[checkout] purchase sync failed', err));
      onPurchase?.();
    };

    return {
      open: (options: OpenOptions = {}) =>
        instanceRef.current!.open({
          // Skip Freemius' post-purchase confirmation modal — the app shows its
          // own in-app success state (better UX). Callers can still override.
          show_confirmation_dialog: false,
          ...options,
          purchaseCompleted: (data) => {
            void syncPurchase(data);
          },
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

/** Access the Freemius Checkout overlay anywhere inside <CheckoutProvider>. */
export function useCheckout(): CheckoutContextValue {
  const ctx = useContext(CheckoutContext);
  if (!ctx) {
    throw new Error('useCheckout must be used within a <CheckoutProvider>.');
  }
  return ctx;
}
