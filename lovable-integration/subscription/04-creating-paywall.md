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
