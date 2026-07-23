# Paywall

The feature UI is never hard-blocked in the browser. When the user hits a gated
action, the **server** returns HTTP 402; the frontend reacts by showing the
`Paywall` overlay with the correct pricing table.

## The authoritative gate is the server

The `freemius-core` Skill enforces the paywall on the backend:

```ts
const entitlement = await getUserEntitlement(userId);
if (!entitlement) return new Response('Payment required', { status: 402 });
```

The frontend paywall is **UX only** — it turns a 402 into a purchase
opportunity. Never rely on it for access control.

## usePaywall + Paywall

```tsx
import { useCallback, useState } from 'react';
import { Subscribe } from './subscribe';
import { Topup } from './topup';

export type PaywallState =
  | { kind: 'hidden' }
  | { kind: 'no_active_purchase' } // → show Subscribe
  | { kind: 'insufficient_credits' } // → show Topup
  | { kind: 'tier_upgrade_required' }; // → license-upgrade checkout, NEVER Subscribe

export function usePaywall() {
  const [state, setState] = useState<PaywallState>({ kind: 'hidden' });
  return {
    state,
    showNoActivePurchase: useCallback(
      () => setState({ kind: 'no_active_purchase' }),
      []
    ),
    showInsufficientCredits: useCallback(
      () => setState({ kind: 'insufficient_credits' }),
      []
    ),
    hidePaywall: useCallback(() => setState({ kind: 'hidden' }), []),
  };
}

export function Paywall({
  state,
  hidePaywall,
}: {
  state: PaywallState;
  hidePaywall: () => void;
}) {
  if (state.kind === 'hidden') return null;
  const isCredits = state.kind === 'insufficient_credits';
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-panel">
        <h2>{isCredits ? 'Top up to continue' : 'Subscribe to continue'}</h2>
        <button onClick={hidePaywall}>Close</button>
        {isCredits ? <Topup /> : <Subscribe />}
      </div>
    </div>
  );
}
```

## Wiring it to a gated action

```tsx
const paywall = usePaywall();

try {
  await runOcr(/* … */); // hits the server, which may gate with 402/403
} catch (e) {
  if (e instanceof ApiError && paywall.isGate(e)) {
    // Map the server's REASON to the right paywall state — never a generic error.
    paywall.showForReason(e); // no_active_purchase | insufficient_credits | tier_upgrade_required
  } else {
    // Only NON-entitlement failures (bad file, OCR engine error, network) get here.
    setError('OCR failed. Please try another file.');
  }
}

// …render the gated feature, then:
<Paywall state={paywall.state} hidePaywall={paywall.hidePaywall} />;
```

> ⛔️ **An entitlement/tier gate is NOT an error — never render it as "OCR
> failed. Please try another file."** A feature the user's tier doesn't include
> (e.g. image OCR on a Premium plan → the server returns a **`403`/`402` with a
> reason like `tier_upgrade_required` / `image_requires_pro`**) must open the
> **paywall with an upgrade path** (upgrade to Pro/Lifetime), not the generic
> failure toast. Branch on the status + reason BEFORE any catch-all "failed"
> message: a gate reason → paywall; anything else → the error message. Showing
> "failed" for a not-allowed feature is a bug the maker will report — the user
> thinks the app is broken when it's actually up-sell surface.

`Paywall` must live inside a `<CheckoutProvider>` so its embedded `Subscribe`/
`Topup` tables can open the overlay. After a successful purchase the provider's
`onPurchase` refreshes entitlement and the gated action succeeds on retry.

## Refresh the credit balance after a metered action (not just after purchase)

The same "refresh the displayed value after the state changes server-side" rule
applies to **consuming** credits, not only buying them. After a metered action
(e.g. an OCR run) succeeds, the server debits the balance (`credit -= pages`),
but the credit badge/display keeps showing the **old** value until something
re-fetches it — so the user sees "100 credits" after an OCR run until a manual
page reload. That stale badge is a bug the maker will report.

Fix it in the action's success handler, the mirror image of `onPurchase`:

```tsx
const result = await runOcr(/* … */); // server already debited the balance
setText(result.text);
// The metered action changed the balance server-side — refresh the displayed
// credits WITHOUT a full reload, the same way a purchase refreshes entitlement.
await onOcrComplete?.(); // = refreshEntitlement(): GET /api/entitlement → new `credit`
```

Choose the **simpler** of two paths (do not invent a new fetch path if one
exists):

- **(a) Use the balance already in the action's response.** If `POST /api/ocr`
  returns the new balance (e.g. `{ text, creditBalance }`), update local state
  from it directly — no extra round-trip.
- **(b) Re-call the existing refresh.** If the response does **not** carry the
  balance, call the same `refreshEntitlement()` the purchase flow uses (it hits
  `GET /api/entitlement`, which returns `credit`). Pass that refresher into the
  metered page (e.g. `<OcrPage onOcrComplete={refreshEntitlement} />`) and
  `await` it after success.

Only refresh the **display** — never touch the server deduction logic, which is
already correct (see
[freemius-core → references/entitlement-logic.md](../../freemius-core/references/entitlement-logic.md),
"Usage-based / credit metering").

## Choosing the right table

- **`no_active_purchase`** — the user has no active subscription → `Subscribe`.
- **`insufficient_credits`** — the user ran out of consumable units (one-off
  plans) → `Topup`.
- **`tier_upgrade_required`** — the user **has an active subscription** but the
  wrong tier for this feature → offer an **upgrade button wired to the server's
  license-upgrade checkout route** (e.g. `GET /api/checkout/upgrade?planId=…`,
  which fetches the license server-side and uses `setLicenseUpgradeByKey` — see
  `freemius-customer-portal` → `references/subscription-and-upgrade.md` for the
  route mechanics; do NOT use `checkout.create({ licenseId })`, it 500s for
  actively-renewing licenses). **NEVER show a plain `<Subscribe />` table to an
  already-subscribed user** — a plain subscribe checkout creates a **second
  parallel subscription** (double-billing) or hard-fails.

Distinguish these by what the server's 402 tells you (e.g. a reason field in the
error body), not by guessing on the client.
