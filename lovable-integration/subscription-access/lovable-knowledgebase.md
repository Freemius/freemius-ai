# Freemius Monetization

Integrate Freemius subscriptions end-to-end in this Lovable app using Supabase
functions, shared backend utilities, and frontend paywall/account UX.

# Requirements and constraints

1. Do not expose Freemius secret credentials in frontend code.
2. Use Supabase Edge Functions for backend routes.
3. Use a shared backend module (for example
   `supabase/functions/_shared/freemius.ts`) so logic is not duplicated.
4. Add structured logs to all backend routes for debugging.
5. Keep sandbox checkout disabled by default (`SANDBOX = false`) unless
   explicitly requested.
6. Use environment secrets for:
    - `FREEMIUS_PRODUCT_ID`
    - `FREEMIUS_API_KEY`
    - `FREEMIUS_SECRET_KEY`
    - `FREEMIUS_PUBLIC_KEY`

# General Guidelines

1. As the shared `supabase/functions/_shared/freemius.ts` module is built, use
   that to protect any API route that needs to be behind the paywall.
2. In the same module we will have constants for the lovable front-end URL and
   supabase URL. Always update those to the correct URLs for the environment
   (development or production) and use those constants in the code instead of
   hardcoding the URLs in multiple places.

# Integration Guidelines

When asked to integrate Freemius, follow the instructions from this URL:

https://raw.githubusercontent.com/Freemius/freemius-ai/refs/heads/main/lovable-integration/subscription-access/integration-single-prompt.md
