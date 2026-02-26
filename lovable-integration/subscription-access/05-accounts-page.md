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
  } | null;
  payments: {
    id: string;
    gross: number;
    vat: number;
    currency: string;
    // In YYYY-MM-DD HH:mm:ss format
    created: string;
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

  const data: SubscriptionPaymentData = {
    subscription: subscription
      ? {
          id: subscription.id!,
          cyclePricing: subscription.amount_per_cycle!,
          frequency: subscription.billing_cycle === 12 ? 'annual' : 'monthly',
          nextPayment: subscription.next_payment!,
          isCancelled: subscription.canceled_at !== null,
          canceledAt: subscription.canceled_at ?? null,
        }
      : null,
    payments:
      payments?.map((payment) => ({
        id: payment.id!,
        gross: payment.gross!,
        vat: payment.vat!,
        currency: payment.currency!,
        created: payment.created!,
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

1. Create a new page `/accounts` in the front-end, make sure the link is visible
   in the navigation menu.
2. Make supabase function call to `functions/v1/get-account`
3. If has `entitlement` show a block explaining subscription.
   1. Subscription is inactive if `isCancelled` is `true`. Use `canceledAt` to
      show when it was cancelled. Use `entitlement.expiration` to show uptil
      when user can access benefits. Add a button "Subscribe" that takes the
      user to the `/pricing` page to purchase a new subscription.
   2. Subscription is active if `isCancelled` is `false`. Use information from
      the the `SubscriptionPaymentData` to render a nice UI.
   3. Show a "Change Plan" or "Subscribe Again" button based on the subscription
      status that takes the user to the `/pricing` page to purchase a new
      subscription.
   4. Show a "Cancel Subscription" button if the subscription is active.
      Clicking it will call the `functions/v1/cancel-subscription` API route to
      cancel the subscription and then update the UI accordingly.
4. If has `entitlement` show a "Payment History" block where you show the list
   of payments from the `SubscriptionPaymentData`.
   - Show the amount first with just currency symbol and then date with a nice
     icon and formatting.
   - If `type` is `refund` show a refund icon and make the amount red to
     indicate it was a refund with `-` sign before the amount.
   - Clicking on a payment will call the `functions/v1/download-invoice` API
     route to view the invoice for that payment. Show the invoice in new tab.
5. If has `entitlement` show a "Manage Subscription" button that will take the
   user to the Freemius Customer Portal. For this, make another API call to
   `functions/v1/get-customer-portal-link` to get the link and then open it in a
   new tab.
   1. If the browser fails to open the tab (due to popup blockers), then show
      the link to the user and ask them to open it manually.
   2. The URL must be visible very prominently and clicking it should
      immediately open the link in a new tab.
   3. Do show a UI saying the link will expire in 5 mins. You can also add a
      timer counting down to when the link will expire.
   4. Hide the URL after 5 mins because it will expire and show the main button
      again.
6. If no `entitlement` show a message saying "You don't have an active
   subscription" and show a "Subscribe" button that takes to the `/pricing`
   page.

### User Interface

#### No Subscription State

- Show a centered card: "You don't have an active subscription" with a
  "Subscribe" button linking to `/pricing`.

#### Active Subscription Card

- Header row: label "CURRENT SUBSCRIPTION" (uppercase, muted, tracking-widest)
  on the left, a small "Manage Billing" button (outline, with ExternalLink icon)
  on the right.
- **Manage Billing** calls `functions/v1/get-customer-portal-link`, opens the
  link in a new tab. If popup is blocked, show the link prominently inside a
  highlighted box with a 5-minute countdown timer. Hide the link and restore the
  button after expiry. Text should be "Your billing portal link is ready:
  [Click here](link) - expires in 5:00".
- Body: show price as `$X per month/year` in bold, renewal date below in muted
  text.
- If cancelled: show cancellation date and access expiration, with a "Reactivate
  Subscription" button linking to `/pricing`.
- If active: show "Update subscription" (primary) and "Cancel subscription"
  (outline) buttons side by side. Cancel calls
  `functions/v1/cancel-subscription`, refreshes account data, and shows a toast.

#### Payment History Card

- Header: "PAYMENTS" (same uppercase muted style).
- Each payment row: CreditCard icon → date formatted as "Mon DD, YYYY" → amount
  (`$X.XX`) → small Badge ("Paid" secondary or "Refund" destructive) → "Invoice"
  outline button with FileText icon.
- Invoice download: use `fetch()` with `Authorization: Bearer` header (never
  `window.open` for authenticated endpoints), convert response to blob, open via
  `URL.createObjectURL`.

#### General UI Rules

- Use semantic design tokens (bg-background, text-muted-foreground, etc.), never
  raw colors.
- Cards use `p-6`, sections separated by `<Separator />`.
- All buttons show a `Loader2` spinner when their action is in progress.

### Frontend Edge Function Calls

Never use `window.open()` or `<a href>` to call authenticated edge functions
directly — browsers don't send Authorization headers with those methods.

Instead, always use `fetch()` with the user's session token, then create a blob
URL for file downloads:

```ts
const {
  data: { session },
} = await supabase.auth.getSession();
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${session.access_token}` },
});
const blob = await res.blob();
window.open(URL.createObjectURL(blob), '_blank');
```

When making function calls show a spinner/loading to the button that triggers
the call and disable it while loading.
