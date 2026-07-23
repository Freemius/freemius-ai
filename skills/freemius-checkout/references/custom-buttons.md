# Custom checkout buttons

The pricing tables are just one consumer of `useCheckout()`. Any element can
open the overlay — a nav "Upgrade" button, an empty-state CTA, an inline "Buy
more credits" link.

## The pattern

Anything inside `<CheckoutProvider>` can call `open()`:

```tsx
function UpgradeButton({ planId }: { planId: string }) {
  const checkout = useCheckout();
  return (
    <button
      className="btn"
      onClick={() =>
        checkout.open({ plan_id: planId, billing_cycle: 'annual' })
      }
    >
      Upgrade to Pro
    </button>
  );
}
```

## Passing checkout parameters

`open(options)` accepts any Freemius Checkout query param; common ones:

| Param                      | Use                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `plan_id`                  | Target a specific plan.                                                                         |
| `billing_cycle`            | `monthly` \| `annual` \| `lifetime` (the modality switch).                                      |
| `show_confirmation_dialog` | **Default `false`** — skip Freemius' confirmation modal; the app shows its own success message. |
| `trial`                    | `free` / `paid` to start a trial instead of an immediate charge.                                |
| `coupon`                   | Pre-apply a coupon code.                                                                        |
| `licenses`                 | Seat count for per-seat plans.                                                                  |

```tsx
// Start a free trial of a plan:
checkout.open({ plan_id, trial: 'free' });

// Pre-fill a coupon:
checkout.open({ plan_id, coupon: 'LAUNCH20' });
```

## Don't bypass the provider

- Don't `new Checkout(...)` per button — share the one provider instance.
- Don't put secrets or hardcoded plan IDs in the button; pull `planId` from the
  server pricing response.
- The success path is identical regardless of which button opened the overlay:
  the provider's `purchaseCompleted` callback POSTs to your `syncEndpoint`.

## Buttons outside the provider

If a button lives outside the React tree wrapped by `<CheckoutProvider>` (e.g. a
global nav), either lift the provider higher, or fall back to the hosted
`checkoutLink` from the pricing response:

```tsx
<a className="btn" href={plan.checkoutLink}>
  Upgrade
</a>
```

The hosted link redirects to Freemius and back to your purchase-redirect handler
(see `freemius-core` → purchase-processing), so the entitlement still syncs.
