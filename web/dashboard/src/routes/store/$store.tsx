// web/dashboard/src/routes/store/$store.tsx

import { useParams } from 'react-router-dom';

export function StoreRoute() {
  const { uid, store } = useParams<{ uid: string; store: string }>();
  return (
    <div>
      Store <strong>{store}</strong> for <strong>{uid}</strong> — TBD in Task 6.1
    </div>
  );
}
