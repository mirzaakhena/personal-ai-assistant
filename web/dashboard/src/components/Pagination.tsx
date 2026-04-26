// web/dashboard/src/components/Pagination.tsx

export function Pagination({
  page, limit, total, onChange,
}: {
  page: number; limit: number; total: number;
  onChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between mt-3 text-sm">
      <div>Page {page} of {totalPages} — {total.toLocaleString()} rows</div>
      <div className="space-x-2">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)}
                className="border px-3 py-1 rounded disabled:opacity-30">Prev</button>
        <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}
                className="border px-3 py-1 rounded disabled:opacity-30">Next</button>
      </div>
    </div>
  );
}
