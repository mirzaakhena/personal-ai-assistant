// web/dashboard/src/components/Sidebar.tsx

import { NavLink, useParams } from 'react-router-dom';
import { STORE_NAMES, STORE_CATEGORY } from '@shared/store-types.js';
import type { StoreName, StoreCategory } from '@shared/store-types.js';

const CATEGORY_ORDER: StoreCategory[] = ['memory', 'activity', 'system'];
const LABEL: Record<StoreCategory, string> = {
  memory: 'Memory', activity: 'Activity', system: 'System',
};

export function Sidebar() {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return <aside className="w-56 bg-slate-100 p-4">Pick a user.</aside>;

  const grouped: Record<StoreCategory, StoreName[]> = { memory: [], activity: [], system: [] };
  for (const n of STORE_NAMES) grouped[STORE_CATEGORY[n]].push(n);

  return (
    <aside className="w-56 bg-slate-100 p-4 text-sm">
      <NavLink to={`/u/${uid}`} end className={({ isActive }) =>
        `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`
      }>
        Overview
      </NavLink>
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="mt-4">
          <div className="text-xs uppercase font-semibold text-slate-500 mb-1">
            {LABEL[cat]}
          </div>
          {grouped[cat].map((name) => (
            <NavLink
              key={name} to={`/u/${uid}/store/${name}`}
              className={({ isActive }) =>
                `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`
              }
            >
              {name}
            </NavLink>
          ))}
        </div>
      ))}
        <div className="mt-4">
          <div className="text-xs uppercase font-semibold text-slate-500 mb-1">
            Configuration
          </div>
          <NavLink to={`/u/${uid}/skills/active`}
            className={({ isActive }) =>
              `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`}>
            skills (active)
          </NavLink>
          <NavLink to={`/u/${uid}/skills/archived`}
            className={({ isActive }) =>
              `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`}>
            skills (archived)
          </NavLink>
        </div>
    </aside>
  );
}
