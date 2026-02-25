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
                  frequency:
                      subscription.billing_cycle === 12 ? 'annual' : 'monthly',
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
4. If has `entitlement` show a "Payment History" block where you show the list
   of payments from the `SubscriptionPaymentData`. Show the amount first with
   just currency symbol and then date with a nice icon and formatting. If `type`
   is `refund` show a refund icon and make the amount red to indicate it was a
   refund with `-` sign before the amount.
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
