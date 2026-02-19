We will create a redirection processor for the checkout so that entitlements are given immediately.

---

We will create a public route in the backend/supabase that will be used as the redirection URL after the Freemius Checkout is completed. This route will receive a request from Freemius with the checkout session information, and we can use that information to verify the purchase and update our database accordingly.

The route will be `supabase/functions/process-checkout/index.ts` and will use the Freemius SDK to verify the checkout and update the `user_fs_entitlement` table.

```typescript
import { freemius } from "../_shared/freemius"; // Correct the path

// Mention the hostname of the redirection URL (from supabase)
const LIVE_URL = "https://xyz.supabase.co/functions/v1/process-checkout"; // Change this to your actual URL

// Process the GET request on this route.

const currentUrl = request.url;

/**
 * The program (Deno) sees the current URL as `http://host/process-checkout?...` but the redirect URL is `https://host/functions/v1/process-checkout?...`.
 * To make sure the signature verification works correctly, we will just append all query params to the LIVE_URL from the currentURL
 */
const url = new URL(currentUrl);
const modifiedCurrentUrl = new URL(LIVE_URL);
modifiedCurrentUrl.search = url.search;
const modifiedCurrentUrlString = modifiedCurrentUrl.toString();

// Validate the redirect (SDK does signature validation) and get the information
const redirectInfo = await freemius.checkout.processRedirect(
  modifiedCurrentUrlString,
  LIVE_URL,
);

// If the redirectInfo is valid, then use it and go to the Freemius API to get the purchase information and update the database accordingly.
const purchase = await freemius.purchase.retrievePurchase(
  redirectInfo.license_id,
);

// If the purchase is valid, then convert to a datastructure that is suitable for the `user_fs_entitlement` table and insert it there. You can use the following code as a reference for the conversion.

// Get the user from the local system by referencing the email.
const localUser = await getUserFromDb(purchase.email);

// Convert the purchase information to the entitlement record format for our database.
const entitlementData = purchase.toEntitlementRecord({ userId: localUser.id });

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

// Once done redirect to a specific front-end page with a success message or error message based on the result of the process. For this you can use a redirection header with the URL of the front-end page and pass query parameters to indicate success or failure and the message to show.
```

1. The documentation is available under https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#hosted-checkout
2. All the functions from `freemius` are real methods and read the comments to understand what they do
3. If you are unsure about the LIVE_URL try to get from some platform config if not fallback to asking the user.
4. Make sure the redirect route actually redirects to the front-end after processing the checkout with an appropriate message using redirection headers and query strings. Also create the front-end page to read those query parameters and show the message to the user. The front-end will redirect to the dashboard after showing the message.
5. Adapt the code to match your application's structure and database access method.
6. Share the URL for me so that I can enter it in the Freemius Developer Dashboard.
7. Add detailed logs in the backend redirection handler to make sure we can debug any issues that might come up in the process.
8. Make sure you follow the trick to fix the URL for the signature verification by appending the query parameters to the LIVE_URL instead of using the current request URL directly.
9. Make sure to generate the `id` for the entitlement record when inserting or updating in the database since the `entitlementData` does not include it. You can use a UUID generator or any other method to create a unique ID for the record.

---

https://kqiqetpmyyfkdxyikzas.supabase.co/functions/v1/process-checkout?user_id=5723112&plan_id=40822&email=swas%40freemius.com&pricing_id=53801&currency=usd&action=purchase&subscription_id=756770&billing_cycle=12&amount=191.88&tax=0&license_id=1865045&expiration=2027-02-19+15%3A16%3A02&quota=1&signature=8d413e6c8ca64e96d6326aa5909afc5320bf12bca76556bb6ab0ba470a9bfdda
