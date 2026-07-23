import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

type Props = {
  email: string | null;
  isPremium: boolean;
  onSignIn: (email: string) => void;
};

export function HomePage({ email, isPremium, onSignIn }: Props) {
  const [input, setInput] = useState('');

  if (!email) {
    return (
      <main className="container">
        <div className="hero">
          <span className="hero-badge">
            <Logo size={16} /> Powered by Mistral OCR
          </span>
          <h1>Turn any PDF into clean text</h1>
          <p>
            DocVault extracts crisp, structured Markdown from your documents in
            one OCR call. Sign in with your email to get started.
          </p>
        </div>
        <div className="card">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) onSignIn(input.trim());
            }}
          >
            <label
              className="muted"
              style={{ display: 'block', marginBottom: '0.4rem' }}
            >
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
            />
            <p />
            <button type="submit">Continue →</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="hero">
        <span className="hero-badge">
          {isPremium ? 'Premium — unlocked' : 'Free tier'}
        </span>
        <h1>Welcome back</h1>
        <p>
          {isPremium
            ? 'Your subscription is active. PDF → text OCR is unlocked and ready.'
            : 'Subscribe to unlock unlimited PDF → text OCR powered by Mistral.'}
        </p>
      </div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as {email}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link className="btn" to="/ocr">
            Open OCR
          </Link>
          {!isPremium && (
            <Link className="btn-outline" to="/pricing">
              See pricing
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
