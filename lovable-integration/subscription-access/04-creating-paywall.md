We will now put all "premium" features behind a paywall in the front-end and in the API functions.

## Backend API Route

We will create an API route in the backend/supabase from where we can get the currently logged in user's entitlements. This will be used in the frontend to check if the user has an active subscription or not and what would be the Freemius Checkout Session URL to make a purchase. For this we will use the Freemius JS SDK instance that we created in the previous step.

Create the route under `supabase/functions/get-entitlements/index.ts` and put the following code in it:

```typescript
import {
  getUserEntitlement,
  createFreemiusCheckout,
} from "../_shared/freemius"; // Correct the path

// Now create the API route handler that will call the above functions and return the entitlement information and the checkout URL to the frontend. Make sure to handle authentication and only allow access to the entitlements of the currently logged in user.

// The return data needs to be of the shape { entitlement: Entitlement | null, checkoutUrl: string }
```

Add some console logs to the API route to make it easier to debug and test.

## Front-end Implementation

1. The front-end when loading will make an API call to the `functions/v1/get-entitlements`
2. If there is an active entitlement, then the front-end will
   1. Show a "Premium" badge in the navbar where currently it shows "Account Status: Free"
   2. Reveal all the UI from where the user can make use of the premium features (for example the "Premium Action" button on the dashboard)
3. If there is no active entitlement, then the front-end will
   1. Show a "Subscribe" button in the navbar where currently it shows "Account Status: Free"
   2. Hide all the UI from where the user can make use of the premium features (for example the "Premium Action" button on the dashboard)
   3. Clicking the "Subscribe" button will redirect the user to the Freemius Checkout page using the checkout URL received from the API.

## Protecting Server Actions

All backend server action that must be behind a paywall will check the `getUserEntitlement` from the `_shared/freemius.ts` file to verify if the user has an active entitlement before allowing access to the feature. If the user does not have an active entitlement, the API route should return an appropriate error message and status code.
