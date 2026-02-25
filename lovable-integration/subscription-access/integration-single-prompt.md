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
import { Freemius } from 'npm:@freemius/sdk';

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
async function getUserEntitlement(userId: string) {
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
    return freemius.entitlement.getActive(mappedEntitlements);
}

/**
 * Create a Function to synchronize the entitlement information to the database.
 */
async function processPurchase(licenseId: string) {
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
    planId: string;
    title: string;
    checkoutUrl: string;
    features: { title: string; value: string }[];
};

/**
 * Create a Checkout session for the user.
 */
async function createFreemiusCheckout(
    user: { email: string; firstName?: string; lastName?: string },
    planId?: string
): Promise<string> {
    // @ts-expect-error - The planId can be undefined and depending on some TS config it can cause error, but in practice this is fine.
    const checkout = await freemius.checkout.create({
        user,
        planId: planId,
        isSandbox: SANDBOX,
    });

    return checkout.getLink();
}

async function getPricingData(user: {
    email: string;
    firstName?: string;
    lastName?: string;
}): Promise<PricingData[]> {
    const productPricing = await freemius.api.product.retrievePricingData();

    const data: PricingData[] = [];

    for (const plan of productPricing?.plans ?? []) {
        if (plan.is_hidden) {
            continue;
        }

        data.push({
            annual: plan.pricing?.[0]?.annual_price ?? null,
            monthly: plan.pricing?.[0]?.monthly_price ?? null,
            planId: plan.id!,
            title: plan.title!,
            checkoutUrl: await createFreemiusCheckout(user, plan.id!),
            features:
                plan.features?.map((feature) => ({
                    title: feature.title!,
                    value: feature.value!,
                })) ?? [],
        });
    }

    return data;
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
import { getPricingData, PricingData } from '../_shared/freemius'; // Correct the path
// Now create the API route handler that will call the above function and return the pricing information to the frontend. Make sure to handle authentication and only allow access to logged in users. Pass the user information to the `getPricingData` function to generate the checkout URL for each plan based on the user information if needed.

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
    2. Reveal all the UI from where the user can make use of the premium
       features (for example the "Premium Action" button on the dashboard)
3. If there is no active entitlement, then the front-end will
    1. Show a "Subscribe" button in the navbar where currently it shows "Account
       Status: Free"
    2. Disable all the UI from where the user can make use of the premium
       features (for example the "Premium Action" button on the dashboard). It
       can also hint that a subscription is required to access those features.
       And also show the same "Subscribe" button next to the "Premium Action"
       button in the dashboard to make it easier for the user to find how to
       subscribe. Have it link to the same Checkout URL as the one in the
       navbar.
    3. Clicking the "Subscribe" button will take to a new page `/pricing`.
4. The `/pricing` page will show the pricing information for the plans that we
   get from the `functions/v1/get-pricing-data` API route and also a "Subscribe"
   button for each plan that will link to the checkout URL for that plan.
    - Create a simple and working UI for this. Use the data structure of
      `PricingData` that we have in the shared module to design the UI and show
      the information, show plan title, annual/monthly price.
    - If the user already has an active subscription, show a message saying "You
      already have an active subscription" and hide the pricing information and
      the subscribe buttons. Add a link to a `/account` page that we will create
      in the next step.

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
       when user can access benefits.
    2. Subscription is active if `isCancelled` is `false`. Use information from
       the the `SubscriptionPaymentData` to render a nice UI.
4. If has `entitlement` show a "Payment History" block where you show the list
   of payments from the `SubscriptionPaymentData`.
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
   `https://dashboard.freemius.com/#!/live/products/{PRODUCT_ID}/webhooks/listeners/`
   (replace {PRODUCT_ID} with the actual product ID) to add the webhook listener
   and provide the URL there. Ask me to listen for events
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
   `https://dashboard.freemius.com/#!/live/products/{PRODUCT_ID}/plans/`
   (replace {PRODUCT_ID} with the actual product ID) to configure the checkout
   redirection under **Customization** tab.
