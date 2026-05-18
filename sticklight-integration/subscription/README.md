# Freemius Integration for Subscription Based Access in Sticklight

This guide demonstrate how you can integrate Freemius into your Sticklight SaaS. We
assume you want to give a simple subscription based access to certain features
in your application. If the user has an active subscription, then can perform
it, otherwise you want to show a button that takes them to the Checkout flow.

## Getting Started

Before starting this integration, ensure you have:

- **Freemius Account** — Register at
  [Freemius](https://dashboard.freemius.com/register/) and create a SaaS product
  by following
  [their SaaS Plans & Pricing guide](https://freemius.com/help/documentation/saas/saas-plans-pricing/).
- **Sticklight Account** — Ensure you have access to a Sticklight project with
  authentication and cloud/Supabase backend enabled.
- **Demo App (Optional)** — If you don't have an app yet, start with
  [Create a Demo App](00-create-app.md) to set up a test application with
  authentication and a simple premium feature.

Then follow our documentation [here](https://freemius.com/help/documentation/ai/sticklight/). It will explain the needed steps and expected outcome.

### Usage Instructions

The [markdown file](prompt.md) contains detailed prompts designed for AI assistants (like
GitHub Copilot or Sticklight) to implement the integration step by step. You can:

- **Copy-paste prompts directly** into your AI assistant for automated
  implementation
- **Adapt the prompts** to match your specific application structure and
  requirements
- **Follow manually** as a reference guide for custom implementation

Each step is modular and builds upon the previous ones, ensuring a smooth
integration process that results in a fully functional subscription system.

### Testing Checkout Integration

You can test the integration by:

1. Creating a
   [100% free discount coupon](https://freemius.com/help/documentation/selling-with-freemius/coupon-discount/#how-to-create-a-discount-coupon)
   from the Freemius Developer Dashboard.
2. Make a purchase from your app using the coupon to simulate a successful
   subscription without actual payment.
3. If everything is set up correctly, the user should receive the entitlement
   immediately after the checkout process, and you should be able to see the
   active subscription in the accounts page.
4. You can also inspect the `user_fs_entitlement` table in your database to
   verify that the entitlement record is created and updated correctly based on
   the purchase.

If you want to test with sandbox mode, you can ask the AI to enable sandbox mode
in the `freemius.ts` file inside the `createFreemiusCheckout` function, but do
so safely and only for the user with a specific email (like your email) to avoid
affecting other users.

Then you can create real purchases with test
[credit cards](https://freemius.com/help/documentation/checkout/integration/testing/#testing-credit-cards).
