## Freemius Monetization

Integrate Freemius end-to-end in this Lovable app using Supabase functions,
shared backend utilities, and frontend paywall/account UX.

### Integration Guidelines

When asked to integrate Freemius, follow the instructions from this URL:

https://raw.githubusercontent.com/Freemius/freemius-ai/refs/heads/main/lovable-integration/subscription/prompt.md

### Maintenance & Paywall Guidelines

- To protect any API route, use the shared
  `supabase/functions/_shared/freemius.ts` module's `getUserEntitlement` (for
  any plan) or `hasPlan` (specific plan) functions to check for entitlements and
  protect the route.
- For front-end paywall, call the `functions/v1/get-entitlements` API route to
  check for active entitlements and show a paywall UI with link to `/pricing`
  through a `Subscribe` button if there is no active subscription.

---
