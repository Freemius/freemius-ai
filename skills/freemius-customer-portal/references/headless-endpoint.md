# The headless portal endpoint

The Freemius SDK ships a **headless** Customer Portal: a single backend endpoint
serves portal data and processes every action. You don't build per-action routes
— the SDK's `PortalRequestProcessor` dispatches internally.

## Why headless

- One endpoint, one auth check. The SDK handles dispatch, token signing, and
  token verification.
- The frontend never sees Freemius credentials or constructs action URLs — it
  only follows the signed URLs the SDK baked into the portal data.
- Actions can't be forged: each signed URL is verified server-side before the
  SDK performs it.

## Service (plain TS, separate from the route)

```ts
// src/server/services/freemius/portal.ts
import { freemius, IS_SANDBOX } from './client';
import { env } from '../../env';

// Absolute, public URL of THIS endpoint. The SDK bakes signed action URLs that
// point back here, so it must match what the browser actually hits (proxy host
// and scheme included).
const PORTAL_ENDPOINT = `${env.publicAppUrl}/api/portal`;

export async function getFreemiusUserId(email: string): Promise<string | null> {
  const fsUser = await freemius.api.user.retrieveByEmail(email);
  return fsUser?.id ? String(fsUser.id) : null;
}

export async function processPortalRequest(
  request: Request,
  email: string
): Promise<Response> {
  const processor = freemius.customerPortal.request.createProcessor({
    portalEndpoint: PORTAL_ENDPOINT,
    isSandbox: IS_SANDBOX,
    getUser: async () => {
      const id = await getFreemiusUserId(email);
      return id ? { id, email } : { email };
    },
  });
  return processor(request);
}
```

## Route (thin)

```ts
// src/server/routes/portal.ts
import { Hono } from 'hono';
import { requireUser } from '../middleware/auth';
import { processPortalRequest } from '../services/freemius/portal';

export const portalRoute = new Hono();

portalRoute.on(['GET', 'POST'], '/', requireUser, async (c) => {
  const user = c.get('user');
  return processPortalRequest(c.req.raw, user.email);
});
```

`c.req.raw` hands the SDK the standard `Request` so it can read `?action=`, the
method, the body, and the signed token. The SDK returns a standard `Response`
you return as-is (JSON for data/actions, a PDF stream for invoices).

## Config knobs (`PortalRequestConfig`)

| Field            | Required | Purpose                                                                                                          |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `getUser`        | yes      | Resolve the authenticated Freemius user (id and/or email).                                                       |
| `portalEndpoint` | yes      | Public URL of this endpoint; signed URLs are minted against it.                                                  |
| `isSandbox`      | no       | Match the checkout's sandbox mode — wire to `FREEMIUS_SANDBOX` (never `NODE_ENV`), same flag as `freemius-core`. |
| `onRestore`      | no       | Callback to restore purchases (advanced).                                                                        |

## Gotchas

- **`portalEndpoint` must be the public URL**, not `localhost`, behind a proxy.
  A mismatch makes token verification fail. Derive it from `PUBLIC_APP_URL`.
- **`getUser` is the only identity hook.** Verify the session in `requireUser`
  middleware before delegating; the SDK trusts whatever `getUser` returns.
- **Don't add per-action routes.** Resist building `/api/portal/cancel` etc. —
  the processor already handles every action through the one endpoint.
