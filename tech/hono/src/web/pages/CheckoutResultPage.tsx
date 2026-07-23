import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

type Props = { onDone: () => void };

export function CheckoutResultPage({ onDone }: Props) {
  const [params] = useSearchParams();
  const success = params.get('success') === 'true';

  useEffect(() => {
    // The backend redirect handler already synced the entitlement; refresh local state.
    onDone();
  }, [onDone]);

  return (
    <main className="container">
      <div className="card">
        <h1>{success ? 'Purchase complete' : 'Checkout failed'}</h1>
        <p className="muted">
          {success
            ? 'Your purchase is active — subscription access or credits have been added to your account. The OCR feature is now unlocked.'
            : 'Something went wrong with your checkout. Please try again.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link className="btn" to="/ocr">
            Go to OCR
          </Link>
          <Link className="btn-outline" to="/account">
            Account
          </Link>
        </div>
      </div>
    </main>
  );
}
