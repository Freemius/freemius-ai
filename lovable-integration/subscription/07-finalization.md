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
