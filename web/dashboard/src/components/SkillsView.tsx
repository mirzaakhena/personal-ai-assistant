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

  if (detail.isLoading) return <div className="text-text-muted">Loading…</div>;
  if (detail.isError) return <div className="text-danger">
    Skill tidak ditemukan, mungkin baru saja di-archive.
  </div>;
  if (!detail.data) return null;

  const d = detail.data;
  return (
    <article>
      <header className="border-b border-border pb-3 mb-4">
        <h1 className="text-2xl font-mono text-text">{d.name}</h1>
        <p className="text-text-muted mt-1">{d.description}</p>
        <div className="text-xs text-text-dim mt-2 flex gap-3">
          <span>created {new Date(d.created_at).toLocaleString()}</span>
          <span>updated {new Date(d.updated_at).toLocaleString()}</span>
          {d.scope === 'archived' && (
            <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
              archived
            </span>
          )}
        </div>
      </header>
      <div className="prose prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown>
      </div>
    </article>
  );
}

export function SkillsView({ userId, scope, selected, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useDebouncedEffect(() => setDebounced(q), 200, [q]);

  const list = useQuery({
    queryKey: ['skills', userId, scope, debounced],
    queryFn: () => skillsApi.list(userId, scope, debounced || undefined),
  });

  return (
    <div className="flex h-full bg-surface border border-border rounded-lg overflow-hidden">
      <div className="w-[340px] border-r border-border flex flex-col bg-surface">
        <div className="p-2 border-b border-border">
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Cari di name, description, body…"
            className="w-full bg-bg border border-border focus:border-accent rounded px-2 py-1 text-sm transition"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {list.isLoading && <div className="p-3 text-sm text-text-muted">Loading…</div>}
          {list.data && list.data.rows.length === 0 && (
            <div className="p-3 text-sm text-text-muted">
              User ini belum punya skill di scope <code className="text-text">{scope}</code>.
            </div>
          )}
          {list.data?.rows.map((row) => (
            <button
              key={row.name}
              onClick={() => onSelect(row.name)}
              className={`block w-full text-left px-3 py-2 border-b border-border hover:bg-surface-2 transition ${
                selected === row.name ? 'bg-accent-soft border-l-4 border-l-accent' : ''
              }`}
            >
              <div className="font-mono text-sm text-text">{row.name}</div>
              <div className="text-xs text-text-muted truncate">{row.description}</div>
              <div className="text-xs text-text-dim mt-1">
                {formatBytes(row.body_size)} · updated {formatRelative(row.updated_at)}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 bg-bg">
        {!selected
          ? <div className="text-text-muted">Pilih skill untuk preview.</div>
          : <SkillPreview userId={userId} scope={scope} name={selected} />}
      </div>
    </div>
  );
}
