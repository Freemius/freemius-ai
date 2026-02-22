# Freemius Subscription Integration Guide

A comprehensive step-by-step guide to integrate Freemius subscription management into a Lovable app. Follow each step
sequentially to implement a complete subscription access flow with entitlements, checkout, and webhook handling.

## Prerequisites

Before starting this integration, ensure you have:

- **Freemius Account** — Register at [Freemius](https://dashboard.freemius.com/register/) and create a SaaS product
  following [their SaaS Plans & Pricing guide](https://freemius.com/help/documentation/saas/saas-plans-pricing/). Define
  your subscription plans and pricing tiers, then **save your Plan IDs** for use in later steps.
- **Lovable Account** — Ensure you have access to a Lovable project with authentication and cloud/Supabase backend
  enabled.
- **Demo App (Optional)** — If you don't have an app yet, start with [Create a Demo App](00-create-app.md) to set up a
  test application with authentication and a simple premium feature.

## Integration Steps

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
the integration step-by-step. You can:

- **Copy-paste prompts directly** into your AI assistant for automated implementation
- **Adapt the prompts** to match your specific application structure and requirements
- **Follow manually** as a reference guide for custom implementation

Each step is modular and builds upon the previous ones, ensuring a smooth integration process that results in a fully
functional subscription system.
