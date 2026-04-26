import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.js';
import { clearLoggedIn } from '../lib/auth-storage.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, err) => {
        if (!(err instanceof ApiError)) return failureCount < 1;
        if (err.status === 503) return failureCount < 1;
        return false;
      },
      retryDelay: 1000,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
    mutations: { retry: false },
  },
});

queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    clearLoggedIn();
    if (window.location.pathname !== '/login') window.location.assign('/login');
  }
});
