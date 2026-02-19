Now we will create an API endpoint from where we will get entitlement information and checkout session link for the currently logged in user.

---

We will create an API route in the backend/supabase from where we can get the currently logged in user's entitlements. This will be used in the frontend to check if the user has an active subscription or not and what would be the Freemius Checkout Session URL to make a purchase. For this we will use the Freemius JS SDK instance that we created in the previous step.

Create the route under `supabase/functions/get-entitlements/index.ts` and put the following code in it:

```typescript
import { freemius } from "../_shared/freemius"; // Correct the path

function getUserEntitlement(userId: string) {
  // Somehow read from the `user_fs_entitlement` table where the userId matches.
  const entitlements = await someDbCall();

  // Use the Freemius SDK to get the active entitlement for the user
  return freemius.entitlement.getActive(entitlements);
}

function createFreemiusCheckout(user: {
  email: string;
  firstName?: string;
  lastName?: string;
}): string {
  const checkout = await freemius.checkout.create({
    user,
    isSandbox: process.env.NODE_ENV !== "production",
  });

  return checkout.getLink();
}

// Now create the API route handler that will call the above functions and return the entitlement information and the checkout URL to the frontend. Make sure to handle authentication and only allow access to the entitlements of the currently logged in user.

// The return data needs to be of the shape { entitlement: Entitlement | null, checkoutUrl: string }
```

1. The documentation is available here: https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#using-entitlement-logic
2. The `freemius.entitlement.getActive` method accepts an array of DB records from the `user_fs_entitlement` table and returns the active entitlement based on the expiration date and cancellation status. You can use this code as-is.
3. The `createFreemiusCheckout` function must receive the email and the other firstName and lastName are optional. Try to get those data from the current auth session if available.
4. The code given is just for demonstration purposes, you will need to adapt it to your application's structure and database access method.

---
