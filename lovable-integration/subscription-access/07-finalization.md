Now that the Freemius Licensing integraiton is complete, please check the followings:

1. The checkout generation under `_shared/freemius.ts` file is not sandbox unless that's what I explicitly want for testing.
2. We don't have any additional endpoints that needs to be protected by the paywall, but if you have any, make sure to add the entitlement check in those endpoints as well. Use the shared function in `_shared/freemius.ts` to get the user's entitlements and check if there is an active one before allowing access to the feature.
3. If the app has been published, make sure to update all front-end URLs to point to the production URL instead of the local development URL inside `_shared/freemius.ts`.
4. Make sure all references to the supabase URL in the code are updated to the production URL if the app has been published.
