// web/dashboard/src/routes/login.tsx

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
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={onSubmit} className="bg-white p-8 rounded shadow w-96">
        <h1 className="text-xl font-semibold mb-4">PAI Dashboard</h1>
        <label className="block text-sm font-medium mb-1">Token</label>
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
          autoFocus required
        />
        {error && (
          <div className="text-red-600 text-sm mb-3">{error}</div>
        )}
        <button
          type="submit" disabled={submitting}
          className="w-full bg-slate-900 text-white py-2 rounded disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
