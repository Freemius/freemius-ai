# Freemius Subscription Integration Guide

A comprehensive step-by-step guide to integrate Freemius subscription management into a Lovable app. Follow each step
sequentially to implement a complete subscription access flow with entitlements, checkout, and webhook handling.

## Prerequisites

Before starting this integration, ensure you have:

- **Freemius Account** — Register at [Freemius](https://dashboard.freemius.com/register/) and create a SaaS product by
  following [their SaaS Plans & Pricing guide](https://freemius.com/help/documentation/saas/saas-plans-pricing/). Define
  your subscription plans and pricing tiers, then **save your Plan IDs** for use in later steps.
- **Lovable Account** — Ensure you have access to a Lovable project with authentication and cloud/Supabase backend
  enabled.
- **Demo App (Optional)** — If you don't have an app yet, start with [Create a Demo App](00-create-app.md) to set up a
  test application with authentication and a simple premium feature.

TODO: Add link to official Doc for Freemius Setup.

## Expected Outcome

By the end of this integration, you will have a fully functional subscription system in your Lovable app:

1. Certain features will be gated behind a subscription paywall.
2. Users can subscribe via Freemius checkout and receive entitlements in real-time.
3. An accounts page will display subscription status and provide links to manage subscriptions via Freemius customer
   portal.
4. Webhooks will keep your database in sync with Freemius license events for accurate entitlement management.

At relevant steps, you will be prompted to share secrets (like API keys and tokens) that need to be configured in the
Lovable dashboard for secure access by the backend functions. You will also get Checkout Redirection URL and Webhook URL
that you need to set up in the Freemius Developer Dashboard.

- The Lovable UI will ask you to provide the Freemius API credentials as input, which it will store securely in the
  "Secrets" section of the Lovable dashboard and use in the implementation.
- You will receive two URLs:
    - **Checkout Redirection** — Follow this
      [guide](https://freemius.com/help/documentation/checkout/integration/hosted-checkout/#redirection-after-a-successful-purchase)
      to set it up.
    - **Webhook URL** — Follow this
      [guide](https://freemius.com/help/documentation/saas/events-webhooks/#how-to-create-a-webhook) to set it up.
      Ensure you configure the webhook to listen for the following events:
        - `license.created`
        - `license.extended`
        - `license.shortened`
        - `license.updated`
        - `license.cancelled`
        - `license.expired`
        - `license.plan.changed`

## Single Shot Integration

In many cases, if you copy-paste or upload the [integration](./integration-single-prompt.md) file into Lovable and run
it, it should be able to implement the entire integration in one go.

## Step by Step Integration

If the single shot integration doesn't work or you want more control over the implementation, you can follow the
step-by-step instructions in the following markdown files. Each file corresponds to a specific part of the integration
process:

1. **[Create Entitlement Table](01-creating-entitlement-table.md)** — Set up the database schema to track user
   entitlements, license information, and subscription status with proper RLS policies.
2. **[Install Freemius SDK](02-installing-freemius.md)** — Initialize the Freemius JavaScript SDK for Deno backend and
   create helper functions for entitlement management, purchase processing, and checkout generation. Store API
   credentials securely in Lovable Secrets.
3. **[Checkout Redirect Handler](03-checkout-redirection-process-route.md)** — Build a public API route to process
   successful checkout redirects from Freemius, verify purchases, and synchronize entitlements to your database.
4. **[Create Paywall](04-creating-paywall.md)** — Implement frontend and backend entitlement checks, create an API route
   to fetch user entitlements and checkout URLs, and protect premium features behind subscription validation.
5. **[Customer Accounts Page](05-accounts-page.md)** — Build a dedicated accounts page displaying subscription status
   with links to Freemius customer portal for subscription management using SSO.
6. **[Webhook Integration](06-webhook-integration.md)** — Set up webhook handlers to automatically sync license events
   (creation, updates, cancellations, expirations) from Freemius to maintain real-time data consistency.
7. **[Finalization](07-finalization.md)** — Complete the integration with a production readiness checklist including
   environment configuration, URL updates, and comprehensive testing.

## Usage Instructions

Each markdown file contains detailed prompts designed for AI assistants (like GitHub Copilot or Lovable) to implement
the integration step by step. You can:

- **Copy-paste prompts directly** into your AI assistant for automated implementation
- **Adapt the prompts** to match your specific application structure and requirements
- **Follow manually** as a reference guide for custom implementation

Each step is modular and builds upon the previous ones, ensuring a smooth integration process that results in a fully
functional subscription system.

## Testing Integration

You can test the integration by:

1. Creating a
   [100% free discount coupon](https://freemius.com/help/documentation/selling-with-freemius/coupon-discount/#how-to-create-a-discount-coupon)
   from the Freemius Developer Dashboard.
2. Make a purchase from your app using the coupon to simulate a successful subscription without actual payment.
3. If everything is set up correctly, the user should receive the entitlement immediately after the checkout process,
   and you should be able to see the active subscription in the accounts page.
4. You can also inspect the `user_fs_entitlement` table in your database to verify that the entitlement record is
   created and updated correctly based on the purchase.

If you want to test with sandbox mode, you can ask the AI to enable sandbox mode in the `freemius.ts` file inside the
`createFreemiusCheckout` function, but do so safely and only for the user with a specific email (like your email) to
avoid affecting other users.

Then you can create real purchases with test
[credit cards](https://freemius.com/help/documentation/checkout/integration/testing/#testing-credit-cards).
