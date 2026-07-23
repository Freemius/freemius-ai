import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { EntitlementDTO } from '@shared/types';
import {
  getEntitlement,
  getUserEmail,
  setUserEmail,
  clearUserEmail,
} from './api';
import { HomePage } from './pages/HomePage';
import { PricingPage } from './pages/PricingPage';
import { OcrPage } from './pages/OcrPage';
import { AccountPage } from './pages/AccountPage';
import { CheckoutResultPage } from './pages/CheckoutResultPage';
import { DocVaultCheckoutProvider } from './components/DocVaultCheckoutProvider';
import { Logo } from './components/Logo';

export function App() {
  const [email, setEmail] = useState<string | null>(getUserEmail());
  const [entitlement, setEntitlement] = useState<EntitlementDTO>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const navigate = useNavigate();

  const refreshEntitlement = () => {
    if (!getUserEmail()) {
      setEntitlement(null);
      setCreditBalance(null);
      return;
    }
    getEntitlement()
      .then((r) => {
        setEntitlement(r.entitlement);
        setCreditBalance(r.creditBalance);
      })
      .catch(() => {
        setEntitlement(null);
        setCreditBalance(null);
      });
  };

  useEffect(refreshEntitlement, [email]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 6000);
  };

  // C2: after an overlay purchase synced (checkout-provider → POST /api/purchase),
  // refresh local state and surface a visible in-app success message. With
  // show_confirmation_dialog: false the app owns the confirmation UX. The kind
  // of purchase is derived by diffing state: new active subscription →
  // "Premium unlocked"; balance increase → "N credits added".
  const handlePurchase = async () => {
    const wasPremium = Boolean(entitlement) && !entitlement?.isCanceled;
    const prevBalance = creditBalance ?? 0;
    try {
      const r = await getEntitlement();
      setEntitlement(r.entitlement);
      setCreditBalance(r.creditBalance);

      const nowPremium = Boolean(r.entitlement) && !r.entitlement?.isCanceled;
      const added = (r.creditBalance ?? 0) - prevBalance;
      if (added > 0) {
        showToast(`Purchase complete — ${added} credits added.`);
      } else if (!wasPremium && nowPremium) {
        showToast('Purchase complete — Premium unlocked.');
      } else {
        showToast('Purchase complete.');
      }
    } catch {
      showToast('Purchase complete.');
    }
  };

  const handleSignIn = (e: string) => {
    setUserEmail(e);
    setEmail(e);
    navigate('/');
  };

  const handleSignOut = () => {
    clearUserEmail();
    setEmail(null);
    setEntitlement(null);
    navigate('/');
  };

  const isPremium = Boolean(entitlement) && !entitlement?.isCanceled;

  return (
    <>
      <nav className="nav">
        <Link to="/" className="brand">
          <Logo size={26} />
          <span className="brand-name">DocVault</span>
        </Link>
        <div className="nav-links">
          {email ? (
            <>
              <span
                className={`badge ${isPremium ? 'badge-premium' : 'badge-free'}`}
              >
                {isPremium ? 'Premium' : 'Free'}
              </span>
              {creditBalance !== null && (
                <span className="badge badge-credits">
                  Credits: {creditBalance}
                </span>
              )}
              <Link to="/ocr">OCR</Link>
              <Link to="/pricing">Pricing</Link>
              <Link to="/account">Account</Link>
              <span className="muted">{email}</span>
              <button className="btn-outline" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <Link to="/">Sign in</Link>
          )}
        </div>
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              email={email}
              onSignIn={handleSignIn}
              isPremium={isPremium}
            />
          }
        />
        <Route
          path="/pricing"
          element={
            <DocVaultCheckoutProvider onPurchase={handlePurchase}>
              <PricingPage entitlement={entitlement} />
            </DocVaultCheckoutProvider>
          }
        />
        <Route
          path="/ocr"
          element={
            <DocVaultCheckoutProvider onPurchase={handlePurchase}>
              <OcrPage
                isPremium={isPremium}
                creditBalance={creditBalance}
                onOcrComplete={refreshEntitlement}
              />
            </DocVaultCheckoutProvider>
          }
        />
        <Route
          path="/account"
          element={
            <DocVaultCheckoutProvider onPurchase={handlePurchase}>
              <AccountPage
                entitlement={entitlement}
                onChange={refreshEntitlement}
              />
            </DocVaultCheckoutProvider>
          }
        />
        <Route
          path="/checkout-result"
          element={<CheckoutResultPage onDone={refreshEntitlement} />}
        />
      </Routes>
    </>
  );
}
