import { Outlet, Navigate } from 'react-router-dom';
import { isLoggedIn, clearLoggedIn } from '../lib/auth-storage.js';
import { Sidebar } from '../components/Sidebar.js';
import { UserPicker } from '../components/UserPicker.js';
import { api } from '../api/stores.js';

export function RootLayout() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;

  async function onLogout() {
    try { await api.logout(); } catch { /* ignore */ }
    clearLoggedIn();
    window.location.assign('/login');
  }

  return (
    <div className="min-h-screen flex bg-bg text-text">
      <Sidebar />
      <main className="flex-1 px-8 py-6 overflow-x-hidden">
        <header className="flex items-center justify-between mb-8 pb-4 border-b border-border">
          <UserPicker />
          <button onClick={onLogout}
            className="text-sm border border-border hover:border-border-strong text-text-muted hover:text-text px-3 py-1.5 rounded transition">
            Log out
          </button>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
