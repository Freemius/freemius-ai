# Freemius Integration Guide

Implement the Freemius Integration with the App.

## Required Secrets

Add these secrets to your Cloud Backend (Settings → Secrets):

| Secret Name           | Description                                  | Where to Find                                                                                     |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FREEMIUS_PRODUCT_ID` | Your Freemius product/plugin ID              | Freemius Dashboard → Product → Settings                                                           |
| `FREEMIUS_PUBLIC_KEY` | Public key for client operations             | Freemius Dashboard → Product → Settings → Keys                                                    |
| `FREEMIUS_SECRET_KEY` | Secret key for webhook verification          | Freemius Dashboard → Product → Settings → Keys                                                    |
| `FREEMIUS_API_KEY`    | API key for server-to-server calls           | Freemius Dashboard → Product → Settings → Keys                                                    |
| `LIVE_FRONTEND_URL`   | Sticklight URL when the product is published | Click the "Publish" in the top right corner to copy the value. e.g. https://my-app.sticklight.com |

Next steps below:

---

# Step 1: Create Entitlement Table

We need to create a table called `user_fs_entitlement` with the following columns:

- `id` - The primary key.
- `user_id` - A foreign key referencing the user table. Value must match with the ID of the user in the auth system (text/string).
- `fs_license_id` - A unique identifier for the Freemius license (text/string).
- `fs_plan_id` - The Freemius plan ID (text/string).
- `fs_pricing_id` - The Freemius pricing ID (text/string).
- `fs_user_id` - The Freemius user ID (text/string).
- `type` - The entitlement type (e.g., subscription, lifetime, etc.). It could be an enum with value `subscription` or `lifetime`.
- `expiration` - The license expiration timestamp (nullable).
- `is_canceled` - A boolean flag indicating if the license is canceled.
- `created_at` - Timestamp when the record was created.

Here is a SQL equivalent, please adapt it for Cloud Backend:

```sql
-- First create the enum type
CREATE TYPE fs_entitlement_type AS ENUM ('subscription', 'lifetime');

-- Then create the table
CREATE TABLE user_fs_entitlement (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    fs_license_id TEXT NOT NULL UNIQUE,
    fs_plan_id    TEXT NOT NULL,
    fs_pricing_id TEXT NOT NULL,
    fs_user_id    TEXT NOT NULL,
    type          fs_entitlement_type NOT NULL,
    expiration    TIMESTAMP(3) WITHOUT TIME ZONE,
    is_canceled   BOOLEAN NOT NULL,
    created_at    TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT    fk_user FOREIGN KEY (user_id) REFERENCES "User"(id) ON DELETE CASCADE
);

-- Index on type for faster filtering
CREATE INDEX idx_user_fs_entitlement_type ON user_fs_entitlement (type);
```

This table will hold purchase information coming from Freemius.

- Enable RLS and make sure to setup appropriate policies.
- Users can only READ their own entitlements
- Users cannot CREATE, UPDATE or DELETE any entitlements (only the server can do that)

---

# Step 2: Create Self-Contained Edge Functions

> **IMPORTANT:** Each Edge Function must be completely self-contained. Shared modules in `_shared/` folders do not bundle correctly with Edge Functions. All Freemius SDK initialization, helper functions, and database access code must be inlined directly in each function file.

## Common Code Pattern for Each Function

Every Edge Function that uses Freemius needs these inline elements:

```typescript
import { Freemius } from 'npm:@freemius/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// Initialize Freemius SDK - must be in each function
const freemius = new Freemius({
    productId: Deno.env.get('FREEMIUS_PRODUCT_ID')!,
    apiKey: Deno.env.get('FREEMIUS_API_KEY')!,
    secretKey: Deno.env.get('FREEMIUS_SECRET_KEY')!,
    publicKey: Deno.env.get('FREEMIUS_PUBLIC_KEY')!,
});

const SANDBOX = false; // Change to true for testing

// Type definitions - include in each function that needs them
interface MappedEntitlement {
    fsLicenseId: string;
    fsPlanId: string;
    fsPricingId: string;
    fsUserId: string;
    type: 'subscription' | 'lifetime';
    expiration: string | null;
    isCanceled: boolean;
    createdAt: string;
}

// Helper function to get user entitlement - inline in each function that needs it
async function getUserEntitlement(
    userId: string
): Promise<MappedEntitlement | null> {
    const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: entitlements, error } = await supabase
    .from('user_fs_entitlement')
    .select('*')
    .eq('user_id', userId);

    if (error || !entitlements || entitlements.length === 0) {
    return null;
    }

    // Map DB records (snake_case) to SDK format (camelCase)
    const mappedEntitlements = entitlements.map((e: any) => ({
    fsLicenseId: e.fs_license_id,
    fsPlanId: e.fs_plan_id,
    fsPricingId: e.fs_pricing_id,
    fsUserId: e.fs_user_id,
    type: e.type,
    expiration: e.expiration,
    isCanceled: e.is_canceled,
    createdAt: e.created_at,
    }));

    // Use SDK to get active entitlement
    const actives =
    freemius.entitlement.getActives(mappedEntitlements as any) ?? [];
    return (actives?.[actives.length - 1] as MappedEntitlement) ?? null;
}
```

## Data Mapping

- The Freemius SDK expects **camelCase** properties (e.g. `fsLicenseId`, `isCanceled`, `fsUserId`).
- When reading entitlement rows from the database and passing them to any Freemius SDK method (e.g. `freemius.entitlement.getActives()`), always map or convert the column names from snake_case to camelCase to match the format expected by the SDK.
- Similarly, when writing SDK output back to the database (e.g. `purchase.toEntitlementRecord()`), make sure to convert the camelCase properties back to snake_case to match the database column names.

## Key Functions Reference

Include these inline in functions that need them:

- getUserEntitlement: Gets the active entitlement for a user. Uses `freemius.entitlement.getActives()` to determine which entitlement is currently active based on expiration and cancellation status.
- processPurchase: Syncs purchase information to database:
- getUserByEmail: Looks up a local user by their email address:
- deleteEntitlement: Removes entitlement from database when license is deleted:
- cancelSubscription: Cancels a subscription via Freemius API:

## Notes

1. The `freemius.entitlement.getActives` method accepts an array of DB records from the `user_fs_entitlement` table and returns the active entitlement based on the expiration date and cancellation status.
2. The `processPurchase` function uses atomic database upsert operations so that race conditions are handled properly when there are multiple webhook events for the same license in a short period of time. The unique constraint should be `fs_license_id`.
3. Generate the `id` for the entitlement record when inserting or updating in the database since the `entitlementData` does not include it. Use `crypto.randomUUID()` or any other method to create a unique ID.

---

# Step 3: Create Checkout Redirection Process Route

Create a redirection processor for the checkout so that entitlements are given to the user. The Freemius Checkout will redirect to this route after purchase with some query parameters, and we can use that information to verify the purchase and update our database accordingly.

Create a function at `functions/process-checkout/index.ts`:

### Important Notes

1. Make sure the redirect route actually redirects to the front-end after processing the checkout with an appropriate message using redirection headers and query strings. Also create the front-end page to read those query parameters and show the message to the user.
2. Add detailed logs in the backend redirection handler for debugging.
3. The URL fix trick for signature verification is critical - always append query parameters to the `LIVE_SUPABASE_URL` instead of using the request URL directly.
4. **This function must be deployed with `verifyJwt: false`** since it's called externally by Freemius.
5. Share the URL for me so that I can enter it in the Freemius Developer Dashboard.

---

# Step 4: Paywall Implementation

The purpose is to:

- API endpoint to get user's entitlement from the local database.
- Front-end to call that endpoint when needed.
- New pricing page to show the pricing information and the checkout link for each plan.

## Backend API Routes

- Get Entitlements Route: Create a route at `functions/get-entitlements/index.ts`
- Get Pricing Data Route: Create a route at `functions/get-pricing-data/index.ts`
-

## Front-end Implementation

1. The front-end when loading will make API call to the `functions/v1/get-entitlements` using `supabase.functions.invoke`.
2. If there is an active entitlement, then the front-end will:
3. Show a "Premium" badge in the navbar where currently it shows "Account Status: Free"
4. Reveal all the UI from where the user can make use of the premium features (for example the "Premium Action" button on the dashboard)
5. If there is no active entitlement, then the front-end will:
6. Show a "Subscribe" button in the navbar where currently it shows "Account Status: Free"
7. Disable all the UI from where the user can make use of the premium features (for example the "Premium Action" button on the dashboard). It can also hint that a subscription is required to access those features. And also show the same "Subscribe" button next to the "Premium Action" button in the dashboard to make it easier for the user to find how to subscribe. Have it link to the same Checkout URL as the one in the navbar.
8. Clicking the "Subscribe" button will take to a new page `/pricing`.
9. The `/pricing` page will show the pricing information for the plans that we get from the `functions/v1/get-pricing-data` API route and also a "Subscribe" button for each plan that will link to the checkout URL for that plan.

- Create a simple and working UI for this. Use the data structure of `PricingData` to design the UI and show the information.
- Show plan title, annual/monthly price and annual over monthly discount if present.
- Use the `canCheckout` to either enable or disable the button, `buttonText` for the button label.
- Clicking the button will take to the `checkoutUrl` page.
- Render the features of each plan in a nice UI.
- Selecting the monthly billing cycle will add a `?billing_cycle=monthly` query parameter to the checkout URL.

## Sync Plans, Pricing and Features

- Replace All local hardcoded or add the plans, pricing and features. These should be dynamic to reflect what comes from the licensing Freemius API server.

## Protecting Server Actions

All backend server actions that must be behind a paywall will check the entitlement by calling `getUserEntitlement` (inline in each function) to verify if the user has an active entitlement before allowing access to the feature. If the user does not have an active entitlement, the API route should return an appropriate error message and status code.

## Auth & Protected Routes Checklist

When implementing authentication with protected routes:

1. **useAuth hook MUST include a fallback timeout** — if `onAuthStateChange` doesn't fire within 2 seconds, force `loading = false` to prevent infinite spinners. Use a ref to track initialization.

2. **Auth page MUST redirect authenticated users** — add a `useEffect` in the Auth/Login page that checks `if (!authLoading && user)` and navigates to `/` (or the intended post-login route). Without this, logged-in users see the login form or a blank page.

3. **Always test the full auth flow after integration:**

- Fresh page load while logged in (should show dashboard, not spinner)
- Login → redirect to dashboard
- Logout → redirect to auth page
- Direct URL access to protected route while logged out

---

# Step 5: Create Accounts Page

Create an accounts page where the user can see their subscription status, payments list and get a link to Freemius Customer Portal to manage their subscription.

## Backend API Routes

- Get Account Route: Create a route at `functions/get-account/index.ts`:
- Get Customer Portal Link Route: Create a route at `functions/get-customer-portal-link/index.ts`:
- Cancel Subscription Route: Create a route at `functions/cancel-subscription/index.ts`:
- Download Invoice Route: Create a route at `functions/download-invoice/index.ts`:

## Front-end Implementation

### Setup

1. Create a new page `/accounts` in the front-end and add the link to the navigation menu.
2. On page load, call `functions/v1/get-account` to fetch entitlement and subscription data.
3. Render the appropriate UI based on whether the user has an active subscription.

### General UI Rules

- Use semantic design tokens (bg-background, text-muted-foreground, etc.), never raw colors.
- Cards use `p-6`, sections separated by `<Separator />`.
- All buttons show a `Loader2` spinner when their action is in progress.

### Managing Authenticated API Calls

Never use `window.open()` or `<a href>` to call authenticated edge functions directly — browsers don't send Authorization headers with those methods.

Instead, always use `fetch()` with the user's session token:

```ts
const {
    data: { session },
} = await supabase.auth.getSession();
const res = await fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}` },
});
```

For file downloads (invoices), convert the response to a blob and open via `URL.createObjectURL`:

```ts
const blob = await res.blob();
window.open(URL.createObjectURL(blob), '_blank');
```

### No Subscription State

If the user has no active entitlement:

- Display a centered card with the message "You don't have an active subscription".
- Include a "Subscribe" button linking to `/pricing`.

### Active Subscription Card

If the user has an active entitlement, display a subscription card with:

**Header:**

- Label "CURRENT SUBSCRIPTION" (uppercase, muted, tracking-widest) on the left.
- A small "Manage Billing" button (outline style, with ExternalLink icon) on the right.

**Manage Billing interaction:**

- Call `functions/v1/get-customer-portal-link` to get the Freemius portal link.
- Attempt to open it in a new tab. If blocked by popup blocker:
    - Show the link prominently in a highlighted box.
    - Display text: "Your billing portal link is ready: [Click here](link) - expires in 4:00".
    - Show a 4-minute countdown timer.
    - After expiry, hide the link and restore the button.

**Body content:**

- A small badge showing the plan title (from subscription.planTitle) and optionally the unit title (e.g. "5 Seats" from subscription.unitTitle).
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
    - Make the "Keep subscription" button default and primary, and the "Cancel subscription" button as destructive and secondary (to the left of the keep button).
    - Call `functions/v1/cancel-subscription` to process cancellation.
    - Refresh the account data after success.
    - Show a toast notification.

### Payment History Card

If the user has entitlement, display a Payment History section:

**Header:**

- Label "PAYMENTS" (same uppercase muted style as subscription card).

**Payment rows:**

- CreditCard icon → date formatted as "Mon DD, YYYY" → amount (`$X.XX`) → Badge ("Paid" secondary or "Refund" destructive) → payment.planTitle and optionally payment.unitTitle in smaller muted text if present → "Invoice" outline button with PDF icon.
- For refunds, show a refund icon, make the amount red, and prefix with `-` sign.

**Invoice download:**

- Clicking an "Invoice" button calls `functions/v1/download-invoice?payment_id=<id>`.
- Use the authenticated fetch pattern above with the Authorization header.
- Convert response to blob and open via `URL.createObjectURL`.

**Flow Summary**

- User completes Freemius checkout
- Freemius redirects to `/process-checkout`
- Function processes entitlement + adds x entitlement
- User redirected to `/checkout-result?success=true&entitlement=x`
- Page shows "Payment Successful" with "+x entitlement added"
- Profile refreshes to show updated credit balance in navbar

---

# Step 6: Webhook Integration

Now we will setup webhook for Freemius to synchronize license and subscription changes to the `user_fs_entitlement` table in our database.

Create a route at `functions/webhook/index.ts`:

### Important Notes

1. **This function must be deployed with `verifyJwt: false`** since it's called externally by Freemius.
2. Share the URL for me to add it in the Freemius Developer Dashboard.

| Function                 | verifyJwt |
| ------------------------ | --------- |
| get-entitlements         | `true`    |
| get-pricing-data         | `true`    |
| get-account              | `true`    |
| get-customer-portal-link | `true`    |
| cancel-subscription      | `true`    |
| download-invoice         | `true`    |
| process-checkout         | `false`   |
| webhook                  | `false`   |

---

## Inspiration Code

Use this code to help make the changes in the app in relation to the Freemius integration.

```typescript
import {
    Freemius,
    Checkout,
    WebhookAuthenticationMethod,
    WebhookEventType,
} from 'npm:@freemius/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const freemius = new Freemius({
    productId: Deno.env.get('FREEMIUS_PRODUCT_ID')!,
    apiKey: Deno.env.get('FREEMIUS_API_KEY')!,
    secretKey: Deno.env.get('FREEMIUS_SECRET_KEY')!,
    publicKey: Deno.env.get('FREEMIUS_PUBLIC_KEY')!,
});

const SANDBOX = false;

interface MappedEntitlement {
    fsLicenseId: string;
    fsPlanId: string;
    fsPricingId: string;
    fsUserId: string;
    type: 'subscription' | 'lifetime';
    expiration: string | null;
    isCanceled: boolean;
    createdAt: string;
}

type PricingData = {
    annual: number | null;
    monthly: number | null;
    annualDiscount: number | null;
    planId: string;
    title: string;
    canCheckout: boolean;
    checkoutUrl: string;
    isCurrentPlan: boolean;
    buttonText: string;
    features: { title: string; value: string }[];
};

type SubscriptionPaymentData = {
    subscription: {
    id: string;
    cyclePricing: number;
    frequency: 'annual' | 'monthly';
    nextPayment: string;
    isCancelled: boolean;
    canceledAt: string | null;
    planTitle: string | null;
    unitTitle: string | null;
    } | null;
    payments: {
    id: string;
    gross: number;
    vat: number;
    currency: string;
    created: string;
    planTitle: string | null;
    type: 'payment' | 'refund';
    unitTitle: string | null;
    isRenewal: boolean;
    }[];
};

async function getUserEntitlement(
    userId: string
): Promise<MappedEntitlement | null> {
    const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: entitlements, error } = await supabase
    .from('user_fs_entitlement')
    .select('*')
    .eq('user_id', userId);

    if (error || !entitlements || entitlements.length === 0) {
    return null;
    }

    const mappedEntitlements = entitlements.map((e: any) => ({
    fsLicenseId: e.fs_license_id,
    fsPlanId: e.fs_plan_id,
    fsPricingId: e.fs_pricing_id,
    fsUserId: e.fs_user_id,
    type: e.type,
    expiration: e.expiration,
    isCanceled: e.is_canceled,
    createdAt: e.created_at,
    }));

    const actives =
    freemius.entitlement.getActives(mappedEntitlements as any) ?? [];
    return (actives?.[actives.length - 1] as MappedEntitlement) ?? null;
}

async function getUserByEmail(email: string) {
    const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('email', email)
    .limit(1);

    if (error || !profiles || profiles.length === 0) {
    return null;
    }

    return profiles[0];
}

async function processPurchase(licenseId: string): Promise<void> {
    const purchase = await freemius.purchase.retrievePurchase(licenseId);

    if (!purchase || !purchase.email) {
    console.error('No purchase or email found');
    return;
    }

    const localUser = await getUserByEmail(purchase.email);

    if (!localUser) {
    console.error('Local user not found for email:', purchase.email);
    return;
    }

    const entitlementData = purchase.toEntitlementRecord({
    userId: localUser.id,
    });

    const entitlementDataForDB = {
    user_id: entitlementData.userId,
    fs_license_id: entitlementData.fsLicenseId,
    fs_plan_id: entitlementData.fsPlanId,
    fs_pricing_id: entitlementData.fsPricingId,
    fs_user_id: entitlementData.fsUserId,
    type: entitlementData.type,
    expiration: entitlementData.expiration,
    is_canceled: entitlementData.isCanceled,
    created_at: entitlementData.createdAt,
    };

    const newId = crypto.randomUUID();
    const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase
    .from('user_fs_entitlement')
    .upsert(
        { id: newId, ...entitlementDataForDB },
        { onConflict: 'fs_license_id' }
    );

    if (error) {
    console.error('Error upserting entitlement:', error);
    throw error;
    }
}

async function deleteEntitlement(fsLicenseId: string): Promise<void> {
    const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase
    .from('user_fs_entitlement')
    .delete()
    .eq('fs_license_id', fsLicenseId);

    if (error) {
    console.error('Error deleting entitlement:', error);
    throw error;
    }
}

async function cancelSubscription(
    entitlement: MappedEntitlement
): Promise<boolean> {
    const subscription = await freemius.api.license.retrieveSubscription(
    entitlement.fsLicenseId
    );

    if (!subscription || subscription.canceled_at != null) {
    return false;
    }

    await freemius.api.subscription.cancel(subscription.id!);
    return true;
}

async function getPricingData(
    user: { email: string; firstName?: string; lastName?: string },
    entitlement: MappedEntitlement | null = null
): Promise<PricingData[]> {
    const productPricing = await freemius.api.product.retrievePricingData();

    const upgradeAuth = entitlement
    ? await freemius.api.license.retrieveCheckoutUpgradeAuthorization(
        entitlement.fsLicenseId
        )
    : null;

    const subscription = entitlement
    ? await freemius.api.license.retrieveSubscription(
        entitlement.fsLicenseId
        )
    : null;

    const hasActiveSubscription = subscription?.canceled_at == null;
    const currentPlanIndex = entitlement
    ? (productPricing?.plans?.findIndex(
        (plan) => plan.id === entitlement.fsPlanId
        ) ?? -1)
    : -1;

    const data: PricingData[] = [];
    let index = 0;

    for (const plan of productPricing?.plans ?? []) {
    if (plan.is_hidden) {
        index++;
        continue;
    }

    const checkout = await freemius.checkout.create({
        user,
        planId: plan.id as any,
        isSandbox: SANDBOX,
    });
    const isCurrentPlan = entitlement?.fsPlanId == plan.id;

    if (upgradeAuth) {
        checkout.setLicenseUpgradeByAuth({
        authorization: upgradeAuth,
        licenseId: entitlement!.fsLicenseId,
        });
    }

    const annualPrice = plan.pricing?.[0]?.annual_price;
    const monthlyPrice = plan.pricing?.[0]?.monthly_price;

    let annualOverMonthlyDiscount = null;
    if (annualPrice != undefined && monthlyPrice != undefined) {
        const annualCost = annualPrice;
        const monthlyCost = monthlyPrice * 12;
        if (monthlyCost > 0) {
        annualOverMonthlyDiscount = Math.round(
            ((monthlyCost - annualCost) / monthlyCost) * 100
        );
        }
    }

    const canCheckout = !hasActiveSubscription || !isCurrentPlan;
    const isLowerPlan = currentPlanIndex !== -1 && index < currentPlanIndex;

    const buttonText =
        !upgradeAuth || !hasActiveSubscription
        ? 'Subscribe'
        : isCurrentPlan
            ? 'Your Plan'
            : isLowerPlan
            ? 'Downgrade'
            : 'Upgrade';

    data.push({
        isCurrentPlan,
        canCheckout,
        buttonText,
        annual: plan.pricing?.[0]?.annual_price ?? null,
        monthly: plan.pricing?.[0]?.monthly_price ?? null,
        annualDiscount: annualOverMonthlyDiscount,
        planId: plan.id!,
        title: plan.title!,
        checkoutUrl: canCheckout ? checkout.getLink() : '',
        features:
        plan.features?.map((feature) => ({
            title: feature.title!,
            value: feature.value!,
        })) ?? [],
    });

    index++;
    }

    return data;
}

async function getSubscriptionAndPayments(
    entitlement: MappedEntitlement
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
        pricingById.set(pricing.id!, { quota: pricing.licenses ?? 1 });
    });
    });

    function formatQuota(quota: number | null): string | null {
    if (!quota || quota === 1) return null;
    const singular =
        pricingData?.plugin?.selling_unit_label?.singular ?? 'Unit';
    const plural =
        pricingData?.plugin?.selling_unit_label?.plural ?? 'Units';
    return `${quota} ${quota === 1 ? singular : plural}`;
    }

    return {
    subscription: subscription
        ? {
            id: subscription.id!,
            cyclePricing: subscription.amount_per_cycle!,
            frequency:
            subscription.billing_cycle === 12 ? 'annual' : 'monthly',
            nextPayment: subscription.next_payment!,
            isCancelled: subscription.canceled_at !== null,
            canceledAt: subscription.canceled_at ?? null,
            planTitle:
            planTitleById.get(subscription.plan_id!) ?? 'Unknown Plan',
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
}

// Route: functions/process-checkout/index.ts
const LIVE_SUPABASE_URL = `${Deno.env.get('SUPABASE_URL')!}/functions/v1/process-checkout`;
const LIVE_FRONTEND_URL = Deno.env.get('LIVE_FRONTEND_URL')!;

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const currentUrl = req.url;
    const url = new URL(currentUrl);
    const modifiedCurrentUrl = new URL(LIVE_SUPABASE_URL);
    modifiedCurrentUrl.search = url.search;

    const redirectInfo = await freemius.checkout.processRedirect(
        modifiedCurrentUrl.toString(),
        LIVE_SUPABASE_URL
    );

    if (redirectInfo?.license_id) {
        await processPurchase(redirectInfo.license_id);
    }

    return new Response(null, {
        status: 302,
        headers: {
        ...corsHeaders,
        Location: `${LIVE_FRONTEND_URL}/checkout-result?success=true`,
        },
    });
    } catch (error) {
    return new Response(null, {
        status: 302,
        headers: {
        ...corsHeaders,
        Location: `${LIVE_FRONTEND_URL}/checkout-result?success=false&error=${encodeURIComponent(
            error instanceof Error ? error.message : 'Unknown error'
        )}`,
        },
    });
    }
});

// Route: functions/get-entitlements/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Not authenticated');

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const entitlement = await getUserEntitlement(user.id);
    return new Response(JSON.stringify({ entitlement }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    } catch (error) {
    return new Response(
        JSON.stringify({
        error:
            error instanceof Error ? error.message : 'Internal server error',
        }),
        {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
    }
});

// Route: functions/get-pricing-data/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Not authenticated');

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', user.id)
        .single();

    const fullName = profile?.full_name || '';
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || undefined;
    const lastName = nameParts.slice(1).join(' ') || undefined;

    const entitlement = await getUserEntitlement(user.id);
    const pricingData = await getPricingData(
        { email: user.email!, firstName, lastName },
        entitlement
    );

    return new Response(JSON.stringify({ pricingData }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    }
});

// Route: functions/get-account/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Not authenticated');

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const entitlement = await getUserEntitlement(user.id);
    const subscriptionAndPayments = entitlement
        ? await getSubscriptionAndPayments(entitlement)
        : null;

    return new Response(
        JSON.stringify({ entitlement, subscriptionAndPayments }),
        {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
    } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    }
});

// Route: functions/get-customer-portal-link/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Not authenticated');

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const result =
        await freemius.api.user.retrieveHostedCustomerPortalByEmail(
        user.email!
        );
    return new Response(JSON.stringify({ link: result.link }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    } catch (error) {
    return new Response(
        JSON.stringify({ error: 'Failed to get customer portal link' }),
        {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
    }
});

// Route: functions/cancel-subscription/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Not authenticated');

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const entitlement = await getUserEntitlement(user.id);
    if (!entitlement) {
        return new Response(
        JSON.stringify({ success: false, error: 'No active subscription' }),
        {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
        );
    }

    const result = await cancelSubscription(entitlement);
    return new Response(JSON.stringify({ success: result }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    } catch (error) {
    return new Response(
        JSON.stringify({
        success: false,
        error: 'Failed to cancel subscription',
        }),
        {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
    }
});

// Route: functions/download-invoice/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Not authenticated');

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
    );

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const url = new URL(req.url);
    const paymentId = url.searchParams.get('payment_id');
    if (!paymentId) {
        return new Response(JSON.stringify({ error: 'Payment ID required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const entitlement = await getUserEntitlement(user.id);
    if (!entitlement) {
        return new Response(
        JSON.stringify({ error: 'No subscription found' }),
        {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
        );
    }

    const invoice = await freemius.api.user.retrieveInvoice(
        entitlement.fsUserId,
        paymentId
    );
    return new Response(invoice, {
        status: 200,
        headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${paymentId}.pdf"`,
        },
    });
    } catch (error) {
    return new Response(
        JSON.stringify({ error: 'Failed to download invoice' }),
        {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
    }
});

// Route: functions/webhook/index.ts
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders });

    try {
    const listener = freemius.webhook.createListener({
        authenticationMethod: WebhookAuthenticationMethod.Api,
    });

    const licenseEvents: WebhookEventType[] = [
        'license.created',
        'license.extended',
        'license.shortened',
        'license.updated',
        'license.cancelled',
        'license.expired',
        'license.plan.changed',
        'license.quota.changed',
    ];

    listener.on(licenseEvents, async ({ objects: { license } }) => {
        if (license?.id) {
        await processPurchase(license.id);
        }
    });

    listener.on('license.deleted', async ({ data }) => {
        if (data?.license_id) {
        await deleteEntitlement(data.license_id);
        }
    });

    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
        headers[key] = value;
    });

    const rawBody = await req.text();
    listener.process({ headers, rawBody }).catch((error) => {
        console.error('Webhook processing error:', error);
    });

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    } catch (error) {
    return new Response(
        JSON.stringify({ received: true, error: 'Processing failed' }),
        {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
    }
});
```

# Step 7: Finalization

Now that the Freemius Licensing integration is complete, please check the following:

1. The `SANDBOX` constant in each Edge Function is set to `false` unless you explicitly want testing mode.
2. When making additional endpoints, protect them with entitlement checks if necessary.
3. If the app has been published, make sure all front-end URLs are pointing to the production URL.

# Step 8: URLs to Configure in Freemius

- Display the specific links to add to the Developer Dashboard. Do not give generic links like `https://<your-project-id>.supabase.co/functions/v1/process-checkout`. - As a must, in the prompt invoke one of the edge functions to get the project's superbase project and create the exact links.

## Webhook URL

Go to [Developer Dashboard](https://dashboard.freemius.com/) → **Product** → **Webhooks** and add the webhook listener URL.

**Listen for these events:**

- license.cancelled
- license.created
- license.deleted
- license.expired
- license.extended
- license.plan.changed
- license.quota.changed
- license.shortened
- license.updated

## Checkout Redirection URL

Go to [Developer Dashboard](https://dashboard.freemius.com/) → **Product** → **Plans** → **Customization** tab to configure the checkout redirection URL.
