// web/dashboard/src/routes/overview.tsx

import { useParams } from 'react-router-dom';

export function Overview() {
  const { uid } = useParams<{ uid: string }>();
  return <div>Overview for <strong>{uid ?? '(no user)'}</strong> — TBD in Task 4.1</div>;
}
