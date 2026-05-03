export function Pagination({
  page, limit, total, onChange,
}: {
  page: number; limit: number; total: number;
  onChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const btn = 'border border-border hover:border-border-strong text-text-muted hover:text-text px-3 py-1 rounded text-sm disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-muted transition';
  return (
    <div className="flex items-center justify-between mt-3 text-sm text-text-muted">
      <div>Page {page} of {totalPages} — <span className="text-text">{total.toLocaleString()}</span> rows</div>
      <div className="space-x-2">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} className={btn}>Prev</button>
        <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className={btn}>Next</button>
      </div>
    </div>
  );
}
