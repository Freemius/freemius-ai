import { Link } from 'react-router-dom';
import type { EntitlementDTO } from '@shared/types';
import { Subscribe } from '../react-starter/components/subscribe';
import { Topup } from '../react-starter/components/topup';

type Props = {
  entitlement: EntitlementDTO;
};

// Entitlement-aware pricing page (freemius-checkout Skill, pricing-tables.md →
// "Entitlement-aware rendering"): the buy buttons adapt to what the viewer
// already owns. A lifetime/unlimited holder sees no purchase surfaces at all;
// active subscribers get an upgrade path (license-upgrade checkout) instead of
// plain Subscribe buttons, and the credits pack is hidden (their credits would
// never be consumed under the subscription-wins gate).
export function PricingPage({ entitlement }: Props) {
  const hasActive = Boolean(entitlement) && !entitlement?.isCanceled;
  const isLifetimeHolder = hasActive && entitlement?.type === 'oneoff';

  if (isLifetimeHolder) {
    return (
      <main className="container">
        <h1>Pricing</h1>
        <div className="card">
          <p>
            <strong>You own everything.</strong> Your lifetime license grants
            unlimited access — there is nothing left to buy.
          </p>
          <Link className="btn" to="/account">
            Manage your account
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Pricing</h1>
      <p className="muted">
        Subscribe — <strong>Premium</strong> for unlimited PDF OCR, or{' '}
        <strong>Pro</strong> for unlimited PDF + image OCR · priority
        processing. Prefer a one-off? Go <strong>Lifetime</strong> (unlimited
        everything, forever) or pay as you go with a{' '}
        <strong>credits 100-pack</strong> (1 credit = 1 OCR page, PDF or image;
        top-ups stack). Checkout opens in an overlay (Freemius Checkout); the
        purchase is synced to your account automatically.
      </p>

      <section className="card feature-overview">
        <h2>PDF OCR powered by Mistral</h2>
        <p className="muted">
          The paywalled feature is high-accuracy OCR for scanned and image-only
          PDFs, running on Mistral's OCR model.
        </p>
        <ul>
          <li>Layout-aware — preserves structure, columns and reading order</li>
          <li>
            Multilingual — extracts text across many languages and scripts
          </li>
          <li>Accurate on scans, photos and low-quality documents</li>
          <li>Fast turnaround on multi-page files</li>
        </ul>
      </section>

      <Subscribe entitlement={entitlement} />
      <Topup entitlement={entitlement} />
    </main>
  );
}
