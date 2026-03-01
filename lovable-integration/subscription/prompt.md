# Step 1: Create Entitlement Table

We need to create a table called `user_fs_entitlement` with the following
columns:

- id - The primary key.
- user_id - A foreign key referencing the user table. Value must match with the
  ID of the user in the lovable auth system (text/string).
- fs_license_id - A unique identifier for the Freemius license (text/string).
- fs_plan_id - The Freemius plan ID (text/string).
- fs_pricing_id - The Freemius pricing ID (text/string).
- fs_user_id - The Freemius user ID (text/string).
- type - The entitlement type (e.g., subscription, lifetime, etc.). It could be
  an enum with value `subscription` or `lifetime`.
- expiration - The license expiration timestamp (nullable).
- is_canceled - A boolean flag indicating if the license is canceled.
- created_at - Timestamp when the record was created.

Here is a SQL equivalent, please adapt it for the lovable platform (supabase)

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
- Users cannot CREATE, UPDATE or DELETE any entitlements (only the server can do
  that)

# Step 2: Install Freemius SDK and Create Shared Backend Module

We will install the Freemius JS SDK for backend. This is strictly meant for
backend and should not be exposed in the frontend. The package is
`@freemius/sdk`.

Create a file called `supabase/functions/_shared/freemius.ts` for
backend/supabase and put the following code in it:

```ts
import { Freemius, PurchaseEntitlementData, Checkout } from 'npm:@freemius/sdk';

export const freemius = new Freemius({
  productId: Deno.env.get('FREEMIUS_PRODUCT_ID')!,
  apiKey: Deno.env.get('FREEMIUS_API_KEY')!,
  secretKey: Deno.env.get('FREEMIUS_SECRET_KEY')!,
  publicKey: Deno.env.get('FREEMIUS_PUBLIC_KEY')!,
});

const SANDBOX = false; // Change this to true if you want to test in sandbox mode

/**
 * Get the active entitlement for a user based on the records in the database.
 * This function will be used in the API route to get the user's entitlement information.
 */
export async function getUserEntitlement(userId: string) {
  // Somehow read from the `user_fs_entitlement` table where the userId matches.
  const entitlements = await someDbCall();

  // We need to map the DB records to camelCase format expected by the Freemius SDK.
  const mappedEntitlements = entitlements.map((entitlement) => ({
    fsLicenseId: entitlement.fs_license_id,
    fsPlanId: entitlement.fs_plan_id,
    fsPricingId: entitlement.fs_pricing_id,
    fsUserId: entitlement.fs_user_id,
    type: entitlement.type,
    expiration: entitlement.expiration,
    isCanceled: entitlement.is_canceled,
    createdAt: entitlement.created_at,
  }));

  // Use the Freemius SDK to get the active entitlement for the user
  const actives = freemius.entitlement.getActives(mappedEntitlements) ?? [];
  return actives?.[actives.length - 1] ?? null;
}

/**
 * Helper function to check if the user has an active subscription for a specific plan.
 * This can be used in API routes to protect access to plan-specific features.
 */
export async function hasPlan(
  userId: string,
  planId: string
): Promise<boolean> {
  const entitlement = await getUserEntitlement(userId);
  return String(entitlement?.fsPlanId) === String(planId);
}

/**
 * Create a Function to synchronize the entitlement information to the database.
 */
export async function processPurchase(licenseId: string) {
  const purchaseInfo = await freemius.purchase.retrievePurchase(licenseId);
  const localUser = await getUserFromDb(purchaseInfo.email);

  // Convert the purchase information to the entitlement record format for our database.
  const entitlementData = purchase.toEntitlementRecord({
    userId: localUser.id,
  });

  const fsLicenseId = purchase.licenseId;
  // Now depending whether a record exists in the `user_fs_entitlement` table based on the unique key `fsLicenseId` either insert a new record or update the existing one with the new information from the purchase.
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

  // The record does not include `id` so generate for the upsert.
  // Use the DATABASE upsert functionality to keep the operation atomic
  const newId = generateUniqueId();
  const { error } = await db
    .from('user_fs_entitlement')
    .upsert(
      { id: newId, ...entitlementDataForDB },
      { onConflict: 'fsLicenseId' }
    );
}

type PricingData = {
  annual: number | null;
  monthly: number | null;
  // Percentage discount when choosing annual over monthly, rounded to nearest integer. Null if discount cannot be calculated (e.g. missing price data).
  annualDiscount: number | null;
  planId: string;
  title: string;
  canCheckout: boolean;
  checkoutUrl: string;
  isCurrentPlan: boolean;
  buttonText: string;
  features: { title: string; value: string }[];
};

/**
 * Create a Checkout session for the user.
 */
async function createFreemiusCheckout(
  user: { email: string; firstName?: string; lastName?: string },
  planId?: string
): Promise<Checkout> {
  // @ts-expect-error - The planId can be undefined and depending on some TS config it can cause error, but in practice this is fine.
  const checkout = await freemius.checkout.create({
    user,
    planId: planId,
    isSandbox: SANDBOX,
  });

  return checkout;
}

export async function getPricingData(
  user: { email: string; firstName?: string; lastName?: string },
  entitlement: Pick<
    PurchaseEntitlementData,
    'fsLicenseId' | 'fsPlanId'
  > | null = null
): Promise<PricingData[]> {
  const productPricing = await freemius.api.product.retrievePricingData();
  const upgradeAuth = entitlement
    ? await freemius.api.license.retrieveCheckoutUpgradeAuthorization(
        entitlement.fsLicenseId
      )
    : null;

  const subscription = entitlement
    ? await freemius.api.license.retrieveSubscription(entitlement.fsLicenseId)
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
      continue;
    }

    const checkout = await createFreemiusCheckout(user, plan.id!);
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

/**
 * Function to cancel subscription
 */
export async function cancelSubscription(
  entitlement: Pick<PurchaseEntitlementData, 'fsLicenseId'>
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

export const LIVE_SUPABASE_URL =
  'https://xyz.supabase.co/functions/v1/process-checkout'; // Change this to your actual URL

export const LIVE_FRONTEND_URL = 'https://your-frontend-url.com'; // Change this to your actual frontend URL
```

Store all credentials securely inside the "Secrets" section of the Lovable
dashboard.

The file must be created under `supabase/functions/_shared` or any other shared
location that can be imported in our API routes.

1. The documentation is available here:
   https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#using-entitlement-logic
2. The `freemius.entitlement.getActive` method accepts an array of DB records
   from the `user_fs_entitlement` table and returns the active entitlement based
   on the expiration date and cancellation status. You can use this code as-is.
3. The `createFreemiusCheckout` and `getPricingData` function must receive the
   email and the other firstName and lastName are optional. Try to get those
   data from the current auth session if available.
4. The code given is just for demonstration purposes, you will need to adapt it
   to your application's structure and database access method.
5. If you are unsure about the `LIVE_SUPABASE_URL` try to get from some platform
   config if not fallback to asking the user.
6. Make sure to generate the `id` for the entitlement record when inserting or
   updating in the database since the `entitlementData` does not include it. You
   can use a UUID generator or any other method to create a unique ID for the
   record.
7. The `processPurchase` function will have atomic database upsert operation so
   that the race conditions are handled properly when there are multiple webhook
   events for the same license in a short period of time. Make sure to use the
   upsert functionality provided by your database to achieve this. The unique
   constraint should be `fsLicenseId`, the database is already created in that
   way.

## Data Mapping

- The Freemius SDK expects **camelCase** properties (e.g. `fsLicenseId`,
  `isCanceled`, `fsUserId`).
- When reading entitlement rows from the database and passing them to any
  Freemius SDK method (e.g. `freemius.entitlement.getActive()`), always map or
  convert the column names from snake_case to camelCase to match the format
  expected by the SDK.
- Similarly, when writing SDK output back to the database (e.g.
  `purchase.toEntitlementRecord()`), make sure to convert the camelCase
  properties back to snake_case to match the database column names.

# Step 3: Create Checkout Redirection Process Route

We will create a redirection processor for the checkout so that entitlements are
given to the user. The Freemius Checkout will redirect to this route after
purchase with some query parameters, and we can use that information to verify
the purchase and update our database accordingly.

The route will be `supabase/functions/process-checkout/index.ts` and will use
the Freemius SDK to verify the checkout and update the `user_fs_entitlement`
table.

```typescript
import {
  freemius,
  processPurchase,
  LIVE_SUPABASE_URL,
  LIVE_FRONTEND_URL,
} from '../_shared/freemius'; // Correct the path

// Process the GET request on this route.

const currentUrl = request.url;

/**
 * The program (Deno) sees the current URL as `http://host/process-checkout?...` but the redirect URL is `https://host/functions/v1/process-checkout?...`.
 * To make sure the signature verification works correctly, we will just append all query params to the LIVE_SUPABASE_URL from the currentURL
 */
const url = new URL(currentUrl);
const modifiedCurrentUrl = new URL(LIVE_SUPABASE_URL);
modifiedCurrentUrl.search = url.search;
const modifiedCurrentUrlString = modifiedCurrentUrl.toString();

// Validate the redirect (SDK does signature validation) and get the information
const redirectInfo = await freemius.checkout.processRedirect(
  modifiedCurrentUrlString,
  LIVE_SUPABASE_URL
);

// Process the purchase from redirectInfo if possible
if (redirectInfo?.license_id) {
  processPurchase(redirectInfo.license_id);
}

// Once done redirect to a specific front-end page with a success message or error message based on the result of the process. For this you can use a redirection header with the URL of the front-end page and pass query parameters to indicate success or failure and the message to show.
return new Response(null, {
  status: 302,
  headers: {
    Location: `${LIVE_FRONTEND_URL}/checkout-result?success=true`, // Change this to your actual front-end URL and page
  },
});
// Adapt the code to lovable platform's way of handling redirections as needed.
```

1. The documentation is available under
   https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#hosted-checkout
2. All the functions from `freemius` are real methods and read the comments to
   understand what they do
3. Make sure the redirect route actually redirects to the front-end after
   processing the checkout with an appropriate message using redirection headers
   and query strings. Also create the front-end page to read those query
   parameters and show the message to the user. The front-end will redirect to
   the dashboard after showing the message.
4. Adapt the code to match your application's structure and database access
   method.
5. Share the URL for me so that I can enter it in the Freemius Developer
   Dashboard.
6. Add detailed logs in the backend redirection handler to make sure we can
   debug any issues that might come up in the process.
7. Make sure you follow the trick to fix the URL for the signature verification
   by appending the query parameters to the `LIVE_SUPABASE_URL` instead of using
   the current request URL directly.

# Step 4: Paywall Implementation

The purpose is to

- API endpoint to get user's entitlement from the local database.
- Front-end to call that endpoint when needed.
- New pricing page to show the pricing information and the checkout link for
  each plan.

## Backend API Route

Create an API route in the backend/supabase from where we can get the currently
logged in user's entitlements. This will be used in the frontend to check if the
user has an active subscription or not. Use the Freemius JS SDK instance that we
created in the previous step.

Create the route under `supabase/functions/get-entitlements/index.ts` and put
the following code in it:

```typescript
import { getUserEntitlement } from '../_shared/freemius'; // Correct the path

// Now create the API route handler that will call the above functions and return the entitlement information to the frontend. Make sure to handle authentication and only allow access to the entitlements of the currently logged in user.

// The return data needs to be of the shape { entitlement: Entitlement | null }
```

Create another route under `supabase/functions/get-pricing-data/index.ts` that
will return the pricing data for the plans from Freemius. This will be used in
the front-end to show the pricing information and also to get the checkout URL
for each plan.

```typescript
import {
  getPricingData,
  PricingData,
  getUserEntitlement,
} from '../_shared/freemius'; // Correct the path
// Now create the API route handler that will call the above function and return the pricing information to the frontend. Make sure to handle authentication and only allow access to logged in users. Pass the user information to the `getPricingData` function to generate the checkout URL for each plan based on the user information if needed.

const localUserId = await getUserIdFromAuth(); // Implement this function to get the user ID from the authentication context
const entitlement = await getUserEntitlement(localUserId);

const pricingData = await getPricingData(
  { email: '...', firstName: '...', lastName: '...' }, // Pass the actual user information here
  entitlement
);

// The return data needs to be of the shape {pricingData: PricingData[]}
```

Add some console logs to the API route to make it easier to debug and test. It
needs to support POST API methods or anything that comes with
`supabase.functions.invoke` from the frontend.

## Front-end Implementation

1. The front-end when loading will make API call to the
   `functions/v1/get-entitlements` using `supabase.functions.invoke`.
2. If there is an active entitlement, then the front-end will
   1. Show a "Premium" badge in the navbar where currently it shows "Account
      Status: Free"
   2. Reveal all the UI from where the user can make use of the premium features
      (for example the "Premium Action" button on the dashboard)
3. If there is no active entitlement, then the front-end will
   1. Show a "Subscribe" button in the navbar where currently it shows "Account
      Status: Free"
   2. Disable all the UI from where the user can make use of the premium
      features (for example the "Premium Action" button on the dashboard). It
      can also hint that a subscription is required to access those features.
      And also show the same "Subscribe" button next to the "Premium Action"
      button in the dashboard to make it easier for the user to find how to
      subscribe. Have it link to the same Checkout URL as the one in the navbar.
   3. Clicking the "Subscribe" button will take to a new page `/pricing`.
4. The `/pricing` page will show the pricing information for the plans that we
   get from the `functions/v1/get-pricing-data` API route and also a "Subscribe"
   button for each plan that will link to the checkout URL for that plan.
   - Create a simple and working UI for this. Use the data structure of
     `PricingData` that we have in the shared module to design the UI and show
     the information,
   - show plan title, annual/monthly price and annual over monthly discount if
     present.
   - Use the `canCheckout` to either enable or disable the button, `buttonText`
     for the button label.
   - Clicking the button will take to the `checkoutUrl` page.
   - Render the features of each plan in a nice UI.
   - Selecting the monthly billing cycle will add a `?billing_cycle=monthly`
     query parameter to the checkout URL.

## Protecting Server Actions

All backend server action that must be behind a paywall will check the
`getUserEntitlement` from the `_shared/freemius.ts` file to verify if the user
has an active entitlement before allowing access to the feature. If the user
does not have an active entitlement, the API route should return an appropriate
error message and status code.

## Auth & Protected Routes Checklist

When implementing authentication with protected routes:

1. **useAuth hook MUST include a fallback timeout** — if `onAuthStateChange`
   doesn't fire within 2 seconds, force `loading = false` to prevent infinite
   spinners. Use a ref to track initialization.

2. **Auth page MUST redirect authenticated users** — add a `useEffect` in the
   Auth/Login page that checks `if (!authLoading && user)` and navigates to `/`
   (or the intended post-login route). Without this, logged-in users see the
   login form or a blank page.

3. **Always test the full auth flow after integration:**
   - Fresh page load while logged in (should show dashboard, not spinner)
   - Login → redirect to dashboard
   - Logout → redirect to auth page
   - Direct URL access to protected route while logged out

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

# Step 6: Webhook Integration

Now we will setup webhook for Freemius to synchronize license and subscription
changes to the `user_fs_entitlement` table in our database.

1. Create a new API route `functions/v1/webhook` that will be used as the
   webhook URL for Freemius. This route will receive POST requests from Freemius
   whenever there is a change in the license or subscription status.
2. To process the webhook, we will use the Freemius SDK. (Documentation:
   https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#handling-license-updates-via-webhooks)

   ```typescript
   import { freemius, processPurchase } from '../_shared/freemius'; // Correct the path
   import {
     WebhookAuthenticationMethod,
     WebhookEventType,
   } from 'npm:@freemius/sdk';

   const listener = freemius.webhook.createListener({
     authenticationMethod: WebhookAuthenticationMethod.Api,
   });

   // Freemius events to listen to
   const licenseEvents: WebhookEventType[] = [
     'license.created',
     'license.extended',
     'license.shortened',
     'license.updated',
     'license.cancelled',
     'license.expired',
     'license.plan.changed',
   ];

   listener.on(licenseEvents, async ({ objects: { license } }) => {
     if (license && license.id) {
       await processPurchase(license.id);
     }
   });

   // Get the raw body from the request
   const rawBody = await request.text();

   // Now process it with the Freemius SDK, but intentionally don't await it to make sure we pass a 2xx response to Freemius as soon as possible and avoid retries. We will handle the processing asynchronously and add detailed logs to make sure we can debug any issues that might come up in the process.
   let result = listener
     .process({
       headers: req.headers,
       rawBody: rawBody,
     })
     .catch((error) => {
       console.error('Error processing Freemius webhook:', error);
     });

   // Pass a 2xx response to Freemius.
   ```

3. Adjust the code to the platform specifics and add console logs for easier
   debugging.
4. Share the URL for me to add it in the Freemius Developer Dashboard.

# Step 7: Finalization

Now that the Freemius Licensing integraiton is complete, please check the
followings:

1. The checkout generation under `_shared/freemius.ts` file is not sandbox
   unless that's what I explicitly want for testing.
2. When making additional endpoints make sure to protect it with entitlement
   check if necessary.
3. If the app has been published, make sure to update all front-end URLs to
   point to the production URL instead of the local development URL inside
   `_shared/freemius.ts`.
4. Make sure all references to the supabase URL in the code are updated to the
   production URL if the app has been published.
5. When giving me the Webhook URL mention I need to go to
   [Developer Dashboard](https://dashboard.freemius.com/) and navigate to
   Product → Webhooks to add the webhook listener and provide the URL there. Ask
   me to listen for events
   - license.cancelled
   - license.created
   - license.deleted
   - license.expired
   - license.extended
   - license.plan.changed
   - license.quota.changed
   - license.shortened
   - license.updated
6. When giving me the Checkout Redirection URL mention I need to go to
   [Developer Dashboard](https://dashboard.freemius.com/) and navigate to
   Product → Plans to configure the checkout redirection under **Customization**
   tab.
