// web/dashboard/src/components/ErrorBanner.tsx

import { ApiError } from '../api/client.js';

export function ErrorBanner({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.code === 'DB_BUSY') {
      return <div className="bg-yellow-100 text-yellow-900 border border-yellow-400 p-3 rounded mb-4">
        Bot is writing — click Refresh to retry.
      </div>;
    }
    return <div className="bg-red-100 text-red-900 border border-red-400 p-3 rounded mb-4">
      <strong>{error.code}</strong>: {error.message}
    </div>;
  }
  return <div className="bg-red-100 text-red-900 border border-red-400 p-3 rounded mb-4">
    Unexpected error: {String(error)}
  </div>;
}
