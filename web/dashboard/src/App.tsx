// web/dashboard/src/App.tsx

import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { queryClient } from './api/react-query.js';
import { LoginPage } from './routes/login.js';
import { RootLayout } from './routes/root-layout.js';
import { Overview } from './routes/overview.js';
import { StoreRoute } from './routes/store/$store.js';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RootLayout />,
    children: [
      { path: '/',                            element: <Overview /> },
      { path: '/u/:uid',                      element: <Overview /> },
      { path: '/u/:uid/store/:store',         element: <StoreRoute /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
