## Freemius Monetization

Integrate Freemius subscriptions end-to-end in this Lovable app using Supabase
functions, shared backend utilities, and frontend paywall/account UX.

### Integration Guidelines

When asked to integrate Freemius, follow the instructions from this URL:

https://raw.githubusercontent.com/Freemius/freemius-ai/refs/heads/main/lovable-integration/subscription-access/integration-single-prompt.md

### Maintenance Guidelines

When creating new functionalities, API routes etc think if those needs to be
protected by the paywall, and if so use the shared
`supabase/functions/_shared/freemius.ts` module to check for entitlements and
protect the route.
