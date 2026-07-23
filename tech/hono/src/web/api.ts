import type {
  CheckoutSerialized,
  EntitlementDTO,
  OcrResult,
  PricingResponse,
} from '@shared/types';

// Prototype identity: the signed-in user's email, stored locally and sent as a header.
// A real app replaces this with proper session/JWT auth.
const USER_KEY = 'docvault.userEmail';

export function getUserEmail(): string | null {
  return localStorage.getItem(USER_KEY);
}

export function setUserEmail(email: string): void {
  localStorage.setItem(USER_KEY, email);
}

export function clearUserEmail(): void {
  localStorage.removeItem(USER_KEY);
}

function authHeaders(): Record<string, string> {
  const email = getUserEmail();
  return email ? { 'x-user-email': email } : {};
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export const getEntitlement = () =>
  api<{ entitlement: EntitlementDTO; creditBalance: number | null }>(
    '/api/entitlement'
  );

export const getPricing = () => api<PricingResponse>('/api/checkout/pricing');

/** Base, user-scoped serialized checkout used to prime the overlay provider. */
export const getBaseCheckout = () => api<CheckoutSerialized>('/api/checkout');

/**
 * License-upgrade checkout link for an already-subscribed user (plan change of
 * the existing license — never a plain subscribe, which would create a second
 * subscription). Server route: GET /api/checkout/upgrade.
 */
export const getUpgradeCheckout = (planId?: string) =>
  api<{ link: string }>(
    `/api/checkout/upgrade${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`
  );

export const runOcr = (
  filename: string,
  source: string,
  kind: 'document' | 'image'
) =>
  api<OcrResult>('/api/ocr', {
    method: 'POST',
    body: JSON.stringify({ filename, source, kind }),
  });

/** The endpoint the ported <CustomerPortal /> component talks to. */
export const PORTAL_ENDPOINT = '/api/portal';

/** Shared fetch wrapper used by the portal component for its signed action calls. */
export function portalFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
}
