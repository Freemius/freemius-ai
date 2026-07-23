import { useEffect, useState } from 'react';
import type { EntitlementDTO, PlanPricing } from '@shared/types';
import { getPricing, ApiError } from '../../api';
import { useCheckout } from './checkout-provider';

// Ported Starter Kit <Topup /> table — one-off purchases. Same data source as
// <Subscribe />, but renders ALL lifetime-priced (one-off) plans and opens the
// overlay in lifetime/one-off billing mode. Both one-off modalities render here
// side by side: a lifetime-unlimited plan AND a consumable credits top-up —
// what each grants is the plan's Dashboard title/description/features.
//
// Entitlement-aware (freemius-checkout Skill → pricing-tables.md): for a
// viewer with an active unlimited subscription, the consumable credits pack is
// HIDDEN (their credits would never be consumed — the subscription wins the
// access gate), and a Lifetime plan carries a "replaces your subscription —
// cancel it after purchase" note (buying it does NOT auto-cancel the running
// subscription; they are independent Freemius objects).

export function Topup({
  entitlement = null,
}: {
  entitlement?: EntitlementDTO;
}) {
  const checkout = useCheckout();
  const [plans, setPlans] = useState<PlanPricing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const hasActiveSub =
    Boolean(entitlement) &&
    !entitlement?.isCanceled &&
    entitlement?.type === 'subscription';

  useEffect(() => {
    getPricing()
      .then((r) => setPlans(r.oneoff))
      .catch((e: ApiError) =>
        setError(
          e.status === 401 ? 'Please sign in first.' : 'Failed to load pricing.'
        )
      )
      .finally(() => setLoading(false));
  }, []);

  // Active unlimited subscribers never see the credits pack.
  const visiblePlans = hasActiveSub ? plans.filter((p) => !p.isCredits) : plans;

  if (!loading && visiblePlans.length === 0) {
    // No one-off plans configured (or all hidden for this viewer) — render nothing.
    return null;
  }

  return (
    <section>
      <div className="pricing-head">
        <h2>One-off purchases — lifetime &amp; credit top-ups</h2>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="discount">{error}</p>}

      <div className="plans">
        {visiblePlans.map((plan) => (
          <div className="card" key={plan.planId}>
            <h3>{plan.title}</h3>
            {plan.description && <p className="muted">{plan.description}</p>}
            {plan.lifetime != null && (
              <p>
                <strong>${plan.lifetime}</strong>{' '}
                <span className="muted">one-time</span>
              </p>
            )}
            {hasActiveSub && !plan.isCredits && (
              <p className="discount">
                Replaces your subscription — cancel it after purchase (buying
                this does not cancel it automatically).
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
            <button
              className="btn"
              onClick={() =>
                checkout.open({
                  plan_id: plan.planId,
                  billing_cycle: 'lifetime',
                })
              }
            >
              Buy now
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
