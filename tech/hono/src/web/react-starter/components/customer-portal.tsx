import { useCallback, useEffect, useState } from 'react';

// Ported Starter Kit <CustomerPortal /> — self-service subscription management.
// It talks to ONE backend endpoint (our Hono `GET|POST /api/portal`). The Freemius
// SDK request processor on the server:
//   - GET  ?action=portal_data  → returns subscriptions + billing + payments, with
//     pre-signed action URLs baked in (cancel, coupon, invoice, billing).
//   - POST/GET on those signed URLs → performs the action (token-verified).
// The component never calls Freemius directly; it just renders the data and hits the
// signed URLs. Upgrades are the exception: the upgrade goes through the server's
// license-upgrade checkout route (GET /api/checkout/upgrade), which does a plan
// change of the existing license — a plain subscribe would create a second
// subscription. See the freemius-customer-portal Skill.

// --- Minimal shapes of the SDK PortalData we render (server is the source of truth) ---

type PortalSubscription = {
  subscriptionId: string;
  planId: string;
  planTitle: string;
  billingCycle: string | null;
  renewalAmount: number;
  currency: string;
  isActive: boolean;
  renewalDate: string | null;
  cancelledAt?: string | null;
  cancelRenewalUrl: string;
  applyRenewalCancellationCouponUrl: string | null;
};

type PortalPayment = {
  id?: string;
  gross?: number;
  currency?: string;
  planTitle: string;
  createdAt: string;
  invoiceUrl: string;
};

type PortalBilling = {
  business_name?: string | null;
  tax_id?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_country_code?: string | null;
  address_zip?: string | null;
  updateUrl: string;
} | null;

type CancellationCoupon = {
  coupon_id: string;
  discount?: number;
  discount_type?: string;
};

type PortalData = {
  subscriptions: {
    primary: PortalSubscription | null;
    active: PortalSubscription[];
    past: PortalSubscription[];
  };
  billing: PortalBilling;
  payments: PortalPayment[] | null;
  cancellationCoupons: CancellationCoupon[] | null;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type CustomerPortalProps = {
  /** Backend portal endpoint (our Hono `/api/portal`). */
  endpoint: string;
  /** Backend license-upgrade checkout endpoint (our Hono `GET /api/checkout/upgrade`). */
  upgradeEndpoint?: string;
  /** Fetch wrapper that attaches auth headers. */
  fetcher?: Fetcher;
};

export function CustomerPortal({
  endpoint,
  upgradeEndpoint = '/api/checkout/upgrade',
  fetcher = fetch,
}: CustomerPortalProps) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelFor, setCancelFor] = useState<PortalSubscription | null>(null);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Upgrade = a server-built LICENSE-UPGRADE checkout (plan change of the
  // existing license). A plain subscribe checkout here would create a SECOND
  // subscription — so the backend resolves the user's fsLicenseId and calls
  // freemius.checkout.create({ licenseId }) → hosted link.
  const startUpgrade = useCallback(async () => {
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      const res = await fetcher(upgradeEndpoint);
      if (!res.ok) throw new Error(String(res.status));
      const { link } = (await res.json()) as { link: string };
      window.location.href = link;
    } catch {
      setUpgradeError('Could not start the upgrade. Please try again.');
      setUpgradeBusy(false);
    }
  }, [fetcher, upgradeEndpoint]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher(`${endpoint}?action=portal_data`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as PortalData | null;
      setData(json);
    } catch {
      setError('Could not load your account. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, fetcher]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p>Loading your account…</p>;
  if (error) return <p className="discount">{error}</p>;
  if (!data) {
    return (
      <div className="card">
        <p>No subscription yet.</p>
      </div>
    );
  }

  const subs = [...data.subscriptions.active, ...data.subscriptions.past];

  return (
    <div className="portal">
      <SubscriptionSection
        subscriptions={subs}
        onUpgrade={startUpgrade}
        upgradeBusy={upgradeBusy}
        upgradeError={upgradeError}
        onCancel={(sub) => setCancelFor(sub)}
      />

      <BillingSection
        billing={data.billing}
        fetcher={fetcher}
        onUpdated={load}
      />

      <PaymentsSection payments={data.payments} fetcher={fetcher} />

      {cancelFor && (
        <CancellationWizard
          subscription={cancelFor}
          coupons={data.cancellationCoupons}
          fetcher={fetcher}
          onClose={() => setCancelFor(null)}
          onDone={() => {
            setCancelFor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// --- Subscription & upgrade ---

function SubscriptionSection({
  subscriptions,
  onUpgrade,
  upgradeBusy,
  upgradeError,
  onCancel,
}: {
  subscriptions: PortalSubscription[];
  onUpgrade: () => void;
  upgradeBusy: boolean;
  upgradeError: string | null;
  onCancel: (sub: PortalSubscription) => void;
}) {
  if (subscriptions.length === 0) {
    return (
      <section className="card">
        <h2>Current subscription</h2>
        <p className="muted">No active subscription.</p>
      </section>
    );
  }

  // A cancelled sub only keeps access "until period end" when no newer active
  // subscription supersedes it (isActive === !cancelled in the SDK, so any active
  // entry means the cancelled one was replaced by a re-subscribe).
  const hasActiveSub = subscriptions.some((s) => s.isActive);

  // When several cancelled subs are still inside their paid period and there is
  // no active sub, only the NEWEST one (highest numeric subscriptionId) actually
  // grants access until period end; the older, superseded ones have ended.
  const periodEndWinnerId = !hasActiveSub
    ? subscriptions
        .filter((s) => {
          const periodEnd = s.renewalDate ? new Date(s.renewalDate) : null;
          const stillInPeriod = periodEnd
            ? periodEnd.getTime() > Date.now()
            : false;
          return Boolean(s.cancelledAt) && stillInPeriod;
        })
        .reduce<string | null>(
          (winner, s) =>
            winner === null || Number(s.subscriptionId) > Number(winner)
              ? s.subscriptionId
              : winner,
          null
        )
    : null;

  return (
    <section className="card">
      <h2>Current subscription</h2>
      {subscriptions.map((sub) => {
        const canceled = Boolean(sub.cancelledAt);
        const periodEnd = sub.renewalDate ? new Date(sub.renewalDate) : null;
        const stillInPeriod = periodEnd
          ? periodEnd.getTime() > Date.now()
          : false;
        const activeUntilPeriodEnd =
          canceled &&
          stillInPeriod &&
          !hasActiveSub &&
          sub.subscriptionId === periodEndWinnerId;
        return (
          <div key={sub.subscriptionId} className="portal-row">
            <div>
              <p>
                <strong>{sub.planTitle}</strong>{' '}
                <span className="muted">({sub.billingCycle ?? 'one-off'})</span>
              </p>
              <p className="muted">
                {sub.currency?.toUpperCase()} {sub.renewalAmount}
                {sub.renewalDate &&
                  ` · ${
                    activeUntilPeriodEnd
                      ? 'ends'
                      : canceled
                        ? 'ended'
                        : 'renews'
                  } ${new Date(sub.renewalDate).toLocaleDateString()}`}
              </p>
              {canceled && (
                <p className="discount">
                  {activeUntilPeriodEnd
                    ? 'Canceled — active until period end.'
                    : 'Canceled — ended.'}
                </p>
              )}
            </div>
            {!canceled && sub.isActive && (
              <div className="portal-actions">
                {/* Always render for an active sub — never condition on a
                    portal-data field that may not exist (no dead buttons). */}
                <button
                  className="btn"
                  onClick={onUpgrade}
                  disabled={upgradeBusy}
                >
                  {upgradeBusy ? 'Preparing upgrade…' : 'Upgrade / change plan'}
                </button>
                <button className="btn-outline" onClick={() => onCancel(sub)}>
                  Cancel subscription
                </button>
              </div>
            )}
          </div>
        );
      })}
      {upgradeError && <p className="discount">{upgradeError}</p>}
    </section>
  );
}

// --- Cancellation wizard (disclaimer → coupon offer → feedback) ---

const CANCELLATION_REASONS: { id: string; label: string }[] = [
  { id: '2', label: 'Too expensive' },
  { id: '3', label: 'Missing features' },
  { id: '4', label: 'Found a better product' },
  { id: '5', label: 'No longer needed' },
  { id: '1', label: 'Other' },
];

function CancellationWizard({
  subscription,
  coupons,
  fetcher,
  onClose,
  onDone,
}: {
  subscription: PortalSubscription;
  coupons: CancellationCoupon[] | null;
  fetcher: Fetcher;
  onClose: () => void;
  onDone: () => void;
}) {
  const couponOffer =
    subscription.applyRenewalCancellationCouponUrl && coupons?.[0]
      ? coupons[0]
      : null;
  const [step, setStep] = useState<'disclaimer' | 'coupon' | 'feedback'>(
    'disclaimer'
  );
  const [reasonId, setReasonId] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyCoupon = async () => {
    if (!couponOffer || !subscription.applyRenewalCancellationCouponUrl) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetcher(
        subscription.applyRenewalCancellationCouponUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ couponId: couponOffer.coupon_id }),
        }
      );
      if (!res.ok) throw new Error();
      onDone();
    } catch {
      setError('Could not apply the discount. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetcher(subscription.cancelRenewalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: feedback || undefined,
          reason_ids: reasonId ? [reasonId] : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      onDone();
    } catch {
      setError('Could not cancel the subscription. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-panel">
        <div className="overlay-head">
          <h2>Cancel subscription</h2>
          <button className="btn-outline" onClick={onClose}>
            Keep plan
          </button>
        </div>

        {step === 'disclaimer' && (
          <>
            <p>
              Your subscription will remain active until the end of the current
              billing period, then it will not renew.
            </p>
            <div className="portal-actions">
              <button
                className="btn"
                onClick={() => setStep(couponOffer ? 'coupon' : 'feedback')}
              >
                Continue
              </button>
              <button className="btn-outline" onClick={onClose}>
                Keep my plan
              </button>
            </div>
          </>
        )}

        {step === 'coupon' && couponOffer && (
          <>
            <p>
              Stay with us and get{' '}
              <strong>
                {couponOffer.discount}
                {couponOffer.discount_type === 'percentage' ? '%' : ''} off
              </strong>{' '}
              your next renewals.
            </p>
            <div className="portal-actions">
              <button className="btn" onClick={applyCoupon} disabled={busy}>
                {busy ? 'Applying…' : 'Apply discount & stay'}
              </button>
              <button
                className="btn-outline"
                onClick={() => setStep('feedback')}
                disabled={busy}
              >
                No thanks, continue
              </button>
            </div>
            {error && <p className="discount">{error}</p>}
          </>
        )}

        {step === 'feedback' && (
          <>
            <p className="muted">Why are you leaving? (optional)</p>
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
            >
              <option value="">Select a reason…</option>
              {CANCELLATION_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <textarea
              placeholder="Anything else? (optional)"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="portal-actions">
              <button className="btn" onClick={confirmCancel} disabled={busy}>
                {busy ? 'Canceling…' : 'Confirm cancellation'}
              </button>
              <button className="btn-outline" onClick={onClose} disabled={busy}>
                Keep my plan
              </button>
            </div>
            {error && <p className="discount">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// --- Billing information ---

function BillingSection({
  billing,
  fetcher,
  onUpdated,
}: {
  billing: PortalBilling;
  fetcher: Fetcher;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    business_name: billing?.business_name ?? '',
    tax_id: billing?.tax_id ?? '',
    address_street: billing?.address_street ?? '',
    address_city: billing?.address_city ?? '',
    address_country_code: billing?.address_country_code ?? '',
    address_zip: billing?.address_zip ?? '',
  });

  if (!billing) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetcher(billing.updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setEditing(false);
      onUpdated();
    } catch {
      setError('Could not update billing information.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="overlay-head">
        <h2>Billing information</h2>
        {!editing && (
          <button className="btn-outline" onClick={() => setEditing(true)}>
            Update
          </button>
        )}
      </div>

      {!editing ? (
        <p className="muted">
          {billing.business_name || '—'}
          {billing.address_city ? ` · ${billing.address_city}` : ''}
          {billing.address_country_code
            ? `, ${billing.address_country_code}`
            : ''}
        </p>
      ) : (
        <div className="billing-form">
          {(
            [
              ['business_name', 'Business name'],
              ['tax_id', 'Tax ID'],
              ['address_street', 'Street'],
              ['address_city', 'City'],
              ['address_country_code', 'Country code'],
              ['address_zip', 'ZIP / postal code'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span className="muted">{label}</span>
              <input
                type="text"
                value={form[key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
              />
            </label>
          ))}
          <div className="portal-actions">
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn-outline"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
          {error && <p className="discount">{error}</p>}
        </div>
      )}
    </section>
  );
}

// --- Payments & invoices ---

function PaymentsSection({
  payments,
  fetcher,
}: {
  payments: PortalPayment[] | null;
  fetcher: Fetcher;
}) {
  const downloadInvoice = async (payment: PortalPayment) => {
    const res = await fetcher(payment.invoiceUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (!payments || payments.length === 0) {
    return (
      <section className="card">
        <h2>Payments &amp; invoices</h2>
        <p className="muted">No payments yet.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Payments &amp; invoices</h2>
      <table className="payments">
        <thead>
          <tr>
            <th>Date</th>
            <th>Plan</th>
            <th>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => (
            <tr key={p.id ?? i}>
              <td>{new Date(p.createdAt).toLocaleDateString()}</td>
              <td>{p.planTitle}</td>
              <td>
                {p.currency?.toUpperCase()} {p.gross ?? 0}
              </td>
              <td>
                <button
                  className="btn-outline"
                  onClick={() => downloadInvoice(p)}
                >
                  Invoice
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
