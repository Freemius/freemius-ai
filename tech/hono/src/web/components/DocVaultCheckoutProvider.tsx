import { useEffect, useState, type ReactNode } from 'react';
import type { CheckoutSerialized } from '@shared/types';
import { CheckoutProvider } from '../react-starter/components/checkout-provider';
import { getBaseCheckout, portalFetch } from '../api';

// App glue: load the user-scoped base checkout from the backend, then wrap children
// in the ported Starter Kit <CheckoutProvider>. While the base checkout is still
// loading we must NOT render children that call useCheckout() (e.g. the pricing
// tables) outside the provider — that throws. So we hold a loading state until the
// fetch settles, then either provide the context or, on failure, degrade to plain
// children (so feature pages like OCR still work).

type Props = {
  /** Refresh entitlement after a successful purchase. */
  onPurchase: () => void;
  children: ReactNode;
};

export function DocVaultCheckoutProvider({ onPurchase, children }: Props) {
  const [checkout, setCheckout] = useState<CheckoutSerialized | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBaseCheckout()
      .then(setCheckout)
      .catch(() => setCheckout(null))
      .finally(() => setLoading(false));
  }, []);

  // Don't mount children before the checkout context is ready — a component that
  // calls useCheckout() during this window would throw.
  if (loading) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  // Fetch settled but failed: render children without a provider so non-checkout
  // pages still work. (Checkout-dependent pages will surface their own error.)
  if (!checkout) return <>{children}</>;

  return (
    <CheckoutProvider
      checkout={checkout}
      syncEndpoint="/api/purchase"
      fetcher={portalFetch}
      onPurchase={onPurchase}
    >
      {children}
    </CheckoutProvider>
  );
}
