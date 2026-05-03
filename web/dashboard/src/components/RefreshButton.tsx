import { useQueryClient } from '@tanstack/react-query';

export function RefreshButton({ queryKey }: { queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  return (
    <button
      onClick={() => qc.invalidateQueries({ queryKey })}
      className="text-sm border border-border hover:border-border-strong text-text-muted hover:text-text px-3 py-1.5 rounded transition"
    >
      Refresh
    </button>
  );
}
