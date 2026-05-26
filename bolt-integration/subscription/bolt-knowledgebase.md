## Freemius Monetization

Integrate Freemius end-to-end in this Bolt app using Supabase functions,
shared backend utilities, and frontend paywall/account UX.

### Integration Guidelines

When asked to integrate Freemius, follow the instructions from this URL:

https://raw.githubusercontent.com/Freemius/freemius-ai/refs/heads/main/bolt-integration/subscription/prompt.md

### Protect Premium Features with Paywall

- To restrict any premium operations in the API routes that require an active subscription, use the shared `supabase/functions/_shared/freemius.ts` module's `getUserEntitlement` (for any plan) or `hasPlan` (specific plan) functions. Return a 403 response with `code: "subscription_required"` if the user doesn't have the required subscription.
- On the frontend, handle the `subscription_required` error by reading the response body from `error.context.body` as a stream (since Supabase `functions.invoke` puts non-2xx response bodies there as a ReadableStream, not plain JSON). Show a lock-style paywall UI with a link to `/pricing`. You can disable relevant UI after the first failed attempt.
- The front-end may also call the `functions/v1/get-entitlements` API route to check for active entitlements and show a paywall UI with a link to `/pricing` through a `Subscribe` button if there is no active subscription.
- The front-end may also call the `functions/v1/get-entitlements` API route to check for active entitlements and show a paywall UI with a link to `/pricing` through a `Subscribe` button if there is no active subscription.
- Correctly find the matching user and write the entitlement record. The getUserByEmail should read the correct field, `purchase.email`, to skip the silently returned null for every purchase.
- The SDK's `freemius.entitlement.getActive()` throws a hard error if more than one active entitlement is found. With a real account that has been through multiple subscription cycles, switch to `freemius.entitlement.getActives()` (which returns an array) and then pick the most recently created one.
