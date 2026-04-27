// web/dashboard/src/routes/skills/$scope.tsx

import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import { SkillsView } from '../../components/SkillsView.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import type { SkillScope } from '@shared/skills-types.js';

export function SkillsRoute() {
  const { uid, scope } = useParams<{ uid: string; scope: string }>();
  const [params, setParams] = useSearchParams();

  if (!uid) return <Navigate to="/" replace />;
  if (scope !== 'active' && scope !== 'archived') {
    return <Navigate to={`/u/${uid}/skills/active`} replace />;
  }

  const selected = params.get('selected');
  const onSelect = (name: string | null) => {
    if (name) params.set('selected', name); else params.delete('selected');
    setParams(params, { replace: true });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h1 className="text-lg font-semibold">
          Skills — {uid} <span className="text-slate-400">({scope})</span>
        </h1>
        <RefreshButton queryKey={['skills', uid, scope as SkillScope]} />
      </div>
      <div className="flex-1 overflow-hidden">
        <SkillsView
          userId={uid} scope={scope as SkillScope}
          selected={selected} onSelect={onSelect}
        />
      </div>
    </div>
  );
}
