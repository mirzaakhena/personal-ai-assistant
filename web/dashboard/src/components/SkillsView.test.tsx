// web/dashboard/src/components/SkillsView.test.tsx

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SkillsView } from './SkillsView.js';

vi.mock('../api/skills.js', () => ({
  skillsApi: {
    list: vi.fn().mockResolvedValue({
      scope: 'active',
      total: 1,
      rows: [{
        name: 'foo-skill', description: 'foo desc', body_size: 100,
        created_at: '2026-04-25T00:00:00.000Z',
        updated_at: '2026-04-26T00:00:00.000Z',
        scope: 'active',
      }],
    }),
    detail: vi.fn(),
  },
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SkillsView', () => {
  it('renders list rows from the API', async () => {
    wrap(<SkillsView userId="alice" scope="active" selected={null} onSelect={() => {}} />);
    expect(await screen.findByText('foo-skill')).toBeInTheDocument();
    expect(screen.getByText('foo desc')).toBeInTheDocument();
  });

  it('shows empty state when list is empty', async () => {
    const { skillsApi } = await import('../api/skills.js');
    (skillsApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scope: 'active', total: 0, rows: [],
    });
    wrap(<SkillsView userId="alice" scope="active" selected={null} onSelect={() => {}} />);
    expect(await screen.findByText(/belum punya skill/i)).toBeInTheDocument();
  });
});
