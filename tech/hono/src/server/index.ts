import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { logger } from 'hono/logger';
import { env } from './env';
import { checkoutRoute } from './routes/checkout';
import { purchaseRoute } from './routes/purchase';
import { webhooksRoute } from './routes/webhooks';
import { portalRoute } from './routes/portal';
import { ocrRoute } from './routes/ocr';
import { entitlementRoute } from './routes/entitlement';

const app = new Hono();
app.use('*', logger());

// --- Unauthenticated routes (registered BEFORE the basic-auth gate) ---
// These must never be gated:
//   /api/health        → uptime monitoring
//   /api/webhooks/*     → Freemius server-to-server POSTs (cannot send
//                          basic-auth credentials; gating them breaks webhooks)
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/webhooks', webhooksRoute);

// --- Optional HTTP Basic Auth gate for public POC/demo deployments ---
// Only mounted when BOTH BASIC_AUTH_USER and BASIC_AUTH_PASS are set. Everything
// registered AFTER this line (remaining API routes + static frontend) is gated.
// Local dev (vars unset) behaves exactly as before — no gate.
if (env.basicAuthEnabled) {
  app.use(
    '*',
    basicAuth({
      username: env.basicAuthUser!,
      password: env.basicAuthPass!,
      realm: 'DocVault POC',
    })
  );
}

// API routes — all Freemius/Mistral logic lives in services; routes stay thin.
app.route('/api/checkout', checkoutRoute);
app.route('/api/purchase', purchaseRoute);
app.route('/api/portal', portalRoute);
app.route('/api/ocr', ocrRoute);
app.route('/api/entitlement', entitlementRoute);

// In production (or when SERVE_STATIC=true), serve the built Vite frontend
// (dist/web) from this process. In dev, Vite serves it.
if (env.serveStatic) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('/*', serveStatic({ path: './dist/web/index.html' }));
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[docvault] server listening on http://localhost:${info.port}`);
});
