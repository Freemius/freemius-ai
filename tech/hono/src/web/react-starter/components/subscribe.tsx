import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EntitlementDTO, PlanPricing } from '@shared/types';
import { getPricing, getUpgradeCheckout, ApiError } from '../../api';
import { useCheckout } from './checkout-provider';

// Ported Starter Kit <Subscribe /> table — dynamic subscription pricing table.
// Fetches plans from the backend and renders, for each plan, a Monthly card and
// (when the plan has an annual price) a Yearly card side by side. Each card opens
// the overlay for its own plan + billing cycle.
//
// Entitlement-aware (freemius-checkout Skill → pricing-tables.md): a viewer
// with an ACTIVE SUBSCRIPTION never gets a plain Subscribe button — that would
// create a SECOND parallel subscription. Their current plan is marked owned
// ("manage in Account"); other plans offer an Upgrade button wired to the
// server's license-upgrade checkout route (plan change of the existing
// license).

export function Subscribe({
  entitlement = null,
}: {
  entitlement?: EntitlementDTO;
}) {
  const checkout = useCheckout();
  const [plans, setPlans] = useState<PlanPricing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const activeSub =
    entitlement &&
    !entitlement.isCanceled &&
    entitlement.type === 'subscription'
      ? entitlement
      : null;

  const startUpgrade = async (planId: string) => {
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      const { link } = await getUpgradeCheckout(planId);
      window.location.href = link;
    } catch {
      setUpgradeError('Could not start the upgrade. Please try again.');
      setUpgradeBusy(false);
    }
  };

  useEffect(() => {
    getPricing()
      .then((r) => setPlans(r.subscription))
      .catch((e: ApiError) =>
        setError(
          e.status === 401 ? 'Please sign in first.' : 'Failed to load pricing.'
        )
      )
      .finally(() => setLoading(false));
  }, []);

  // Per-card action, entitlement-aware:
  //  - no active subscription → plain Subscribe (overlay checkout);
  //  - active sub, this plan  → owned — "manage in Account", no buy button;
  //  - active sub, other plan → Upgrade via the license-upgrade checkout route.
  const renderAction = (plan: PlanPricing, cycle: 'monthly' | 'annual') => {
    if (!activeSub) {
      return (
        <button
          className="btn"
          onClick={() =>
            checkout.open({ plan_id: plan.planId, billing_cycle: cycle })
          }
        >
          Subscribe
        </button>
      );
    }
    if (String(plan.planId) === String(activeSub.fsPlanId)) {
      return (
        <p className="muted">
          Current plan · <Link to="/account">manage in Account</Link>
        </p>
      );
    }
    return (
      <button
        className="btn"
        disabled={upgradeBusy}
        onClick={() => void startUpgrade(plan.planId)}
      >
        {upgradeBusy ? 'Preparing upgrade…' : 'Upgrade to this plan'}
      </button>
    );
  };

  return (
    <section>
      <div className="pricing-head">
        <h2>Subscription plans</h2>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="discount">{error}</p>}
      {upgradeError && <p className="discount">{upgradeError}</p>}

      {plans.map((plan) => (
        <div className="plan-group" key={plan.planId}>
          <h3>{plan.title}</h3>
          {plan.description && <p className="muted">{plan.description}</p>}

          <div className="plans">
            {/* Monthly card — always rendered. */}
            <div className="card">
              <h4>Monthly</h4>
              {plan.monthly != null && (
                <p>
                  <strong>${plan.monthly}</strong>{' '}
                  <span className="muted">/ month</span>
                </p>
              )}
              <ul>
                {plan.features.map((f, i) => (
                  <li key={i}>
                    {f.title}
                    {f.value ? `: ${f.value}` : ''}
                  </li>
                ))}
              </ul>
              {renderAction(plan, 'monthly')}
            </div>

            {/* Yearly card — only when the plan has an annual price. Appears
                automatically once the operator adds the annual price in Freemius. */}
            {plan.annual != null && (
              <div className="card">
                <h4>Yearly</h4>
                <p>
                  <strong>${plan.annual}</strong>{' '}
                  <span className="muted">/ year</span>{' '}
                  {plan.annualDiscount != null && plan.annualDiscount > 0 && (
                    <span className="discount">
                      save {plan.annualDiscount}%
                    </span>
                  )}
                </p>
                <ul>
                  {plan.features.map((f, i) => (
                    <li key={i}>
                      {f.title}
                      {f.value ? `: ${f.value}` : ''}
                    </li>
                  ))}
                </ul>
                {renderAction(plan, 'annual')}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
