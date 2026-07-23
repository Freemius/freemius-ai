import { type PurchaseInfo } from '@freemius/sdk';
import { freemius } from './client';
import { db } from '../../db';
import { creditsForPlan, grantCredits } from '../credits';
import { isCreditsPlan } from '../plans';

// All entitlement-mirror logic lives here, in a plain-TS service separate from routes.
// The local user_fs_entitlement table is a cache; Freemius is the source of truth.

export async function findUserByEmail(email: string) {
  return db.user.findUnique({ where: { email } });
}

/**
 * Upsert a Freemius purchase into the local entitlement mirror. Idempotent thanks
 * to the unique fsLicenseId — concurrent webhook deliveries collapse to one row.
 */
export async function processPurchaseInfo(
  purchase: PurchaseInfo
): Promise<void> {
  const user = await findUserByEmail(purchase.email);
  if (!user) {
    // User not registered locally yet. Skip (could auto-provision instead).
    console.warn(
      '[entitlement] no local user for purchase email; skipping sync'
    );
    return;
  }

  // Credits demo: a purchase of the one-off "credits" plan also grants credits.
  // Resolved server-side per plan id (creditsForPlan) — never client-sent.
  const planCredits = purchase.isOneOff() ? creditsForPlan(purchase.planId) : 0;

  // Entitlement upsert + credit grant run in one transaction. The grant only
  // happens when the license row is NEW (first sync of this fsLicenseId) —
  // that is the double-grant guard: a re-delivered license.created webhook or
  // the overlay callback racing the webhook re-runs the upsert idempotently
  // but must not credit the balance twice. Top-ups STACK (increment) across
  // distinct licenses.
  await db.$transaction(async (tx) => {
    const existing = await tx.userFsEntitlement.findUnique({
      where: { fsLicenseId: purchase.licenseId },
      select: { id: true },
    });

    await tx.userFsEntitlement.upsert({
      where: { fsLicenseId: purchase.licenseId },
      update: purchase.toEntitlementRecord(),
      create: purchase.toEntitlementRecord({ userId: user.id }),
    });

    if (!existing && planCredits > 0) {
      await grantCredits(user.id, planCredits, tx);
      console.log(
        '[entitlement] granted',
        planCredits,
        'credits for top-up license',
        purchase.licenseId
      );
    }
  });
  console.log(
    '[entitlement] synced license',
    purchase.licenseId,
    'for user',
    user.id
  );
}

/** Fetch the authoritative purchase from Freemius by license id, then sync locally. */
export async function syncEntitlementByLicenseId(
  licenseId: string
): Promise<void> {
  const purchase = await freemius.purchase.retrievePurchase(licenseId);
  if (purchase) {
    await processPurchaseInfo(purchase);
  }
}

export async function deleteEntitlement(fsLicenseId: string): Promise<void> {
  await db.userFsEntitlement
    .delete({ where: { fsLicenseId } })
    .catch(() => undefined); // tolerate already-deleted
  console.log('[entitlement] deleted license', fsLicenseId);
}

/**
 * Return the user's active entitlement (not expired, not canceled) or null.
 *
 * Two kinds of entitlement unlock the app:
 *  - subscriptions — validity rules encapsulated by freemius.entitlement.getActive
 *    (the SDK helper only considers type 'subscription');
 *  - one-off LIFETIME licenses (type 'oneoff') — a valid one is an unlimited,
 *    forever entitlement. The one-off CREDITS plan is deliberately excluded:
 *    its license is a metered top-up voucher (handled by the credit balance),
 *    not an unlimited entitlement — it must never pass the paywall by itself.
 *
 * An active subscription wins (portal/upgrade flows attach to it); otherwise a
 * valid non-credits one-off license serves as the entitlement.
 */
export async function getUserEntitlement(userId: string) {
  const rows = await db.userFsEntitlement.findMany({ where: { userId } });

  const subscription = freemius.entitlement.getActive(
    rows.filter((r) => r.type === 'subscription')
  );
  if (subscription) return subscription;

  const now = new Date();
  return (
    rows.find(
      (r) =>
        r.type === 'oneoff' &&
        !isCreditsPlan(r.fsPlanId) &&
        !r.isCanceled &&
        (r.expiration === null || r.expiration > now)
    ) ?? null
  );
}
