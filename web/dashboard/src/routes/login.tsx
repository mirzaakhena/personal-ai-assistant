import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/stores.js';
import { setLoggedIn } from '../lib/auth-storage.js';
import { ApiError } from '../api/client.js';

export function LoginPage() {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(token);
      setLoggedIn();
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-text">
      <form onSubmit={onSubmit}
        className="bg-surface border border-border p-8 rounded-lg shadow-lg w-96">
        <h1 className="text-xl font-semibold mb-1">PAI Dashboard</h1>
        <p className="text-sm text-text-muted mb-6">Sign in with your dashboard token.</p>
        <label className="block text-xs uppercase tracking-wider text-text-muted mb-1.5">Token</label>
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          className="w-full bg-bg border border-border focus:border-accent rounded px-3 py-2 mb-4 text-sm font-mono transition"
          autoFocus required
        />
        {error && <div className="text-danger text-sm mb-3">{error}</div>}
        <button
          type="submit" disabled={submitting}
          className="w-full bg-accent hover:bg-accent/90 text-bg font-medium py-2 rounded disabled:opacity-50 transition"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
