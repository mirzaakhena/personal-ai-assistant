// web/dashboard/src/routes/root-layout.tsx

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
    <div className="min-h-screen flex bg-white">
      <Sidebar />
      <main className="flex-1 p-6">
        <header className="flex items-center justify-between mb-6">
          <UserPicker />
          <button onClick={onLogout} className="text-sm border px-3 py-1 rounded">
            Log out
          </button>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
