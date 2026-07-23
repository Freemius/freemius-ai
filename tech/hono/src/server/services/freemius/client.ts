import { Freemius } from '@freemius/sdk';
import { env } from '../../env';

// The Freemius JS SDK instance. Strictly server-side: the secret/api keys must
// never reach the browser. (freemius-core Skill, golden rule #1.)
export const freemius = new Freemius({
  productId: env.freemius.productId,
  apiKey: env.freemius.apiKey,
  secretKey: env.freemius.secretKey,
  publicKey: env.freemius.publicKey,
});

// Sandbox during dev/testing; live in production. Decoupled from NODE_ENV via
// FREEMIUS_SANDBOX so a deployed (production) instance can still target the
// Freemius sandbox for validation.
export const IS_SANDBOX = env.freemiusSandbox;
