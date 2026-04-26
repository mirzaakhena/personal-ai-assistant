// web/dashboard/src/routes/store/store-views/MessagesView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { GenericStoreView } from '../$store.js';
import { fmtTimestamp } from '../../../lib/format.js';

export function MessagesView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [q, setQ] = useState('');
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  if (!q.trim() && !openSession) {
    return (
      <div>
        <SearchBox value={q} onChange={(v) => setQ(v)} />
        <GenericStoreView uid={uid} storeName="messages" cfg={cfg} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">messages</h1>
        <RefreshButton queryKey={['messagesSearch', uid, q]} />
      </div>
      <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); setOpenSession(null); }} />

      {openSession && <ThreadView uid={uid} sessionId={openSession} onClose={() => setOpenSession(null)} />}

      {!openSession && q && (
        <SearchResults uid={uid} q={q} page={page} setPage={setPage} setOpenSession={setOpenSession} />
      )}

      {!openSession && !q && cfg.charts.length > 0 && (
        <ChartsRow uid={uid} cfg={cfg} />
      )}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder="Search messages body (FTS5; clear to browse)"
      className="border rounded px-3 py-2 w-96 mb-4"
    />
  );
}

function SearchResults({ uid, q, page, setPage, setOpenSession }: {
  uid: string; q: string; page: number;
  setPage: (n: number) => void;
  setOpenSession: (s: string | null) => void;
}) {
  const params = new URLSearchParams({ q, page: String(page), limit: '50' });
  const r = useQuery({
    queryKey: ['messagesSearch', uid, q, page],
    queryFn: () => api.messagesSearch(uid, params),
  });
  if (r.isError) return <ErrorBanner error={r.error} />;
  if (r.isLoading || !r.data) return <div>Searching…</div>;
  return (
    <>
      <div className="space-y-2">
        {r.data.hits.map((h, i) => (
          <div key={i} className="border rounded p-3 text-sm">
            <div className="text-xs text-slate-500">
              {fmtTimestamp(Number(h.timestamp))} — {String(h.sender)} —{' '}
              <button className="underline" onClick={() => setOpenSession(String(h.session_id))}>
                {String(h.session_id)}
              </button>
            </div>
            <div dangerouslySetInnerHTML={{ __html: String(h.snippet ?? '') }} />
          </div>
        ))}
      </div>
      <Pagination page={r.data.page} limit={r.data.limit} total={r.data.total} onChange={setPage} />
    </>
  );
}

function ThreadView({ uid, sessionId, onClose }: {
  uid: string; sessionId: string; onClose: () => void;
}) {
  const params = new URLSearchParams({ page: '1', limit: '200' });
  const r = useQuery({
    queryKey: ['messagesThread', uid, sessionId],
    queryFn: () => api.messagesThread(uid, sessionId, params),
  });
  return (
    <div className="border rounded p-3">
      <div className="flex justify-between mb-2">
        <div className="font-medium">Thread {sessionId}</div>
        <button className="text-sm underline" onClick={onClose}>← back</button>
      </div>
      {r.isError && <ErrorBanner error={r.error} />}
      {r.isLoading && <div>Loading…</div>}
      {r.data && (
        <div className="space-y-1 text-sm">
          {r.data.rows.slice().reverse().map((m, i) => (
            <div key={i} className="border-b py-2">
              <div className="text-xs text-slate-500">
                {fmtTimestamp(Number(m.timestamp))} — {String(m.sender)}
              </div>
              <div className="whitespace-pre-wrap">{String(m.body ?? '')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartsRow({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const r = useQuery({
    queryKey: ['storeStats', uid, 'messages'],
    queryFn: () => api.storeStats(uid, 'messages'),
  });
  if (!r.data) return null;
  return (
    <div className="grid grid-cols-2 gap-4 my-4">
      {cfg.charts.map((c) => r.data!.charts[c.id] && (
        <ChartCard key={c.id} title={c.label} payload={r.data!.charts[c.id]} />
      ))}
    </div>
  );
}
