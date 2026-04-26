// web/dashboard/src/components/UserPicker.tsx

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/stores.js';

export function UserPicker() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['users'], queryFn: api.users });
  if (q.isLoading) return <div className="text-sm">Loading users…</div>;
  if (q.isError)   return <div className="text-sm text-red-600">Failed to load users</div>;
  return (
    <select
      className="border rounded px-2 py-1 text-sm"
      value={uid ?? ''}
      onChange={(e) => nav(`/u/${e.target.value}`)}
    >
      <option value="" disabled>Pick a user…</option>
      {q.data!.users.map((u) => (
        <option key={u.userId} value={u.userId}>{u.userId}</option>
      ))}
    </select>
  );
}
