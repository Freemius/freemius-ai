Integrate Freemius subscriptions end-to-end in this Lovable app using Supabase functions, shared backend utilities, and
frontend paywall/account UX.

## Requirements and constraints

1. Do not expose Freemius secret credentials in frontend code.
2. Use Supabase Edge Functions for backend routes.
3. Use a shared backend module (for example `supabase/functions/_shared/freemius.ts`) so logic is not duplicated.
4. Add structured logs to all backend routes for debugging.
5. Keep sandbox checkout disabled by default (`SANDBOX = false`) unless explicitly requested.
6. Use environment secrets for:
    - `FREEMIUS_PRODUCT_ID`
    - `FREEMIUS_API_KEY`
    - `FREEMIUS_SECRET_KEY`
    - `FREEMIUS_PUBLIC_KEY`
7. Assume `user_fs_entitlement` already exists and contains Freemius entitlement records with fields matching Freemius
   purchase mapping (license ID, plan/pricing IDs, fs user ID, type, expiration, createdAt, isCanceled, user relation,
   etc.). If small schema mismatches exist, adapt mapping safely in code.

Documentation links (reference):

- https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/

## Install and shared backend module

1. Install Freemius SDK dependencies if needed:
    - `@freemius/sdk`
    - `@freemius/checkout`
    - `zod`
2. Create/update shared backend file `supabase/functions/_shared/freemius.ts`:
    - Initialize `Freemius` from env secrets.
    - Export constants:
        - `LIVE_SUPABASE_URL` (production Supabase functions base URL for redirect verification)
        - `LIVE_FRONTEND_URL` (production frontend URL)
    - Implement and export:
        - `getUserEntitlement(userId: string)`: read user records from `user_fs_entitlement`, then return active
          entitlement via `freemius.entitlement.getActive(...)`.
        - `processPurchase(licenseId: string)`: retrieve purchase from Freemius, resolve app user by email, map purchase
          to entitlement shape, upsert atomically in `user_fs_entitlement` by Freemius license ID. Ensure `id` exists
          (generate UUID when needed).
        - `createFreemiusCheckout(user: { email: string; firstName?: string; lastName?: string })`: create checkout and
          return hosted link.

Code snippet (reference):

```sql
-- First create the enum type
CREATE TYPE fs_entitlement_type AS ENUM ('subscription', 'lifetime');

-- Then create the table
CREATE TABLE user_fs_entitlement (
    id            TEXT PRIMARY KEY,
    "userId"      TEXT NOT NULL,
    "fsLicenseId" TEXT NOT NULL UNIQUE,
    "fsPlanId"    TEXT NOT NULL,
    "fsPricingId" TEXT NOT NULL,
    "fsUserId"    TEXT NOT NULL,
    type          fs_entitlement_type NOT NULL,
    expiration    TIMESTAMP(3) WITHOUT TIME ZONE,
    "isCanceled"  BOOLEAN NOT NULL,
    "createdAt"   TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT    fk_user FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);

-- Index on type for faster filtering
CREATE INDEX idx_user_fs_entitlement_type ON user_fs_entitlement (type);
```

```ts
import { Freemius } from 'npm:@freemius/sdk';

export const freemius = new Freemius({
    productId: Deno.env.get('FREEMIUS_PRODUCT_ID')!,
    apiKey: Deno.env.get('FREEMIUS_API_KEY')!,
    secretKey: Deno.env.get('FREEMIUS_SECRET_KEY')!,
    publicKey: Deno.env.get('FREEMIUS_PUBLIC_KEY')!,
});

const SANDBOX = false; // Change this to true if you want to test in sandbox mode

async function getUserEntitlement(userId: string) {
    // Somehow read from the `user_fs_entitlement` table where the userId matches.
    const entitlements = await someDbCall();

    // Use the Freemius SDK to get the active entitlement for the user
    return freemius.entitlement.getActive(entitlements);
}

async function processPurchase(licenseId: string) {
    const purchaseInfo = await freemius.purchase.retrievePurchase(licenseId);
    const localUser = await getUserFromDb(purchaseInfo.email);

    // Convert the purchase information to the entitlement record format for our database.
    const entitlementData = purchase.toEntitlementRecord({
        userId: localUser.id,
    });

    const fsLicenseId = purchase.licenseId;
    // Now depending whether a record exists in the `user_fs_entitlement` table based on the unique key `fsLicenseId` either insert a new record or update the existing one with the new information from the purchase.
    // The entitlementData should match the DB columns.
    // - fsLicenseId: string;
    // - fsPlanId: string;
    // - fsPricingId: string;
    // - fsUserId: string;
    // - type: 'subscription' | 'lifetime';
    // - expiration: Date | null;
    // - createdAt: Date;
    // - isCanceled: boolean;

    // The record does not include `id` so generate for the upsert.
    // Use the DATABASE upsert functionality to keep the operation atomic
}

async function createFreemiusCheckout(user: { email: string; firstName?: string; lastName?: string }): Promise<string> {
    const checkout = await freemius.checkout.create({
        user,
        isSandbox: SANDBOX,
    });

    return checkout.getLink();
}

export const LIVE_SUPABASE_URL = 'https://xyz.supabase.co/functions/v1/process-checkout'; // Change this to your actual URL
export const LIVE_FRONTEND_URL = 'https://your-frontend-url.com'; // Change this to your actual frontend URL
```

Documentation links (reference):

- https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#using-entitlement-logic

## Checkout redirect processing route

Create `supabase/functions/process-checkout/index.ts` as a public GET route:

1. Parse current request URL.
2. Rebuild URL for signature validation by taking `LIVE_SUPABASE_URL` and appending the incoming query string to it.
   (Important for Freemius redirect signature verification.)
3. Call `freemius.checkout.processRedirect(modifiedCurrentUrlString, LIVE_SUPABASE_URL)`.
4. If redirect info has `license_id`, call `processPurchase(license_id)`.
5. Redirect user to frontend result page with query params indicating success/failure and message.
6. Add clear logging for start, verification, license processing, and redirect result.
7. Also create frontend `/checkout-result` page that reads query params, shows status message, then routes user to
   dashboard after a short delay.

Code snippet (reference):

```ts
import { freemius, processPurchase, LIVE_SUPABASE_URL, LIVE_FRONTEND_URL } from '../_shared/freemius'; // Correct the path

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
const redirectInfo = await freemius.checkout.processRedirect(modifiedCurrentUrlString, LIVE_SUPABASE_URL);

// Process the purchase from redirectInfo if possible
if (redirectInfo?.license_id) {
    processPurchase(redirectInfo.license_id);
}

return new Response(null, {
    status: 302,
    headers: {
        Location: `${LIVE_FRONTEND_URL}/checkout-result?success=true`,
    },
});
```

Documentation links (reference):

- https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#hosted-checkout

## Entitlements API + paywall integration

Create `supabase/functions/get-entitlements/index.ts`:

1. Authenticate caller from Supabase auth context.
2. Get logged-in user identity (email, firstName/lastName if available).
3. Call shared methods to fetch active entitlement and create checkout URL.
4. Return `{ entitlement, checkoutUrl }`.
5. Handle errors with appropriate HTTP status and logs.
6. Ensure route works with frontend `supabase.functions.invoke`.

Frontend integration:

1. On app load (or auth-ready state), call `functions/v1/get-entitlements`.
2. If active entitlement exists:
    - Show `Premium` indicator in navbar (where free status is currently shown).
    - Enable/reveal premium UI/actions.
3. If no active entitlement:
    - Show `Subscribe` CTA in navbar.
    - Disable/lock premium actions with clear hint text.
    - Show a second `Subscribe` CTA near premium action(s), both using returned checkout URL.
4. For every backend endpoint representing premium features, enforce entitlement check server-side using
   `getUserEntitlement(...)`; return correct authorization error when missing entitlement.

Code snippet (reference):

```ts
import { getUserEntitlement, createFreemiusCheckout } from '../_shared/freemius'; // Correct the path

// API route handler:
// - Authenticate current user
// - Return { entitlement: Entitlement | null, checkoutUrl: string }
// - Must work with supabase.functions.invoke from frontend
```

## Accounts page + customer portal SSO

Create `/accounts` page and link it in navigation:

1. Reuse `get-entitlements` response.
2. If active entitlement, show `Manage Subscription`.
3. Add new backend route `supabase/functions/get-customer-portal-link/index.ts`:
    - Authenticate user.
    - Use logged-in user email with `freemius.api.user.retrieveHostedCustomerPortalByEmail(email)`.
    - Return hosted customer portal link.
4. On `Manage Subscription` click:
    - Call route and open link in new tab.
    - If popup blocked, show prominent clickable fallback URL.
    - Show message that link expires in 5 minutes and display countdown.
    - Hide fallback link after expiration and show main button again.
5. If no active entitlement on `/accounts`, show `Subscribe` button using checkout URL.

Code snippet (reference):

```ts
import { freemius } from '../_shared/freemius'; // Correct the path

// Using the email address from logged-in user session
const { link } = await freemius.api.user.retrieveHostedCustomerPortalByEmail(
    '...' // Email address
);
```

Documentation links (reference):

- https://freemius.com/help/documentation/users-account-management/sso-on-hosted-link/

## Webhook route for license sync

Create `supabase/functions/webhook/index.ts` and wire Freemius webhook verification/processing:

1. Configure listener with API authentication method.
2. Handle license-related events:
    - `license.created`
    - `license.extended`
    - `license.shortened`
    - `license.updated`
    - `license.cancelled`
    - `license.expired`
    - `license.plan.changed`
3. For each event with a license ID, call `processPurchase(license.id)` to sync local entitlements.
4. Read raw request body and pass headers + raw body into SDK listener processor.
5. Return 2xx quickly to avoid retries; keep processing robust and logged.
6. Add detailed error logging around listener processing.

Code snippet (reference):

```ts
import { freemius, processPurchase } from '../_shared/freemius'; // Correct the path
import { WebhookAuthenticationMethod, WebhookEventType } from 'npm:@freemius/sdk';

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
];

listener.on(licenseEvents, async ({ objects: { license } }) => {
    if (license && license.id) {
        await processPurchase(license.id);
    }
});

const rawBody = await request.text();

let result = listener
    .process({
        headers: req.headers,
        rawBody: rawBody,
    })
    .catch((error) => {
        console.error('Error processing Freemius webhook:', error);
    });

// Return 2xx quickly without waiting for the listener to finish processing
```

Documentation links (reference):

- https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#handling-license-updates-via-webhooks

## Finalization checklist

1. Confirm all URLs use production values where required (`LIVE_FRONTEND_URL`, `LIVE_SUPABASE_URL`) when app is
   published.
2. Confirm checkout is not sandbox unless explicitly requested.
3. Verify all premium backend routes are protected with entitlement checks.
4. Verify user journey end-to-end:
    - Free user sees subscribe UI
    - Checkout redirect processes and grants entitlement
    - Premium UI unlocks
    - Accounts page can open customer portal
    - Webhook updates entitlement state on cancellation/expiration/plan change
5. Provide me with exact URLs to configure in Freemius dashboard:
    - Checkout redirect URL (`/functions/v1/process-checkout`)
    - Webhook URL (`/functions/v1/webhook`)

Implement all of this now. If project structure differs, adapt paths and naming but preserve behavior.
