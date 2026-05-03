import { NavLink, useParams } from 'react-router-dom';
import { STORE_NAMES, STORE_CATEGORY } from '@shared/store-types.js';
import type { StoreName, StoreCategory } from '@shared/store-types.js';

const CATEGORY_ORDER: StoreCategory[] = ['memory', 'activity', 'system'];
const LABEL: Record<StoreCategory, string> = {
  memory: 'Memory', activity: 'Activity', system: 'System',
};

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block py-1.5 px-2 rounded text-sm transition ${
    isActive
      ? 'bg-accent-soft text-accent'
      : 'text-text-muted hover:text-text hover:bg-surface-2'
  }`;

export function Sidebar() {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return (
    <aside className="w-56 bg-surface border-r border-border p-4 text-sm text-text-muted">
      Pick a user.
    </aside>
  );

  const grouped: Record<StoreCategory, StoreName[]> = { memory: [], activity: [], system: [] };
  for (const n of STORE_NAMES) grouped[STORE_CATEGORY[n]].push(n);

  return (
    <aside className="w-56 bg-surface border-r border-border p-4">
      <div className="mb-4 px-2 text-xs uppercase tracking-wider text-text-dim">Dashboard</div>
      <NavLink to={`/u/${uid}`} end className={linkClass}>Overview</NavLink>
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="mt-5">
          <div className="text-xs uppercase tracking-wider font-semibold text-text-dim px-2 mb-1.5">
            {LABEL[cat]}
          </div>
          {grouped[cat].map((name) => (
            <NavLink key={name} to={`/u/${uid}/store/${name}`} className={linkClass}>
              {name}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="mt-5">
        <div className="text-xs uppercase tracking-wider font-semibold text-text-dim px-2 mb-1.5">
          Configuration
        </div>
        <NavLink to={`/u/${uid}/skills/active`} className={linkClass}>skills (active)</NavLink>
        <NavLink to={`/u/${uid}/skills/archived`} className={linkClass}>skills (archived)</NavLink>
      </div>
    </aside>
  );
}
