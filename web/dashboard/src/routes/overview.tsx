import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/stores.js';
import { skillsApi } from '../api/skills.js';
import { RefreshButton } from '../components/RefreshButton.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

export function Overview() {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return <div className="text-text-muted">Pick a user from the dropdown above.</div>;

  const queryKey = ['storeSummary', uid] as const;
  const q = useQuery({ queryKey, queryFn: () => api.storeSummary(uid) });

  const skillsCount = useQuery({
    queryKey: ['skills', uid, '_count'],
    queryFn: () => skillsApi.count(uid),
  });

  const cardClass = 'block bg-surface border border-border hover:border-accent rounded-lg p-5 transition';
  const labelClass = 'text-xs uppercase tracking-wider text-text-muted';
  const nameClass  = 'text-sm font-medium text-text mt-1';
  const numberClass = 'text-3xl font-semibold text-text mt-3 tabular-nums';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Overview <span className="text-text-muted font-normal">— {uid}</span></h1>
        <RefreshButton queryKey={queryKey} />
      </div>
      {q.isLoading && <div className="text-text-muted">Loading…</div>}
      {q.isError && <ErrorBanner error={q.error} />}
      <div className="grid grid-cols-3 gap-4">
        {q.data && q.data.stores.map((s) => (
          <Link key={s.name} to={`/u/${uid}/store/${s.name}`} className={cardClass}>
            <div className={labelClass}>{s.category}</div>
            <div className={nameClass}>{s.name}</div>
            <div className={numberClass}>{s.count.toLocaleString()}</div>
          </Link>
        ))}
        <Link to={`/u/${uid}/skills/active`} className={cardClass}>
          <div className={labelClass}>configuration</div>
          <div className={nameClass}>skills</div>
          <div className={numberClass}>
            {skillsCount.data
              ? `${skillsCount.data.active} · ${skillsCount.data.archived}`
              : '…'}
          </div>
          <div className="text-xs text-text-dim mt-1">active · archived</div>
        </Link>
      </div>
    </div>
  );
}
