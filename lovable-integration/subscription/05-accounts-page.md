# Step 5: Create Accounts Page

Create an accounts page where the user can see their subscription status,
payments list and get a link to Freemius Customer Portal to manage their
subscription.

## Backend API Routes

### New route under `supabase/functions/get-account/index.ts`:

```typescript
import { getUserEntitlement, freemius } from '../_shared/freemius'; // Correct the path

type SubscriptionPaymentData = {
  subscription: {
    id: string;
    cyclePricing: number;
    frequency: 'annual' | 'monthly';
    // In YYYY-MM-DD HH:mm:ss format
    nextPayment: string;
    isCancelled: boolean;
    // In YYYY-MM-DD HH:mm:ss format or null
    canceledAt: string | null;
    planTitle: string | null;
    unitTitle: string | null;
  } | null;
  payments: {
    id: string;
    gross: number;
    vat: number;
    currency: string;
    // In YYYY-MM-DD HH:mm:ss format
    created: string;
    planTitle: string | null;
    unitTitle: string | null;
    type: 'payment' | 'refund';
    isRenewal: boolean;
  }[];
};

async function getSubscriptionAndPayments(
  entitlement: Pick<PurchaseEntitlementData, 'fsLicenseId' | 'fsUserId'>
): Promise<SubscriptionPaymentData> {
  const subscription = await freemius.api.license.retrieveSubscription(
    entitlement.fsLicenseId
  );
  const payments = await freemius.api.user.retrievePayments(
    entitlement.fsUserId
  );
  const pricingData = await freemius.api.product.retrievePricingData();

  const planTitleById = new Map<string, string>();
  const pricingById = new Map<string, { quota: number }>();

  pricingData?.plans?.forEach((plan) => {
    planTitleById.set(plan.id!, plan.title!);

    plan.pricing?.forEach((pricing) => {
      pricingById.set(pricing.id!, {
        quota: pricing.licenses ?? 1,
      });
    });
  });

  function formatQuota(quota: number | null): string | null {
    if (!quota || quota === 1) {
      return null;
    }

    const singular =
      pricingData?.plugin?.selling_unit_label?.singular ?? 'Unit';
    const plural = pricingData?.plugin?.selling_unit_label?.plural ?? 'Units';

    return `${quota} ${quota === 1 ? singular : plural}`;
  }

  const data: SubscriptionPaymentData = {
    subscription: subscription
      ? {
          id: subscription.id!,
          cyclePricing: subscription.amount_per_cycle!,
          frequency: subscription.billing_cycle === 12 ? 'annual' : 'monthly',
          nextPayment: subscription.next_payment!,
          isCancelled: subscription.canceled_at !== null,
          canceledAt: subscription.canceled_at ?? null,
          planTitle: planTitleById.get(subscription.plan_id!) ?? 'Unknown Plan',
          unitTitle: formatQuota(
            pricingById.get(subscription.pricing_id!)?.quota ?? null
          ),
        }
      : null,
    payments:
      payments?.map((payment) => ({
        id: payment.id!,
        gross: payment.gross!,
        vat: payment.vat!,
        currency: payment.currency!,
        created: payment.created!,
        planTitle: planTitleById.get(payment.plan_id!) ?? 'Unknown Plan',
        type: payment.type === 'payment' ? 'payment' : 'refund',
        unitTitle: formatQuota(
          pricingById.get(payment.pricing_id!)?.quota ?? null
        ),
        isRenewal: payment.is_renewal ?? false,
      })) ?? [],
  };

  return data;
}

const userId = '...'; // Get the user ID from the session or authentication context
const entitlement = await getUserEntitlement(userId);

const subscriptionAndPayments = entitlement
  ? await getSubscriptionAndPayments(entitlement)
  : null;

// The return needs to be of the shape { entitlement: Entitlement | null, subscriptionAndPayments: SubscriptionPaymentData | null }
```

### New route under `supabase/functions/get-customer-portal-link/index.ts`

This will return the Freemius Customer Portal link for the logged in user:

```typescript
import { freemius } from '../_shared/freemius'; // Correct the path

// Using the email address
const { link } = await freemius.api.user.retrieveHostedCustomerPortalByEmail(
  '...' // Email address of the logged in user, which you can get from the session
);
```

### New route under `supabase/functions/cancel-subscription/index.ts`

```typescript
import { getUserEntitlement, cancelSubscription } from '../_shared/freemius'; // Correct the path

const userId = '...'; // Get the user ID from the session or authentication context
const entitlement = await getUserEntitlement(userId);

if (!entitlement) {
  // Handle case where user has no entitlement
  // Return appropriate response, e.g. { success: false, message: 'No active subscription' }
}

const cancellationResult = await cancelSubscription(entitlement);

// Return appropriate response based on cancellationResult, e.g. { success: cancellationResult }
```

### New route under `supabase/functions/download-invoice/index.ts`

```typescript
import { freemius } from '../_shared/freemius'; // Correct the path

const userId = '...'; // Get the user ID from the session or authentication context
const url = new URL(request.url);
const paymentId = url.searchParams.get('payment_id');

const invoice = await freemius.api.user.retrieveInvoice(userId, paymentId);

// Return the blob with the correct headers to trigger inline display or download of the invoice PDF in the browser
// Content-Type: application/pdf
// Content-Disposition: inline; filename="invoice.pdf"
```

## Front-end Implementation

### Setup

1. Create a new page `/accounts` in the front-end and add the link to the
   navigation menu.
2. On page load, call `functions/v1/get-account` to fetch entitlement and
   subscription data.
3. Render the appropriate UI based on whether the user has an active
   subscription.

### General UI Rules

- Use semantic design tokens (bg-background, text-muted-foreground, etc.), never
  raw colors.
- Cards use `p-6`, sections separated by `<Separator />`.
- All buttons show a `Loader2` spinner when their action is in progress.

### Managing Authenticated API Calls

Never use `window.open()` or `<a href>` to call authenticated edge functions
directly — browsers don't send Authorization headers with those methods.

Instead, always use `fetch()` with the user's session token:

```ts
const {
  data: { session },
} = await supabase.auth.getSession();
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${session.access_token}` },
});
```

For file downloads (invoices), convert the response to a blob and open via
`URL.createObjectURL`:

```ts
const blob = await res.blob();
window.open(URL.createObjectURL(blob), '_blank');
```

### No Subscription State

If the user has no active entitlement:

- Display a centered card with the message "You don't have an active
  subscription".
- Include a "Subscribe" button linking to `/pricing`.

### Active Subscription Card

If the user has an active entitlement, display a subscription card with:

**Header:**

- Label "CURRENT SUBSCRIPTION" (uppercase, muted, tracking-widest) on the left.
- A small "Manage Billing" button (outline style, with ExternalLink icon) on the
  right.

**Manage Billing interaction:**

- Call `functions/v1/get-customer-portal-link` to get the Freemius portal link.
- Attempt to open it in a new tab. If blocked by popup blocker:
  - Show the link prominently in a highlighted box.
  - Display text: "Your billing portal link is ready: [Click here](link) -
    expires in 4:00".
  - Show a 4-minute countdown timer.
  - After expiry, hide the link and restore the button.

**Body content:**

- A small badge showing the plan title (from subscription.planTitle) and
  optionally the unit title (e.g. "5 Seats" from subscription.unitTitle).
- Display the price as `$X per month/year` in bold.
- Show the renewal date below in muted text.

**Handle subscription states:**

- **If cancelled** (`isCancelled` is `true`):
  - Show the cancellation date (`canceledAt`).
  - Show the access expiration date (`entitlement.expiration`).
  - Display a "Subscribe Again" button linking to `/pricing`.

- **If active** (`isCancelled` is `false`):
  - Display two buttons one below the other:
    - "Update subscription" (primary) linking to `/pricing`.
    - "Cancel subscription" (outline in red border).
  - When "Cancel subscription" is clicked:
    - Show a confirmation dialog.
    - Make the "Keep subscription" button default and primary, and the "Cancel
      subscription" button as destructive and secondary (to the left of the keep
      button).
    - Call `functions/v1/cancel-subscription` to process cancellation.
    - Refresh the account data after success.
    - Show a toast notification.

### Payment History Card

If the user has entitlement, display a Payment History section:

**Header:**

- Label "PAYMENTS" (same uppercase muted style as subscription card).

**Payment rows:**

- CreditCard icon → date formatted as "Mon DD, YYYY" → amount (`$X.XX`) → Badge
  ("Paid" secondary or "Refund" destructive) → payment.planTitle and optionally
  payment.unitTitle in smaller muted text if present → "Invoice" outline button
  with PDF icon.
- For refunds, show a refund icon, make the amount red, and prefix with `-`
  sign.

**Invoice download:**

- Clicking an "Invoice" button calls
  `functions/v1/download-invoice?payment_id=<id>`.
- Use the authenticated fetch pattern above with the Authorization header.
- Convert response to blob and open via `URL.createObjectURL`.
