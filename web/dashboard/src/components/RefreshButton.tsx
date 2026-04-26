// web/dashboard/src/components/RefreshButton.tsx

import { useQueryClient } from '@tanstack/react-query';

export function RefreshButton({ queryKey }: { queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  return (
    <button
      onClick={() => qc.invalidateQueries({ queryKey })}
      className="text-sm border px-3 py-1 rounded hover:bg-slate-50"
    >
      Refresh
    </button>
  );
}
