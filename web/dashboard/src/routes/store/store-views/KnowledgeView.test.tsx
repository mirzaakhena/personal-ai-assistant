import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KnowledgeView } from './KnowledgeView.js';
import { api } from '../../../api/stores.js';

vi.mock('../../../api/stores.js', () => ({
  api: {
    knowledgeSearch: vi.fn().mockResolvedValue({ hits: [], page: 1, limit: 50, total: 0 }),
    storeStats:      vi.fn().mockResolvedValue({ charts: {} }),
    storeList:       vi.fn().mockResolvedValue({ rows: [], page: 1, limit: 50, total: 0 }),
  },
}));

const cfg = { name: 'knowledge' as const, table: 'knowledge', primaryKey: ['key'],
  columns: [], filters: [], sortable: [], defaultSort: { key: 'key', dir: 'asc' as const },
  charts: [], fts: true } as any;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('KnowledgeView (regression for #310)', () => {
  it('does not throw when typing into the search box', async () => {
    const { getByPlaceholderText } = render(wrap(<KnowledgeView uid="alice" cfg={cfg} />));
    const input = getByPlaceholderText(/Search knowledge/i) as HTMLInputElement;
    expect(() => fireEvent.change(input, { target: { value: 'h' } })).not.toThrow();
    expect(() => fireEvent.change(input, { target: { value: 'he' } })).not.toThrow();
    expect(() => fireEvent.change(input, { target: { value: 'hello' } })).not.toThrow();
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    await waitFor(() => expect(api.knowledgeSearch).toHaveBeenCalled());
  });
});
