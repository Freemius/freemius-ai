# Cancellation + retention coupon

Cancellation is a small wizard, not a single button — it gives you a chance to
retain the customer before the renewal is cancelled.

## The three steps

1. **Disclaimer** — explain the subscription stays active until period end, then
   stops renewing. Offer "Keep my plan" as the easy out.
2. **Retention coupon** _(only if available)_ — if
   `subscription.applyRenewalCancellationCouponUrl` is set and
   `data.cancellationCoupons[0]` exists, offer the discount. Accepting it
   applies the coupon and aborts the cancellation.
3. **Feedback** — optional reason + free-text, then confirm.

## Signed URLs used

| URL                                              | Method | Body                                   |
| ------------------------------------------------ | ------ | -------------------------------------- |
| `subscription.applyRenewalCancellationCouponUrl` | POST   | `{ couponId }`                         |
| `subscription.cancelRenewalUrl`                  | POST   | `{ feedback?, reason_ids?: string[] }` |

Both are pre-signed; the headless processor verifies the token server-side.

## Wizard (ported, condensed)

```tsx
function CancellationWizard({
  subscription,
  coupons,
  fetcher,
  onClose,
  onDone,
}) {
  const couponOffer =
    subscription.applyRenewalCancellationCouponUrl && coupons?.[0]
      ? coupons[0]
      : null;
  const [step, setStep] = useState<'disclaimer' | 'coupon' | 'feedback'>(
    'disclaimer'
  );
  const [reasonId, setReasonId] = useState('');
  const [feedback, setFeedback] = useState('');

  const [error, setError] = useState<string | null>(null);

  const applyCoupon = async () => {
    // ⛔️ couponId is REQUIRED — the SDK's SubscriptionRenewalCouponAction
    // validates `{ couponId: string().min(1) }`. An empty `{}` body → HTTP 400
    // ("expected string, received undefined"), NO redemption. Send the real id.
    const res = await fetcher(subscription.applyRenewalCancellationCouponUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ couponId: couponOffer!.coupon_id }),
    });
    // ⛔️ portalFetch returns the raw Response and does NOT throw on 4xx/5xx.
    // If you skip this check, a failed apply looks identical to success (popup
    // closes, 0 redemptions) — the exact silent-failure bug to avoid.
    if (!res.ok) {
      setError('Could not apply the discount. Please try again.');
      return; // keep the wizard open; do NOT onDone()
    }
    onDone();
  };

  const confirmCancel = async () => {
    const res = await fetcher(subscription.cancelRenewalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback: feedback || undefined,
        reason_ids: reasonId ? [reasonId] : undefined,
      }),
    });
    if (!res.ok) {
      setError('Could not cancel. Please try again.');
      return;
    }
    onDone();
  };

  // disclaimer → setStep(couponOffer ? 'coupon' : 'feedback')
  // coupon     → applyCoupon() (stay) | setStep('feedback') (continue)
  // feedback   → confirmCancel()
}
```

## Cancellation reasons

Freemius accepts standard reason ids; present them as a dropdown and send
`reason_ids`. Typical set:

```ts
const CANCELLATION_REASONS = [
  { id: '2', label: 'Too expensive' },
  { id: '3', label: 'Missing features' },
  { id: '4', label: 'Found a better product' },
  { id: '5', label: 'No longer needed' },
  { id: '1', label: 'Other' },
];
```

## Notes

- **The apply-coupon POST body MUST be `{ couponId: <coupons[0].coupon_id> }`.**
  The SDK action rejects an empty `{}` with **HTTP 400** and applies nothing
  (Dashboard redemptions stays 0, the discount never lands). Pass the real
  `coupon_id` from `data.cancellationCoupons[0]` — never an empty body.
- **Always check `res.ok` on every signed portal action** (`applyCoupon`,
  `confirmCancel`, billing update). The auth-aware fetcher returns the raw
  `Response` and does **not** throw on non-2xx — an unchecked call closes the
  wizard as if it succeeded while nothing happened. On failure: show a visible
  error and keep the wizard open; on success: `onDone()` (close + reload).
- **Only offer the coupon when both** `applyRenewalCancellationCouponUrl` **and
  a coupon** exist — otherwise skip straight to feedback.
- A coupon must be configured in the dashboard (Product → Coupons, renewal
  discount) for `cancellationCoupons` to be populated.
- Re-fetch `?action=portal_data` after cancel/coupon so the UI reflects the new
  `cancelledAt` / renewal state.
- Cancelling only stops **renewal**; access continues until the period ends —
  the portal shows `cancelledAt` ("Canceled — active until period end", see
  [subscription-and-upgrade.md](subscription-and-upgrade.md) for the exact
  display semantics).
- Your local entitlement mirror learns about the cancellation via
  `freemius-core`'s webhooks (see SKILL.md → "Post-action sync").
- The retention coupon is a **churn-reduction feature** (a real Dashboard coupon
  offered at cancellation) — it has nothing to do with testing; test purchases
  use **sandbox mode**, not coupons.
