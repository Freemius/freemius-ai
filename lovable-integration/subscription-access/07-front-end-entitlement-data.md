We will now implement a paywall.

---

We will now put all "premium" features behind a paywall in the front-end and in the API functions.

1. The front-end when loading will make an API call to the `functions/v1/get-entitlements` route and if no entitlement, will show a "Subscribe" like button that will redirect to the Freemius Checkout page. The endpoint already returns both the entitlements and the checkout session link.
2. If there is an active entitlement, then the front-end will show the premium features.
3. All backend server action that must be behind a paywall will check the `user_fs_entitlement` table in a similar way to the `functions/v1/get-entitlements` route and if no active entitlement, will return an error response indicating that the user needs to subscribe to access this feature.
4. The above can be done by extracting the login in a shared function `_shared/freemius.ts` that can be used in all API routes to get users entitlement. Look the code in the `functions/v1/get-entitlements` route for reference on how to do that.

---
