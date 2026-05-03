import { ApiError } from '../api/client.js';

export function ErrorBanner({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.code === 'DB_BUSY') {
      return <div className="bg-warning/10 text-warning border border-warning/30 p-3 rounded mb-4 text-sm">
        Bot is writing — click Refresh to retry.
      </div>;
    }
    return <div className="bg-danger/10 text-danger border border-danger/30 p-3 rounded mb-4 text-sm">
      <strong>{error.code}</strong>: {error.message}
    </div>;
  }
  return <div className="bg-danger/10 text-danger border border-danger/30 p-3 rounded mb-4 text-sm">
    Unexpected error: {String(error)}
  </div>;
}
