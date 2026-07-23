import { Link } from 'react-router-dom';
import type { EntitlementDTO } from '@shared/types';
import { CustomerPortal } from '../react-starter/components/customer-portal';
import { PORTAL_ENDPOINT, portalFetch } from '../api';

type Props = {
  entitlement: EntitlementDTO;
  onChange: () => void;
};

export function AccountPage({ entitlement }: Props) {
  if (!entitlement) {
    return (
      <main className="container">
        <h1>Account</h1>
        <div className="card">
          <p>You don't have an active subscription.</p>
          <Link className="btn" to="/pricing">
            See pricing
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Account</h1>
      <p className="muted">
        Manage your subscription here — switch billing cycle (e.g. monthly to
        yearly), change plan, update billing details and invoices, or cancel.
        Cancellation offers a retention discount before it completes.
      </p>
      <CustomerPortal endpoint={PORTAL_ENDPOINT} fetcher={portalFetch} />
    </main>
  );
}
