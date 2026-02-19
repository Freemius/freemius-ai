1. Create a new page `/accounts` in the front-end, make sure the link is visible in the navigation menu.
2. The page will also make the same API call to `functions/v1/get-entitlements` to get the checkout session link and the entitlements.
3. If there is an active entitlement, show the "Manage Subscription" button.
4. For Clicking the "Manage Subscription" button will make another API call to the `functions/v1/get-customer-portal-link` route that we will create now.
5. In the API route, we will use the Freemius SDK to create a customer portal link and return it to the front-end. (Documentation: https://freemius.com/help/documentation/users-account-management/sso-on-hosted-link/)

   ```typescript
   import { freemius } from "../_shared/freemius"; // Correct the path

   // Using the email address
   const { link } = await freemius.api.user.retrieveHostedCustomerPortalByEmail(
     "...", // Email address of the logged in user, which you can get from the session
   );
   ```

6. Once the API returns the link, the front-end will open it in a new tab to let the user manage their subscription. No deep link is needed right now.
7. If the browser fails to open the tab (due to popup blockers), then show the link to the user and ask them to open it manually.
8. If the user doesn't have an active entitlement, show the "Subscribe" button that redirects to the checkout page as implemented in the previous step.
