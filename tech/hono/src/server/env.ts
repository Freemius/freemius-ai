// Centralized env access. Secrets are read from process.env only — never hardcoded,
// never sent to the browser. See .env.example for the full list.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const isProduction = process.env.NODE_ENV === 'production';

// Optional HTTP Basic Auth gate for public POC/demo deployments. Both vars must
// be set to enable the gate; unset (local dev) means no gate. See .env.example.
const basicAuthUser = process.env.BASIC_AUTH_USER;
const basicAuthPass = process.env.BASIC_AUTH_PASS;

export const env = {
  // Freemius (server-side only)
  freemius: {
    productId: required('FREEMIUS_PRODUCT_ID'),
    apiKey: required('FREEMIUS_API_KEY'),
    secretKey: required('FREEMIUS_SECRET_KEY'),
    publicKey: required('FREEMIUS_PUBLIC_KEY'),
  },
  // Credits / top-up demo (optional). CREDITS_PLAN_ID is the one-off
  // (lifetime-priced) "credits" plan in the Freemius Dashboard; one purchase of
  // it grants CREDITS_PER_PURCHASE OCR page-credits. The amount is resolved
  // server-side (never trust a client-sent value — see the freemius-core Skill,
  // entitlement-logic.md). Unset CREDITS_PLAN_ID disables credit grants.
  credits: {
    planId: process.env.CREDITS_PLAN_ID ?? '',
    perPurchase: Number(optional('CREDITS_PER_PURCHASE', '10')),
  },
  // Plan-tier feature mapping (optional). Plan IDs are env-driven — never
  // hardcoded. The tier → feature logic lives in services/plans.ts:
  //   Premium (any other subscription plan) → unlimited PDF OCR only
  //   PRO_PLAN_ID                           → unlimited PDF + image OCR
  //   LIFETIME_PLAN_ID (one-off)            → unlimited everything, forever
  // Unset values simply disable the respective tier distinction.
  plans: {
    proPlanId: process.env.PRO_PLAN_ID ?? '',
    lifetimePlanId: process.env.LIFETIME_PLAN_ID ?? '',
  },
  mistralApiKey: required('MISTRAL_API_KEY'),
  databaseUrl: required('DATABASE_URL'),
  publicAppUrl: optional('PUBLIC_APP_URL', 'http://localhost:5173'),
  port: Number(optional('PORT', '8787')),
  isProduction,
  // Serve the built Vite frontend from the Hono process. Defaults to on in
  // production; can be forced via SERVE_STATIC so a sandbox deploy still serves
  // the UI from one process.
  serveStatic: process.env.SERVE_STATIC
    ? process.env.SERVE_STATIC === 'true'
    : isProduction,
  // Freemius sandbox/test mode. Decoupled from NODE_ENV so a deployed instance
  // (NODE_ENV=production) can still run against the Freemius sandbox. Defaults
  // to sandbox unless explicitly disabled.
  freemiusSandbox: process.env.FREEMIUS_SANDBOX
    ? process.env.FREEMIUS_SANDBOX === 'true'
    : !isProduction,
  // HTTP Basic Auth gate for public POC deployments (optional).
  basicAuthUser,
  basicAuthPass,
  basicAuthEnabled: Boolean(basicAuthUser && basicAuthPass),
};
