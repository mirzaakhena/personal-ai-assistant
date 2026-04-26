// web/dashboard/src/routes/overview.tsx

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/stores.js';
import { RefreshButton } from '../components/RefreshButton.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

export function Overview() {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return <div>Pick a user from the dropdown above.</div>;

  const queryKey = ['storeSummary', uid] as const;
  const q = useQuery({ queryKey, queryFn: () => api.storeSummary(uid) });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Overview — {uid}</h1>
        <RefreshButton queryKey={queryKey} />
      </div>
      {q.isLoading && <div>Loading…</div>}
      {q.isError && <ErrorBanner error={q.error} />}
      {q.data && (
        <div className="grid grid-cols-3 gap-4">
          {q.data.stores.map((s) => (
            <Link key={s.name} to={`/u/${uid}/store/${s.name}`}
                  className="block bg-slate-50 rounded p-4 border hover:border-slate-400">
              <div className="text-xs uppercase text-slate-500">{s.category}</div>
              <div className="text-lg font-medium">{s.name}</div>
              <div className="text-3xl mt-2">{s.count.toLocaleString()}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
