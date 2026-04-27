// web/dashboard/src/components/SkillsView.tsx

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { skillsApi } from '../api/skills.js';
import type { SkillScope } from '@shared/skills-types.js';

type Props = {
  userId: string;
  scope: SkillScope;
  selected: string | null;
  onSelect: (name: string | null) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < day) return 'today';
  const days = Math.floor(ms / day);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function useDebouncedEffect(fn: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function SkillPreview({ userId, scope, name }: {
  userId: string; scope: SkillScope; name: string;
}) {
  const detail = useQuery({
    queryKey: ['skill', userId, scope, name],
    queryFn: () => skillsApi.detail(userId, scope, name),
  });

  if (detail.isLoading) return <div>Loading…</div>;
  if (detail.isError) return <div className="text-red-600">
    Skill tidak ditemukan, mungkin baru saja di-archive.
  </div>;
  if (!detail.data) return null;

  const d = detail.data;
  return (
    <article>
      <header className="border-b pb-3 mb-4">
        <h1 className="text-2xl font-mono">{d.name}</h1>
        <p className="text-slate-600 mt-1">{d.description}</p>
        <div className="text-xs text-slate-400 mt-2 flex gap-3">
          <span>created {new Date(d.created_at).toLocaleString()}</span>
          <span>updated {new Date(d.updated_at).toLocaleString()}</span>
          {d.scope === 'archived' && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              archived
            </span>
          )}
        </div>
      </header>
      <div className="prose prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown>
      </div>
    </article>
  );
}

export function SkillsView({ userId, scope, selected, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounce search input by 200ms.
  useDebouncedEffect(() => setDebounced(q), 200, [q]);

  const list = useQuery({
    queryKey: ['skills', userId, scope, debounced],
    queryFn: () => skillsApi.list(userId, scope, debounced || undefined),
  });

  return (
    <div className="flex h-full">
      <div className="w-[340px] border-r flex flex-col">
        <div className="p-2 border-b">
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Cari di name, description, body…"
            className="w-full px-2 py-1 border rounded text-sm"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {list.isLoading && <div className="p-3 text-sm">Loading…</div>}
          {list.data && list.data.rows.length === 0 && (
            <div className="p-3 text-sm text-slate-500">
              User ini belum punya skill di scope <code>{scope}</code>.
            </div>
          )}
          {list.data?.rows.map((row) => (
            <button
              key={row.name}
              onClick={() => onSelect(row.name)}
              className={`block w-full text-left px-3 py-2 border-b hover:bg-slate-50 ${
                selected === row.name ? 'bg-slate-100 border-l-4 border-l-blue-500' : ''
              }`}
            >
              <div className="font-mono text-sm">{row.name}</div>
              <div className="text-xs text-slate-600 truncate">{row.description}</div>
              <div className="text-xs text-slate-400 mt-1">
                {formatBytes(row.body_size)} · updated {formatRelative(row.updated_at)}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!selected
          ? <div className="text-slate-400">Pilih skill untuk preview.</div>
          : <SkillPreview userId={userId} scope={scope} name={selected} />}
      </div>
    </div>
  );
}
