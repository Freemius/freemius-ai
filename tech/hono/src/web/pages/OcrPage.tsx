import { useState } from 'react';
import { Link } from 'react-router-dom';
import { runOcr, ApiError } from '../api';
import { Paywall, usePaywall } from '../react-starter/components/paywall';

type Props = {
  isPremium: boolean;
  /** Credit balance, or null when the user never had credits granted. */
  creditBalance: number | null;
  /** Refresh app-level entitlement/credit state after a successful run. */
  onOcrComplete: () => void;
};

// Read a File as a base64 data URL ("data:application/pdf;base64,...").
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function OcrPage({ isPremium, creditBalance, onOcrComplete }: Props) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const paywall = usePaywall();

  const hasCredits = creditBalance !== null && creditBalance > 0;

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setText(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const kind = file.type.startsWith('image/') ? 'image' : 'document';
      const result = await runOcr(file.name, dataUrl, kind);
      setText(result.text);
      setFilename(result.filename);
      setCreditsUsed(result.creditsUsed);
      // Refresh the app-level credit badge after a metered run.
      onOcrComplete();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        // Server enforced the paywall (the authoritative gate is the 402 itself).
        // The body distinguishes the failure modes so we show the right table:
        // insufficient_credits → Topup, no_subscription → Subscribe.
        if (e.message === 'insufficient_credits') {
          paywall.showInsufficientCredits();
        } else {
          paywall.showNoActivePurchase();
        }
      } else if (e instanceof ApiError && e.message === 'image_requires_pro') {
        // Plan-tier gate: Premium is PDF-only — image OCR needs Pro/Lifetime.
        setError('image_requires_pro');
      } else if (e instanceof ApiError && e.status === 401) {
        setError('Please sign in first.');
      } else {
        setError('OCR failed. Please try another file.');
      }
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!text) return;
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename.replace(/\.[^.]+$/, '')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="container">
      <div className="ocr-head">
        <h1>PDF → text OCR</h1>
        {creditBalance !== null && !isPremium && (
          <span className="badge badge-credits">Credits: {creditBalance}</span>
        )}
      </div>

      {!isPremium && !hasCredits && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p>
            This feature requires an active subscription or OCR credits (1
            credit per page). The server enforces the paywall (HTTP 402) even if
            the UI is bypassed.
          </p>
          <Link className="btn" to="/pricing">
            See pricing
          </Link>
        </div>
      )}

      <div className="card">
        <input
          type="file"
          accept="application/pdf,image/*"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {busy && <p className="muted">Running mistral-ocr-latest…</p>}
        {error === 'image_requires_pro' ? (
          <p className="discount">
            Image OCR is a Pro feature — your Premium plan covers PDFs only.{' '}
            <Link to="/account">Upgrade in Account →</Link>
          </p>
        ) : (
          error && <p className="discount">{error}</p>
        )}
      </div>

      <Paywall state={paywall.state} hidePaywall={paywall.hidePaywall} />

      {text && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2>{filename}</h2>
            <button onClick={download}>Download .md</button>
          </div>
          {creditsUsed > 0 && (
            <p className="muted">
              {creditsUsed} credit{creditsUsed === 1 ? '' : 's'} used
              {creditBalance !== null ? ` — ${creditBalance} remaining` : ''}.
            </p>
          )}
          <pre className="result">{text}</pre>
        </div>
      )}
    </main>
  );
}
