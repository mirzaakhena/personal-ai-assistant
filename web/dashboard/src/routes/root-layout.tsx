// web/dashboard/src/routes/root-layout.tsx

import { Outlet, Navigate } from 'react-router-dom';
import { isLoggedIn } from '../lib/auth-storage.js';

export function RootLayout() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen flex">
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
