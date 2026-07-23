import { useCallback, useState } from 'react';
import { Subscribe } from './subscribe';
import { Topup } from './topup';

// Ported Starter Kit <Paywall /> + usePaywall(). The feature UI is never blocked;
// when the user hits a gated action the paywall overlay is shown with the right
// pricing table: subscriptions for "no active purchase", top-ups for
// "insufficient credits".

export type PaywallState =
  | { kind: 'hidden' }
  | { kind: 'no_active_purchase' }
  | { kind: 'insufficient_credits' };

export function usePaywall() {
  const [state, setState] = useState<PaywallState>({ kind: 'hidden' });

  const showNoActivePurchase = useCallback(
    () => setState({ kind: 'no_active_purchase' }),
    []
  );
  const showInsufficientCredits = useCallback(
    () => setState({ kind: 'insufficient_credits' }),
    []
  );
  const hidePaywall = useCallback(() => setState({ kind: 'hidden' }), []);

  return { state, showNoActivePurchase, showInsufficientCredits, hidePaywall };
}

type Props = {
  state: PaywallState;
  hidePaywall: () => void;
};

export function Paywall({ state, hidePaywall }: Props) {
  if (state.kind === 'hidden') return null;

  const isCredits = state.kind === 'insufficient_credits';

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-panel">
        <div className="overlay-head">
          <h2>{isCredits ? 'Top up to continue' : 'Subscribe to continue'}</h2>
          <button className="btn-outline" onClick={hidePaywall}>
            Close
          </button>
        </div>
        <p className="muted">
          {isCredits
            ? 'You are out of credits. Purchase more to keep using this feature.'
            : 'This feature requires an active subscription.'}
        </p>
        {isCredits ? <Topup /> : <Subscribe />}
      </div>
    </div>
  );
}
