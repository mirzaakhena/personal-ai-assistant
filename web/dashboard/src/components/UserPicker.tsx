import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/stores.js';

export function UserPicker() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['users'], queryFn: api.users });
  if (q.isLoading) return <div className="text-sm text-text-muted">Loading users…</div>;
  if (q.isError)   return <div className="text-sm text-danger">Failed to load users</div>;
  return (
    <select
      className="bg-surface border border-border hover:border-border-strong rounded px-3 py-1.5 text-sm text-text focus:border-accent transition"
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
