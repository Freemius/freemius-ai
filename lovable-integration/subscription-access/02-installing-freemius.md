# Step 2: Install Freemius SDK and Create Shared Backend Module

We will install the Freemius JS SDK for backend. This is strictly meant for
backend and should not be exposed in the frontend. The package is
`@freemius/sdk`.

Create a file called `supabase/functions/_shared/freemius.ts` for
backend/supabase and put the following code in it:

```ts
import { Freemius, PurchaseEntitlementData, Checkout } from 'npm:@freemius/sdk';

export const freemius = new Freemius({
  productId: Deno.env.get('FREEMIUS_PRODUCT_ID')!,
  apiKey: Deno.env.get('FREEMIUS_API_KEY')!,
  secretKey: Deno.env.get('FREEMIUS_SECRET_KEY')!,
  publicKey: Deno.env.get('FREEMIUS_PUBLIC_KEY')!,
});

const SANDBOX = false; // Change this to true if you want to test in sandbox mode

/**
 * Get the active entitlement for a user based on the records in the database.
 * This function will be used in the API route to get the user's entitlement information.
 */
async function getUserEntitlement(userId: string) {
  // Somehow read from the `user_fs_entitlement` table where the userId matches.
  const entitlements = await someDbCall();

  // We need to map the DB records to camelCase format expected by the Freemius SDK.
  const mappedEntitlements = entitlements.map((entitlement) => ({
    fsLicenseId: entitlement.fs_license_id,
    fsPlanId: entitlement.fs_plan_id,
    fsPricingId: entitlement.fs_pricing_id,
    fsUserId: entitlement.fs_user_id,
    type: entitlement.type,
    expiration: entitlement.expiration,
    isCanceled: entitlement.is_canceled,
    createdAt: entitlement.created_at,
  }));

  // Use the Freemius SDK to get the active entitlement for the user
  const actives = freemius.entitlement.getActives(mappedEntitlements) ?? [];
  return actives?.[actives.length - 1] ?? null;
}

/**
 * Create a Function to synchronize the entitlement information to the database.
 */
async function processPurchase(licenseId: string) {
  const purchaseInfo = await freemius.purchase.retrievePurchase(licenseId);
  const localUser = await getUserFromDb(purchaseInfo.email);

  // Convert the purchase information to the entitlement record format for our database.
  const entitlementData = purchase.toEntitlementRecord({
    userId: localUser.id,
  });

  const fsLicenseId = purchase.licenseId;
  // Now depending whether a record exists in the `user_fs_entitlement` table based on the unique key `fsLicenseId` either insert a new record or update the existing one with the new information from the purchase.
  const entitlementDataForDB = {
    user_id: entitlementData.userId,
    fs_license_id: entitlementData.fsLicenseId,
    fs_plan_id: entitlementData.fsPlanId,
    fs_pricing_id: entitlementData.fsPricingId,
    fs_user_id: entitlementData.fsUserId,
    type: entitlementData.type,
    expiration: entitlementData.expiration,
    is_canceled: entitlementData.isCanceled,
    created_at: entitlementData.createdAt,
  };

  // The record does not include `id` so generate for the upsert.
  // Use the DATABASE upsert functionality to keep the operation atomic
  const newId = generateUniqueId();
  const { error } = await db
    .from('user_fs_entitlement')
    .upsert(
      { id: newId, ...entitlementDataForDB },
      { onConflict: 'fsLicenseId' }
    );
}

type PricingData = {
  annual: number | null;
  monthly: number | null;
  // Percentage discount when choosing annual over monthly, rounded to nearest integer. Null if discount cannot be calculated (e.g. missing price data).
  annualDiscount: number | null;
  planId: string;
  title: string;
  canCheckout: boolean;
  checkoutUrl: string;
  isCurrentPlan: boolean;
  buttonText: string;
  features: { title: string; value: string }[];
};

/**
 * Create a Checkout session for the user.
 */
async function createFreemiusCheckout(
  user: { email: string; firstName?: string; lastName?: string },
  planId?: string
): Promise<Checkout> {
  // @ts-expect-error - The planId can be undefined and depending on some TS config it can cause error, but in practice this is fine.
  const checkout = await freemius.checkout.create({
    user,
    planId: planId,
    isSandbox: SANDBOX,
  });

  return checkout;
}

async function getPricingData(
  user: { email: string; firstName?: string; lastName?: string },
  entitlement: Pick<
    PurchaseEntitlementData,
    'fsLicenseId' | 'fsPlanId'
  > | null = null
): Promise<PricingData[]> {
  const productPricing = await freemius.api.product.retrievePricingData();
  const upgradeAuth = entitlement
    ? await freemius.api.license.retrieveCheckoutUpgradeAuthorization(
        entitlement.fsLicenseId
      )
    : null;

  const subscription = entitlement
    ? await freemius.api.license.retrieveSubscription(entitlement.fsLicenseId)
    : null;
  const hasActiveSubscription = subscription?.canceled_at == null;
  const currentPlanIndex = entitlement
    ? (productPricing?.plans?.findIndex(
        (plan) => plan.id === entitlement.fsPlanId
      ) ?? -1)
    : -1;

  const data: PricingData[] = [];

  let index = 0;
  for (const plan of productPricing?.plans ?? []) {
    if (plan.is_hidden) {
      continue;
    }

    const checkout = await createFreemiusCheckout(user, plan.id!);
    const isCurrentPlan = entitlement?.fsPlanId == plan.id;

    if (upgradeAuth) {
      checkout.setLicenseUpgradeByAuth({
        authorization: upgradeAuth,
        licenseId: entitlement!.fsLicenseId,
      });
    }

    const annualPrice = plan.pricing?.[0]?.annual_price;
    const monthlyPrice = plan.pricing?.[0]?.monthly_price;

    let annualOverMonthlyDiscount = null;
    if (annualPrice != undefined && monthlyPrice != undefined) {
      const annualCost = annualPrice;
      const monthlyCost = monthlyPrice * 12;
      if (monthlyCost > 0) {
        annualOverMonthlyDiscount = Math.round(
          ((monthlyCost - annualCost) / monthlyCost) * 100
        );
      }
    }

    const canCheckout = !hasActiveSubscription || !isCurrentPlan;

    const isLowerPlan = currentPlanIndex !== -1 && index < currentPlanIndex;

    const buttonText =
      !upgradeAuth || !hasActiveSubscription
        ? 'Subscribe'
        : isCurrentPlan
          ? 'Your Plan'
          : isLowerPlan
            ? 'Downgrade'
            : 'Upgrade';

    data.push({
      isCurrentPlan,
      canCheckout,
      buttonText,
      annual: plan.pricing?.[0]?.annual_price ?? null,
      monthly: plan.pricing?.[0]?.monthly_price ?? null,
      annualDiscount: annualOverMonthlyDiscount,
      planId: plan.id!,
      title: plan.title!,
      checkoutUrl: canCheckout ? checkout.getLink() : '',
      features:
        plan.features?.map((feature) => ({
          title: feature.title!,
          value: feature.value!,
        })) ?? [],
    });

    index++;
  }

  return data;
}

/**
 * Function to cancel subscription
 */
async function cancelSubscription(
  entitlement: Pick<PurchaseEntitlementData, 'fsLicenseId'>
): Promise<boolean> {
  const subscription = await freemius.api.license.retrieveSubscription(
    entitlement.fsLicenseId
  );

  if (!subscription || subscription.canceled_at != null) {
    return false;
  }

  await freemius.api.subscription.cancel(subscription.id!);

  return true;
}

export const LIVE_SUPABASE_URL =
  'https://xyz.supabase.co/functions/v1/process-checkout'; // Change this to your actual URL

export const LIVE_FRONTEND_URL = 'https://your-frontend-url.com'; // Change this to your actual frontend URL
```

Store all credentials securely inside the "Secrets" section of the Lovable
dashboard.

The file must be created under `supabase/functions/_shared` or any other shared
location that can be imported in our API routes.

1. The documentation is available here:
   https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#using-entitlement-logic
2. The `freemius.entitlement.getActive` method accepts an array of DB records
   from the `user_fs_entitlement` table and returns the active entitlement based
   on the expiration date and cancellation status. You can use this code as-is.
3. The `createFreemiusCheckout` and `getPricingData` function must receive the
   email and the other firstName and lastName are optional. Try to get those
   data from the current auth session if available.
4. The code given is just for demonstration purposes, you will need to adapt it
   to your application's structure and database access method.
5. If you are unsure about the `LIVE_SUPABASE_URL` try to get from some platform
   config if not fallback to asking the user.
6. Make sure to generate the `id` for the entitlement record when inserting or
   updating in the database since the `entitlementData` does not include it. You
   can use a UUID generator or any other method to create a unique ID for the
   record.
7. The `processPurchase` function will have atomic database upsert operation so
   that the race conditions are handled properly when there are multiple webhook
   events for the same license in a short period of time. Make sure to use the
   upsert functionality provided by your database to achieve this. The unique
   constraint should be `fsLicenseId`, the database is already created in that
   way.

## Data Mapping

- The Freemius SDK expects **camelCase** properties (e.g. `fsLicenseId`,
  `isCanceled`, `fsUserId`).
- When reading entitlement rows from the database and passing them to any
  Freemius SDK method (e.g. `freemius.entitlement.getActive()`), always map or
  convert the column names from snake_case to camelCase to match the format
  expected by the SDK.
- Similarly, when writing SDK output back to the database (e.g.
  `purchase.toEntitlementRecord()`), make sure to convert the camelCase
  properties back to snake_case to match the database column names.
