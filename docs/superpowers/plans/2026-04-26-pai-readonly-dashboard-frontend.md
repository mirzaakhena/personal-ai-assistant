# PAI Read-Only Dashboard — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React SPA that consumes the read-only dashboard backend (`docs/superpowers/plans/2026-04-26-pai-readonly-dashboard-backend.md`) — multi-user picker, sidebar nav across 11 stores, generic config-driven table + filters + pagination, per-store custom views (FTS for knowledge/messages, JSON drawer for ledger, status pills for tasks), and per-store charts. Cookie-based auth; manual refresh model.

**Architecture:** Vite-built React SPA at `web/dashboard/`. TanStack Query for server state (no Redux/Zustand). React Router data router for navigation. Tailwind for styling. recharts for charts. Production build emits to `dist/dashboard/` and is served by the Express app from Task 5.1 of the backend plan via `express.static`.

**Tech Stack:** React 18, TypeScript, Vite 5, Tailwind 3, TanStack Query 5, React Router 6 (data router), recharts 2, Vitest + React Testing Library (minimal).

**Spec:** `docs/superpowers/specs/2026-04-26-pai-readonly-dashboard-design.md`
**Backend plan (prerequisite):** `docs/superpowers/plans/2026-04-26-pai-readonly-dashboard-backend.md`

---

## Prerequisites

Backend plan must be implemented at least through Task 5.1 (`createDashboardServer` returning a working Express app with `/api/auth`, `/api/meta`, `/api/users`, etc.). Frontend tasks below assume:

- Bot can be started with `DASHBOARD_TOKEN=t1 pnpm dev` and dashboard responds on `:3200`.
- All `/api/*` routes documented in the backend plan return their stated response shapes.

---

## File Structure

```
web/dashboard/
├── package.json                 # separate workspace, own deps
├── vite.config.ts               # Vite + React + alias to ../../src/dashboard/shared
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── tsconfig.json                # references shared types
├── src/
│   ├── main.tsx                 # mounts <App/>
│   ├── App.tsx                  # router root
│   ├── api/
│   │   ├── client.ts            # fetch wrapper (credentials: 'include', error normalize)
│   │   ├── stores.ts            # typed API calls per endpoint
│   │   └── react-query.ts       # QueryClient setup
│   ├── routes/
│   │   ├── root-layout.tsx      # sidebar + outlet, requires auth
│   │   ├── login.tsx
│   │   ├── overview.tsx         # / and /u/:uid
│   │   └── store/
│   │       ├── $store.tsx       # /u/:uid/store/:store dispatcher
│   │       └── store-views/
│   │           ├── ProfileView.tsx
│   │           ├── PreferencesView.tsx
│   │           ├── KnowledgeView.tsx
│   │           ├── JournalView.tsx
│   │           ├── TasksView.tsx
│   │           ├── CronjobsView.tsx
│   │           ├── MessagesView.tsx
│   │           ├── ReactionsView.tsx
│   │           ├── SessionsView.tsx
│   │           ├── LedgerView.tsx
│   │           └── QueryCostsView.tsx
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── UserPicker.tsx
│   │   ├── StoreTable.tsx       # generic, config-driven
│   │   ├── FilterBar.tsx        # generic, config-driven
│   │   ├── Pagination.tsx
│   │   ├── RefreshButton.tsx
│   │   ├── ChartCard.tsx
│   │   ├── DonutChart.tsx
│   │   ├── BarChart.tsx
│   │   ├── LineChart.tsx
│   │   ├── ErrorBanner.tsx
│   │   └── JsonDrawer.tsx       # for Ledger, raw_json, etc.
│   ├── lib/
│   │   ├── format.ts            # date/number formatters (Jakarta TZ)
│   │   └── auth-storage.ts      # purely a "logged in?" hint flag (no token)
│   └── styles/
│       └── tailwind.css
└── public/                      # static assets (favicon)

# Modified backend files:
src/dashboard/boot.ts            # add express.static for dist/dashboard
package.json                     # root: add build script that runs both Vite + tsc
```

---

## Conventions

- **Workspace style:** `web/dashboard/` is a sibling pnpm package, not a workspace. Run frontend commands with `cd web/dashboard && pnpm <cmd>`. (If you prefer pnpm workspaces, adapt — the plan stays unchanged.)
- **Dev:** `pnpm dev` in `web/dashboard/` starts Vite at `:5173` proxying `/api` → `:3200` (with cookie forwarding).
- **Build:** `pnpm build` in `web/dashboard/` emits to `dist/dashboard/` (configured in `vite.config.ts`).
- **Auth:** SPA never holds the token. Login form posts it once; the `Set-Cookie` carries it from then on. SPA only knows "am I logged in" via a `localStorage.getItem('logged_in') === '1'` hint that gets set on successful login and cleared on 401.
- **Refresh model:** every data fetch is a `useQuery`. The "Refresh" button calls `queryClient.invalidateQueries(...)` for the current view's keys. No polling, no SSE.
- **TDD:** components with logic (StoreTable, FilterBar, api/client) get Vitest + RTL tests. Pure presentational components (icons, layout shells) skip tests — manual QA in Phase 9 covers rendering.

---

## Phase 0 — Vite + React + Tailwind scaffold

### Task 0.1: Create the workspace skeleton

**Files:**
- Create: `web/dashboard/package.json`
- Create: `web/dashboard/.gitignore`
- Create: `web/dashboard/index.html`
- Create: `web/dashboard/vite.config.ts`
- Create: `web/dashboard/tsconfig.json`
- Create: `web/dashboard/tailwind.config.js`
- Create: `web/dashboard/postcss.config.js`
- Create: `web/dashboard/src/main.tsx`
- Create: `web/dashboard/src/App.tsx`
- Create: `web/dashboard/src/styles/tailwind.css`

- [ ] **Step 1: Initialize and install deps**

```bash
mkdir -p web/dashboard/src/styles
cd web/dashboard
pnpm init
pnpm add react react-dom react-router-dom @tanstack/react-query recharts
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom \
            tailwindcss@^3 postcss autoprefixer \
            vitest @testing-library/react @testing-library/dom jsdom @testing-library/jest-dom
```

- [ ] **Step 2: Write `package.json` scripts**

Replace the generated `package.json` `scripts` block with:

```json
{
  "name": "pai-dashboard",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "type-check": "tsc -b --noEmit"
  }
}
```

(Keep the `dependencies` and `devDependencies` blocks pnpm wrote.)

- [ ] **Step 3: Write `.gitignore`**

```
node_modules
dist
*.local
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "paths": {
      "@shared/*": ["../../src/dashboard/shared/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 5: Write `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../src/dashboard/shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/dashboard'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 6: Write `tailwind.config.js` + `postcss.config.js`**

```javascript
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

```javascript
// postcss.config.js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 7: Write `src/styles/tailwind.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PAI Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Write `src/main.tsx`**

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tailwind.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 10: Write placeholder `src/App.tsx` + `src/test-setup.ts`**

```typescript
// src/App.tsx
export function App() {
  return <div className="p-8 text-2xl">PAI Dashboard — bootstrapping…</div>;
}
```

```typescript
// src/test-setup.ts
import '@testing-library/jest-dom';
```

- [ ] **Step 11: Verify dev server boots**

```bash
pnpm dev
# expected: "Local:  http://localhost:5173/"
# Visit URL in browser. Should show "PAI Dashboard — bootstrapping…"
# Stop with Ctrl+C
```

- [ ] **Step 12: Commit**

```bash
cd ../..
git add web/dashboard/
git commit -m "chore(web-dashboard): scaffold Vite + React + Tailwind workspace"
```

---

## Phase 1 — API client + auth helpers

### Task 1.1: Typed API client

**Files:**
- Create: `web/dashboard/src/api/client.ts`
- Create: `web/dashboard/src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// web/dashboard/src/api/client.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, ApiError } from './client.js';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('apiGet', () => {
  it('returns JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ a: 1 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    expect(await apiGet('/api/x')).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      credentials: 'include',
    }));
  });

  it('throws ApiError shaped from server JSON on 4xx/5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'INVALID_QUERY', message: 'bad' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    await expect(apiGet('/api/x')).rejects.toMatchObject({
      code: 'INVALID_QUERY', status: 400, message: 'bad',
    });
  });

  it('throws ApiError for non-JSON 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(apiGet('/api/x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('apiPost', () => {
  it('sends JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await apiPost('/api/auth', { token: 'x' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: JSON.stringify({ token: 'x' }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web/dashboard
pnpm test src/api/client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/api/client.ts`**

```typescript
// web/dashboard/src/api/client.ts

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) { super(message); this.name = 'ApiError'; }
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.ok) return res.json();
  let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  throw new ApiError(
    body.error?.code ?? 'UNKNOWN',
    res.status,
    body.error?.message ?? `HTTP ${res.status}`,
    body.error?.details,
  );
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  return (await parseResponse(res)) as T;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await parseResponse(res)) as T;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test src/api/client.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add web/dashboard/src/api/
git commit -m "feat(web-dashboard): typed fetch wrapper with ApiError normalization"
```

---

### Task 1.2: Typed endpoint wrappers

**Files:**
- Create: `web/dashboard/src/api/stores.ts`

- [ ] **Step 1: Write `src/api/stores.ts`**

```typescript
// web/dashboard/src/api/stores.ts

import { apiGet, apiPost } from './client.js';
import type {
  AuthLoginResponse, UsersListResponse, StoresResponse,
  ListResponse, SearchResponse, StatsResponse, MetaResponse,
} from '@shared/api-types.js';
import type { StoreName } from '@shared/store-types.js';

export const api = {
  // Auth
  login: (token: string) => apiPost<AuthLoginResponse>('/api/auth', { token }),
  logout: () => apiPost<{ ok: true }>('/api/auth/logout', {}),

  // Meta
  meta: () => apiGet<MetaResponse>('/api/meta'),

  // Users + per-user store summary
  users: () => apiGet<UsersListResponse>('/api/users'),
  storeSummary: (uid: string) => apiGet<StoresResponse>(`/api/users/${uid}/stores`),

  // Generic list
  storeList: (uid: string, store: StoreName, q: URLSearchParams) =>
    apiGet<ListResponse>(`/api/users/${uid}/stores/${store}/list?${q}`),

  // Stats (charts)
  storeStats: (uid: string, store: StoreName, range = '30d') =>
    apiGet<StatsResponse>(`/api/users/${uid}/stores/${store}/stats?range=${range}`),

  // FTS searches
  knowledgeSearch: (uid: string, q: URLSearchParams) =>
    apiGet<SearchResponse>(`/api/users/${uid}/knowledge/search?${q}`),
  messagesSearch: (uid: string, q: URLSearchParams) =>
    apiGet<SearchResponse>(`/api/users/${uid}/messages/search?${q}`),
  messagesThread: (uid: string, sessionId: string, q: URLSearchParams) =>
    apiGet<ListResponse>(`/api/users/${uid}/messages/thread/${sessionId}?${q}`),

  // Ledger aggregate (separate from stats; used for power-user view later)
  ledgerAggregate: (uid: string, range = '30d') =>
    apiGet<{ groupBy: string; range: string; series: Array<{ stream: string; n: number }> }>(
      `/api/users/${uid}/ledger/aggregate?range=${range}`,
    ),
};
```

- [ ] **Step 2: Verify type-check**

```bash
cd web/dashboard
pnpm type-check
```

(If `@shared/*` resolution fails, verify `tsconfig.json` paths mapping and Vite alias.)

- [ ] **Step 3: Commit**

```bash
cd ../..
git add web/dashboard/src/api/stores.ts
git commit -m "feat(web-dashboard): typed API endpoint wrappers"
```

---

### Task 1.3: TanStack Query setup + auth-storage hint

**Files:**
- Create: `web/dashboard/src/api/react-query.ts`
- Create: `web/dashboard/src/lib/auth-storage.ts`

- [ ] **Step 1: Write `src/api/react-query.ts`**

```typescript
// web/dashboard/src/api/react-query.ts

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.js';
import { clearLoggedIn } from '../lib/auth-storage.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, err) => {
        if (!(err instanceof ApiError)) return failureCount < 1;
        if (err.status === 503) return failureCount < 1;
        return false;
      },
      retryDelay: 1000,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
    mutations: { retry: false },
  },
});

queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    clearLoggedIn();
    if (window.location.pathname !== '/login') window.location.assign('/login');
  }
});
```

- [ ] **Step 2: Write `src/lib/auth-storage.ts`**

```typescript
// web/dashboard/src/lib/auth-storage.ts

const KEY = 'logged_in';

export function setLoggedIn(): void {
  localStorage.setItem(KEY, '1');
}

export function clearLoggedIn(): void {
  localStorage.removeItem(KEY);
}

export function isLoggedIn(): boolean {
  return localStorage.getItem(KEY) === '1';
}
```

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/api/react-query.ts web/dashboard/src/lib/auth-storage.ts
git commit -m "feat(web-dashboard): TanStack Query setup + login-hint storage"
```

---

## Phase 2 — Auth flow

### Task 2.1: Login route + auth guard layout

**Files:**
- Create: `web/dashboard/src/routes/login.tsx`
- Create: `web/dashboard/src/routes/root-layout.tsx`
- Modify: `web/dashboard/src/App.tsx`

- [ ] **Step 1: Write `routes/login.tsx`**

```typescript
// web/dashboard/src/routes/login.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/stores.js';
import { setLoggedIn } from '../lib/auth-storage.js';
import { ApiError } from '../api/client.js';

export function LoginPage() {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(token);
      setLoggedIn();
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={onSubmit} className="bg-white p-8 rounded shadow w-96">
        <h1 className="text-xl font-semibold mb-4">PAI Dashboard</h1>
        <label className="block text-sm font-medium mb-1">Token</label>
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
          autoFocus required
        />
        {error && (
          <div className="text-red-600 text-sm mb-3">{error}</div>
        )}
        <button
          type="submit" disabled={submitting}
          className="w-full bg-slate-900 text-white py-2 rounded disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write `routes/root-layout.tsx`** (auth guard + outlet — sidebar wired in Task 3.1)

```typescript
// web/dashboard/src/routes/root-layout.tsx

import { Outlet, Navigate } from 'react-router-dom';
import { isLoggedIn } from '../lib/auth-storage.js';

export function RootLayout() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen flex">
      {/* Sidebar slot (filled in Task 3.1) */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Wire router in `App.tsx`**

```typescript
// web/dashboard/src/App.tsx

import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { queryClient } from './api/react-query.js';
import { LoginPage } from './routes/login.js';
import { RootLayout } from './routes/root-layout.js';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <div>Pick a user from the sidebar to begin.</div> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Manual smoke**

Make sure backend is running with `DASHBOARD_TOKEN=t1`. Then:

```bash
cd web/dashboard
pnpm dev
```

Open `http://localhost:5173`. Expected: redirected to `/login`. Submit `t1`. Expected: navigated to `/` showing "Pick a user from the sidebar to begin." Submit wrong token: error message rendered.

- [ ] **Step 5: Commit**

```bash
cd ../..
git add web/dashboard/src/routes/login.tsx web/dashboard/src/routes/root-layout.tsx web/dashboard/src/App.tsx
git commit -m "feat(web-dashboard): login page + auth guard layout"
```

---

## Phase 3 — Sidebar + UserPicker + per-user routing

### Task 3.1: Sidebar with grouped store nav

**Files:**
- Create: `web/dashboard/src/components/Sidebar.tsx`
- Create: `web/dashboard/src/components/UserPicker.tsx`
- Create: `web/dashboard/src/components/RefreshButton.tsx`
- Modify: `web/dashboard/src/routes/root-layout.tsx`

- [ ] **Step 1: Write `components/Sidebar.tsx`**

```typescript
// web/dashboard/src/components/Sidebar.tsx

import { NavLink, useParams } from 'react-router-dom';
import { STORE_NAMES, STORE_CATEGORY } from '@shared/store-types.js';
import type { StoreName, StoreCategory } from '@shared/store-types.js';

const CATEGORY_ORDER: StoreCategory[] = ['memory', 'activity', 'system'];
const LABEL: Record<StoreCategory, string> = {
  memory: 'Memory', activity: 'Activity', system: 'System',
};

export function Sidebar() {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return <aside className="w-56 bg-slate-100 p-4">Pick a user.</aside>;

  const grouped: Record<StoreCategory, StoreName[]> = { memory: [], activity: [], system: [] };
  for (const n of STORE_NAMES) grouped[STORE_CATEGORY[n]].push(n);

  return (
    <aside className="w-56 bg-slate-100 p-4 text-sm">
      <NavLink to={`/u/${uid}`} end className={({ isActive }) =>
        `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`
      }>
        Overview
      </NavLink>
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="mt-4">
          <div className="text-xs uppercase font-semibold text-slate-500 mb-1">
            {LABEL[cat]}
          </div>
          {grouped[cat].map((name) => (
            <NavLink
              key={name} to={`/u/${uid}/store/${name}`}
              className={({ isActive }) =>
                `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`
              }
            >
              {name}
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Write `components/UserPicker.tsx`**

```typescript
// web/dashboard/src/components/UserPicker.tsx

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/stores.js';

export function UserPicker() {
  const { uid } = useParams<{ uid: string }>();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['users'], queryFn: api.users });
  if (q.isLoading) return <div className="text-sm">Loading users…</div>;
  if (q.isError)   return <div className="text-sm text-red-600">Failed to load users</div>;
  return (
    <select
      className="border rounded px-2 py-1 text-sm"
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
```

- [ ] **Step 3: Write `components/RefreshButton.tsx`**

```typescript
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
```

- [ ] **Step 4: Update `root-layout.tsx` to include Sidebar + UserPicker**

```typescript
// web/dashboard/src/routes/root-layout.tsx

import { Outlet, Navigate } from 'react-router-dom';
import { isLoggedIn, clearLoggedIn } from '../lib/auth-storage.js';
import { Sidebar } from '../components/Sidebar.js';
import { UserPicker } from '../components/UserPicker.js';
import { api } from '../api/stores.js';

export function RootLayout() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;

  async function onLogout() {
    try { await api.logout(); } catch { /* ignore */ }
    clearLoggedIn();
    window.location.assign('/login');
  }

  return (
    <div className="min-h-screen flex bg-white">
      <Sidebar />
      <main className="flex-1 p-6">
        <header className="flex items-center justify-between mb-6">
          <UserPicker />
          <button onClick={onLogout} className="text-sm border px-3 py-1 rounded">
            Log out
          </button>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Manual smoke** — refresh `:5173`, pick a user from the dropdown, see store list in sidebar (no functional content yet beyond the placeholder Overview).

- [ ] **Step 6: Commit**

```bash
git add web/dashboard/src/components/ web/dashboard/src/routes/root-layout.tsx
git commit -m "feat(web-dashboard): sidebar + user picker + refresh + logout"
```

---

### Task 3.2: Per-user routing skeleton

**Files:**
- Modify: `web/dashboard/src/App.tsx`
- Create: `web/dashboard/src/routes/overview.tsx` (stub for now — filled in Task 4.1)
- Create: `web/dashboard/src/routes/store/$store.tsx` (stub — filled in Task 6.1)

- [ ] **Step 1: Write Overview stub**

```typescript
// web/dashboard/src/routes/overview.tsx

import { useParams } from 'react-router-dom';

export function Overview() {
  const { uid } = useParams<{ uid: string }>();
  return <div>Overview for <strong>{uid}</strong> — TBD in Task 4.1</div>;
}
```

(Replace this stub fully in Task 4.1 — leave it for now so routing compiles.)

- [ ] **Step 2: Write StoreRoute stub**

```typescript
// web/dashboard/src/routes/store/$store.tsx

import { useParams } from 'react-router-dom';

export function StoreRoute() {
  const { uid, store } = useParams<{ uid: string; store: string }>();
  return <div>Store <strong>{store}</strong> for <strong>{uid}</strong> — TBD in Task 6.1</div>;
}
```

- [ ] **Step 3: Wire routes in `App.tsx`**

```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { queryClient } from './api/react-query.js';
import { LoginPage } from './routes/login.js';
import { RootLayout } from './routes/root-layout.js';
import { Overview } from './routes/overview.js';
import { StoreRoute } from './routes/store/$store.js';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RootLayout />,
    children: [
      { path: '/',                            element: <Overview /> },
      { path: '/u/:uid',                      element: <Overview /> },
      { path: '/u/:uid/store/:store',         element: <StoreRoute /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/dashboard/src/App.tsx web/dashboard/src/routes/overview.tsx web/dashboard/src/routes/store/
git commit -m "feat(web-dashboard): wire /, /u/:uid, /u/:uid/store/:store routes"
```

---

## Phase 4 — Overview route

### Task 4.1: Per-user store summary cards

**Files:**
- Modify: `web/dashboard/src/routes/overview.tsx`

- [ ] **Step 1: Replace `overview.tsx` with the real implementation**

```typescript
// web/dashboard/src/routes/overview.tsx

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/stores.js';
import { RefreshButton } from '../components/RefreshButton.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

export function Overview() {
  const { uid } = useParams<{ uid: string }>();
  if (!uid) return <div>Pick a user from the dropdown above.</div>;

  const queryKey = ['storeSummary', uid] as const;
  const q = useQuery({ queryKey, queryFn: () => api.storeSummary(uid) });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Overview — {uid}</h1>
        <RefreshButton queryKey={queryKey} />
      </div>
      {q.isLoading && <div>Loading…</div>}
      {q.isError && <ErrorBanner error={q.error} />}
      {q.data && (
        <div className="grid grid-cols-3 gap-4">
          {q.data.stores.map((s) => (
            <Link key={s.name} to={`/u/${uid}/store/${s.name}`}
                  className="block bg-slate-50 rounded p-4 border hover:border-slate-400">
              <div className="text-xs uppercase text-slate-500">{s.category}</div>
              <div className="text-lg font-medium">{s.name}</div>
              <div className="text-3xl mt-2">{s.count.toLocaleString()}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `components/ErrorBanner.tsx`** (referenced above)

```typescript
// web/dashboard/src/components/ErrorBanner.tsx

import { ApiError } from '../api/client.js';

export function ErrorBanner({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.code === 'DB_BUSY') {
      return <div className="bg-yellow-100 text-yellow-900 border border-yellow-400 p-3 rounded mb-4">
        Bot is writing — click Refresh to retry.
      </div>;
    }
    return <div className="bg-red-100 text-red-900 border border-red-400 p-3 rounded mb-4">
      <strong>{error.code}</strong>: {error.message}
    </div>;
  }
  return <div className="bg-red-100 text-red-900 border border-red-400 p-3 rounded mb-4">
    Unexpected error: {String(error)}
  </div>;
}
```

- [ ] **Step 3: Manual smoke** — visit `/u/<userId>`, see 11 cards with counts. Click one → goes to `/u/.../store/...` (still placeholder).

- [ ] **Step 4: Commit**

```bash
git add web/dashboard/src/routes/overview.tsx web/dashboard/src/components/ErrorBanner.tsx
git commit -m "feat(web-dashboard): overview page with per-store summary cards"
```

---

## Phase 5 — Foundation components: StoreTable, FilterBar, Pagination, charts

### Task 5.1: Pagination component

**Files:**
- Create: `web/dashboard/src/components/Pagination.tsx`

- [ ] **Step 1: Write the component**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add web/dashboard/src/components/Pagination.tsx
git commit -m "feat(web-dashboard): Pagination component"
```

---

### Task 5.2: FilterBar — config-driven filter UI

**Files:**
- Create: `web/dashboard/src/components/FilterBar.tsx`

- [ ] **Step 1: Write the component**

```typescript
// web/dashboard/src/components/FilterBar.tsx

import type { FilterDef, StoreConfig } from '@shared/store-meta.js';

export type FilterValues = Record<string, string | string[]>;

export function FilterBar({
  config, value, onChange,
}: {
  config: StoreConfig;
  value: FilterValues;
  onChange: (next: FilterValues) => void;
}) {
  if (config.filters.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {config.filters.map((f) => (
        <FilterField key={f.key} def={f} value={value[f.key]}
                     onChange={(v) => onChange({ ...value, [f.key]: v })} />
      ))}
      <button onClick={() => onChange({})} className="text-sm border px-3 py-1 rounded">
        Reset
      </button>
    </div>
  );
}

function FilterField({ def, value, onChange }: {
  def: FilterDef;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  switch (def.type) {
    case 'enum':
      return (
        <label className="text-sm">
          <span className="block text-xs text-slate-500">{def.key}</span>
          <select value={(value as string) ?? ''}
                  onChange={(e) => onChange(e.target.value)}
                  className="border rounded px-2 py-1">
            <option value="">all</option>
            {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    case 'string':
    case 'substring':
      return (
        <label className="text-sm">
          <span className="block text-xs text-slate-500">{def.key}</span>
          <input type="text" value={(value as string) ?? ''}
                 onChange={(e) => onChange(e.target.value)}
                 className="border rounded px-2 py-1" />
        </label>
      );
    case 'date-range':
    case 'number-range': {
      const arr = (Array.isArray(value) ? value : ['', '']) as string[];
      return (
        <label className="text-sm">
          <span className="block text-xs text-slate-500">{def.key} (from–to)</span>
          <span className="space-x-1">
            <input type="text" value={arr[0]} onChange={(e) => onChange([e.target.value, arr[1]])}
                   className="border rounded px-2 py-1 w-28" placeholder="from" />
            <input type="text" value={arr[1]} onChange={(e) => onChange([arr[0], e.target.value])}
                   className="border rounded px-2 py-1 w-28" placeholder="to" />
          </span>
        </label>
      );
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/dashboard/src/components/FilterBar.tsx
git commit -m "feat(web-dashboard): FilterBar config-driven filter UI"
```

---

### Task 5.3: StoreTable — config-driven table with sort, pagination, filter

**Files:**
- Create: `web/dashboard/src/lib/format.ts`
- Create: `web/dashboard/src/components/StoreTable.tsx`

- [ ] **Step 1: Write `lib/format.ts`**

```typescript
// web/dashboard/src/lib/format.ts

const TZ = 'Asia/Jakarta';

export function fmtTimestamp(ms: number | null | undefined): string {
  if (ms == null) return '';
  return new Date(ms).toLocaleString('en-GB', { timeZone: TZ, hour12: false });
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function fmtJson(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
```

- [ ] **Step 2: Write `components/StoreTable.tsx`**

```typescript
// web/dashboard/src/components/StoreTable.tsx

import type { ColumnDef, StoreConfig } from '@shared/store-meta.js';
import { fmtTimestamp, truncate, fmtJson } from '../lib/format.js';

export function StoreTable({
  config, rows, sort, onSortChange,
}: {
  config: StoreConfig;
  rows: Array<Record<string, unknown>>;
  sort: string;                                // "key:asc" or "key:desc"
  onSortChange: (next: string) => void;
}) {
  const [sortKey, sortDir] = sort.split(':');

  function clickHeader(col: ColumnDef) {
    if (!config.sortable.includes(col.key)) return;
    if (sortKey === col.key) onSortChange(`${col.key}:${sortDir === 'asc' ? 'desc' : 'asc'}`);
    else onSortChange(`${col.key}:asc`);
  }

  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            {config.columns.map((col) => (
              <th key={col.key} onClick={() => clickHeader(col)}
                  className={`px-3 py-2 ${config.sortable.includes(col.key) ? 'cursor-pointer hover:bg-slate-200' : ''}`}
                  style={{ width: col.width }}>
                {col.label}{sortKey === col.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={config.columns.length} className="px-3 py-6 text-center text-slate-500">
              No rows
            </td></tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="border-t hover:bg-slate-50">
              {config.columns.map((col) => (
                <td key={col.key} className="px-3 py-2 align-top">
                  {renderCell(row[col.key], col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(val: unknown, col: ColumnDef): string {
  if (val == null) return '';
  switch (col.type) {
    case 'timestamp': return fmtTimestamp(val as number);
    case 'json':      return col.truncateAt ? truncate(fmtJson(val), col.truncateAt) : fmtJson(val);
    case 'string':    return col.truncateAt ? truncate(String(val), col.truncateAt) : String(val);
    case 'number':    return String(val);
    case 'enum':      return String(val);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/lib/format.ts web/dashboard/src/components/StoreTable.tsx
git commit -m "feat(web-dashboard): StoreTable + cell formatters"
```

---

### Task 5.4: Charts — DonutChart, BarChart, LineChart, ChartCard wrapper

**Files:**
- Create: `web/dashboard/src/components/DonutChart.tsx`
- Create: `web/dashboard/src/components/BarChart.tsx`
- Create: `web/dashboard/src/components/LineChart.tsx`
- Create: `web/dashboard/src/components/ChartCard.tsx`

- [ ] **Step 1: Write `DonutChart.tsx`**

```typescript
// web/dashboard/src/components/DonutChart.tsx

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

export function DonutChart({ series }: {
  series: Array<{ name: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={series} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
          {series.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Write `BarChart.tsx`**

```typescript
// web/dashboard/src/components/BarChart.tsx

import { BarChart as RBar, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function BarChart({ data, xKey, yKey }: {
  data: Array<Record<string, number | string>>;
  xKey: string; yKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RBar data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Bar dataKey={yKey} fill="#0ea5e9" />
      </RBar>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Write `LineChart.tsx`**

```typescript
// web/dashboard/src/components/LineChart.tsx

import { LineChart as RLine, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function LineChart({ data, xKey, yKey }: {
  data: Array<Record<string, number | string>>;
  xKey: string; yKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RLine data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Line dataKey={yKey} stroke="#0ea5e9" dot={false} />
      </RLine>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Write `ChartCard.tsx`**

```typescript
// web/dashboard/src/components/ChartCard.tsx

import type { ChartPayload } from '@shared/api-types.js';
import { DonutChart } from './DonutChart.js';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';

export function ChartCard({ title, payload }: { title: string; payload: ChartPayload }) {
  return (
    <div className="bg-white border rounded p-4">
      <div className="font-medium mb-2">{title}</div>
      {payload.type === 'donut' && <DonutChart series={payload.series} />}
      {payload.type === 'bar' &&   <BarChart data={payload.series} xKey={payload.xKey} yKey={payload.yKey} />}
      {payload.type === 'line' &&  <LineChart data={payload.series} xKey={payload.xKey} yKey={payload.yKey} />}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add web/dashboard/src/components/DonutChart.tsx \
        web/dashboard/src/components/BarChart.tsx \
        web/dashboard/src/components/LineChart.tsx \
        web/dashboard/src/components/ChartCard.tsx
git commit -m "feat(web-dashboard): chart primitives + ChartCard wrapper"
```

---

## Phase 6 — Generic store route

### Task 6.1: $store dispatcher with config-driven defaults

**Files:**
- Modify: `web/dashboard/src/routes/store/$store.tsx`

- [ ] **Step 1: Write the real `$store.tsx`**

```typescript
// web/dashboard/src/routes/store/$store.tsx

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/stores.js';
import { STORE_CONFIG } from '../../../../src/dashboard/store-config.js';
import { STORE_NAMES, type StoreName } from '@shared/store-types.js';
import { StoreTable } from '../../components/StoreTable.js';
import { FilterBar, type FilterValues } from '../../components/FilterBar.js';
import { Pagination } from '../../components/Pagination.js';
import { ChartCard } from '../../components/ChartCard.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { KnowledgeView } from './store-views/KnowledgeView.js';
import { MessagesView } from './store-views/MessagesView.js';
import { LedgerView } from './store-views/LedgerView.js';
import { TasksView } from './store-views/TasksView.js';

const PAGE_LIMIT = 50;

export function StoreRoute() {
  const { uid, store } = useParams<{ uid: string; store: string }>();
  if (!uid || !store) return <div>Pick a user + store.</div>;
  if (!STORE_NAMES.includes(store as StoreName)) return <div>Unknown store.</div>;
  const storeName = store as StoreName;
  const cfg = STORE_CONFIG[storeName];

  switch (storeName) {
    case 'knowledge': return <KnowledgeView uid={uid} cfg={cfg} />;
    case 'messages':  return <MessagesView  uid={uid} cfg={cfg} />;
    case 'ledger':    return <LedgerView    uid={uid} cfg={cfg} />;
    case 'tasks':     return <TasksView     uid={uid} cfg={cfg} />;
    default:          return <GenericStoreView uid={uid} storeName={storeName} cfg={cfg} />;
  }
}

export function GenericStoreView({ uid, storeName, cfg }: {
  uid: string;
  storeName: StoreName;
  cfg: typeof STORE_CONFIG[StoreName];
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(`${cfg.defaultSort.key}:${cfg.defaultSort.dir}`);
  const [filter, setFilter] = useState<FilterValues>({});

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  params.set('sort', sort);
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(`filter[${k}]`, vv));
    else if (v) params.set(`filter[${k}]`, v);
  }

  const listKey = ['storeList', uid, storeName, params.toString()] as const;
  const list = useQuery({ queryKey: listKey, queryFn: () => api.storeList(uid, storeName, params) });

  const statsKey = ['storeStats', uid, storeName] as const;
  const stats = useQuery({
    queryKey: statsKey, queryFn: () => api.storeStats(uid, storeName, '30d'),
    enabled: cfg.charts.length > 0,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{storeName}</h1>
        <RefreshButton queryKey={[...listKey.slice(0, 3)]} />
      </div>

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data.charts[c.id]} />
          ))}
        </div>
      )}

      <FilterBar config={cfg} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />

      {list.isError && <ErrorBanner error={list.error} />}
      {list.isLoading && <div>Loading…</div>}
      {list.data && (
        <>
          <StoreTable config={cfg} rows={list.data.rows} sort={sort}
                      onSortChange={(s) => { setSort(s); setPage(1); }} />
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke** — visit a store like `profile` or `journal` (which fall through to `GenericStoreView`). Filter, sort, paginate. Charts visible if applicable.

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/routes/store/$store.tsx
git commit -m "feat(web-dashboard): generic store route with config-driven table + charts"
```

---

## Phase 7 — Per-store custom views

Each per-store View extends `GenericStoreView` with one or two domain-specific affordances. The pattern is identical:
1. Render any custom controls above the generic table.
2. Compose `<GenericStoreView />` for everything else (or duplicate its body if a control needs deeper integration).

For the four below, the custom affordance is too entangled with the table to compose cleanly, so each writes its own table integration. The other 7 stores use `GenericStoreView` unchanged (already wired in Task 6.1).

### Task 7.1: KnowledgeView with FTS search box

**Files:**
- Create: `web/dashboard/src/routes/store/store-views/KnowledgeView.tsx`

- [ ] **Step 1: Write the view**

```typescript
// web/dashboard/src/routes/store/store-views/KnowledgeView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { StoreTable } from '../../../components/StoreTable.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { GenericStoreView } from '../$store.js';

export function KnowledgeView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  if (!q.trim()) return <GenericStoreView uid={uid} storeName="knowledge" cfg={cfg} />;

  const params = new URLSearchParams({ q, page: String(page), limit: '50' });
  const key = ['knowledgeSearch', uid, q, page] as const;
  const search = useQuery({ queryKey: key, queryFn: () => api.knowledgeSearch(uid, params) });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'knowledge'],
    queryFn: () => api.storeStats(uid, 'knowledge'),
    enabled: cfg.charts.length > 0,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">knowledge</h1>
        <RefreshButton queryKey={['knowledgeSearch', uid, q]} />
      </div>

      <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} />

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data.charts[c.id]} />
          ))}
        </div>
      )}

      {search.isError && <ErrorBanner error={search.error} />}
      {search.isLoading && <div>Searching…</div>}
      {search.data && (
        <>
          <SnippetTable hits={search.data.hits} />
          <Pagination page={search.data.page} limit={search.data.limit}
                      total={search.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <input
        type="search" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Search knowledge (FTS5; clear to browse)"
        className="border rounded px-3 py-2 w-96"
      />
    </div>
  );
}

function SnippetTable({ hits }: {
  hits: Array<Record<string, unknown> & { snippet?: string }>;
}) {
  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Key</th>
            <th className="px-3 py-2">Snippet</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-2 align-top">{String(h.category ?? '')}</td>
              <td className="px-3 py-2 align-top">{String(h.key ?? '')}</td>
              <td className="px-3 py-2 align-top"
                  dangerouslySetInnerHTML={{ __html: String(h.snippet ?? '') }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(The `dangerouslySetInnerHTML` is acceptable here because the snippet is server-generated by FTS5's `snippet()` function with the exact `<mark>...</mark>` markers we control. No user-controlled HTML reaches it.)

- [ ] **Step 2: Commit**

```bash
git add web/dashboard/src/routes/store/store-views/KnowledgeView.tsx
git commit -m "feat(web-dashboard): KnowledgeView with FTS search box + snippet rendering"
```

---

### Task 7.2: MessagesView with FTS search + thread expand

**Files:**
- Create: `web/dashboard/src/routes/store/store-views/MessagesView.tsx`

- [ ] **Step 1: Write the view**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add web/dashboard/src/routes/store/store-views/MessagesView.tsx
git commit -m "feat(web-dashboard): MessagesView with FTS + session thread drilldown"
```

---

### Task 7.3: LedgerView with JSON payload drawer

**Files:**
- Create: `web/dashboard/src/components/JsonDrawer.tsx`
- Create: `web/dashboard/src/routes/store/store-views/LedgerView.tsx`

- [ ] **Step 1: Write `components/JsonDrawer.tsx`**

```typescript
// web/dashboard/src/components/JsonDrawer.tsx

export function JsonDrawer({ value }: { value: unknown }) {
  let pretty: string;
  try {
    pretty = JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded overflow-x-auto">
      {pretty}
    </pre>
  );
}
```

- [ ] **Step 2: Write `LedgerView.tsx`**

```typescript
// web/dashboard/src/routes/store/store-views/LedgerView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { FilterBar, type FilterValues } from '../../../components/FilterBar.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { JsonDrawer } from '../../../components/JsonDrawer.js';
import { fmtTimestamp } from '../../../lib/format.js';

export function LedgerView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [filter, setFilter] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(`${cfg.defaultSort.key}:${cfg.defaultSort.dir}`);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = new URLSearchParams({ page: String(page), limit: '50', sort });
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(`filter[${k}]`, vv));
    else if (v) params.set(`filter[${k}]`, v);
  }

  const listKey = ['storeList', uid, 'ledger', params.toString()] as const;
  const list = useQuery({ queryKey: listKey, queryFn: () => api.storeList(uid, 'ledger', params) });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'ledger'],
    queryFn: () => api.storeStats(uid, 'ledger'),
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">ledger</h1>
        <RefreshButton queryKey={['storeList', uid, 'ledger']} />
      </div>

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data!.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data!.charts[c.id]} />
          ))}
        </div>
      )}

      <FilterBar config={cfg} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
      {list.isError && <ErrorBanner error={list.error} />}
      {list.isLoading && <div>Loading…</div>}
      {list.data && (
        <>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">Stream</th>
                  <th className="px-3 py-2">Tags</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((row, i) => {
                  const id = String(row.id);
                  const open = expanded.has(id);
                  return (
                    <>
                      <tr key={id} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-2">{String(row.stream ?? '')}</td>
                        <td className="px-3 py-2">{String(row.tags ?? '')}</td>
                        <td className="px-3 py-2">{fmtTimestamp(Number(row.ts))}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => toggle(id)} className="text-xs underline">
                            {open ? 'hide payload' : 'show payload'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${id}-body`} className="border-t bg-slate-50">
                          <td colSpan={4} className="p-3"><JsonDrawer value={row.payload} /></td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/components/JsonDrawer.tsx \
        web/dashboard/src/routes/store/store-views/LedgerView.tsx
git commit -m "feat(web-dashboard): LedgerView with JSON payload drawer"
```

---

### Task 7.4: TasksView with status pills

**Files:**
- Create: `web/dashboard/src/routes/store/store-views/TasksView.tsx`

- [ ] **Step 1: Write the view**

```typescript
// web/dashboard/src/routes/store/store-views/TasksView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { FilterBar, type FilterValues } from '../../../components/FilterBar.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { fmtTimestamp } from '../../../lib/format.js';

const PILL: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-900',
  done:      'bg-green-100 text-green-900',
  cancelled: 'bg-slate-200 text-slate-700',
};

export function TasksView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [filter, setFilter] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(`filter[${k}]`, vv));
    else if (v) params.set(`filter[${k}]`, v);
  }

  const list = useQuery({
    queryKey: ['storeList', uid, 'tasks', params.toString()],
    queryFn: () => api.storeList(uid, 'tasks', params),
  });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'tasks'],
    queryFn: () => api.storeStats(uid, 'tasks'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">tasks</h1>
        <RefreshButton queryKey={['storeList', uid, 'tasks']} />
      </div>

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data!.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data!.charts[c.id]} />
          ))}
        </div>
      )}

      <FilterBar config={cfg} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
      {list.isError && <ErrorBanner error={list.error} />}
      {list.isLoading && <div>Loading…</div>}
      {list.data && (
        <>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Trigger</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((row, i) => (
                  <tr key={i} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2">{String(row.title ?? '')}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${PILL[String(row.status)] ?? 'bg-slate-100'}`}>
                        {String(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{String(row.trigger_type ?? '')}</td>
                    <td className="px-3 py-2">{String(row.due_date ?? '')}</td>
                    <td className="px-3 py-2">{fmtTimestamp(Number(row.updated_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/dashboard/src/routes/store/store-views/TasksView.tsx
git commit -m "feat(web-dashboard): TasksView with status pills"
```

---

## Phase 8 — Production build wired into Express

### Task 8.1: Build SPA into dist/dashboard + serve via Express

**Files:**
- Modify: `src/dashboard/boot.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Add static handler in `boot.ts`**

Open `src/dashboard/boot.ts`. Just before `app.use(errorMiddleware);`, add:

```typescript
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
// (add to imports at top)

// inside createDashboardServer, after all /api routes:
const spaDir = resolve(process.cwd(), 'dist/dashboard');
if (existsSync(spaDir)) {
  app.use(express.static(spaDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(spaDir, 'index.html'));
  });
}
```

(The conditional skip is so dev runs without `dist/dashboard/` don't 404 every page — frontend dev uses Vite at `:5173` instead.)

- [ ] **Step 2: Add root build script**

Open root `package.json`. Update `scripts`:

```json
"scripts": {
  "build": "tsc && pnpm -C web/dashboard build",
  "build:backend": "tsc",
  "build:dashboard": "pnpm -C web/dashboard build",
  "start": "node dist/src/index.js",
  "start:tsx": "tsx src/index.ts",
  "dev": "tsx src/index.ts",
  "type-check": "tsc --noEmit",
  "test": "vitest"
}
```

- [ ] **Step 3: Verify production build**

```bash
pnpm build
ls dist/dashboard/index.html
# expected: file exists
```

- [ ] **Step 4: Run production locally**

```bash
DASHBOARD_TOKEN=t1 CONSOLE_USER_ID=alice pnpm start
```

Visit `http://localhost:3200/` — expected: SPA served by Express. Login flow works.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/boot.ts package.json
git commit -m "feat(dashboard): serve built SPA from dist/dashboard alongside API"
```

---

## Phase 9 — Manual QA

### Task 9.1: Full end-to-end QA pass with TLS

**Files:** none (verification only)

- [ ] **Step 1: Generate cert (if not done in backend Task 6.1)**

```bash
./scripts/gen-dashboard-cert.sh 192.168.1.10  # or your server IP
```

- [ ] **Step 2: Build + start prod**

```bash
pnpm build
DASHBOARD_TOKEN=$(openssl rand -hex 32) \
DASHBOARD_TLS_CERT=data/dashboard-tls/cert.pem \
DASHBOARD_TLS_KEY=data/dashboard-tls/key.pem \
CONSOLE_USER_ID=console-user \
pnpm start
```

- [ ] **Step 3: Browser checklist**

Open `https://localhost:3200/` (accept cert warning). Run through:

- [ ] Login with token → land on Overview.
- [ ] Pick a user from the user-picker dropdown.
- [ ] Click each of the 11 stores in the sidebar:
  - [ ] **profile** — table renders, refresh works.
  - [ ] **preferences** — kind filter switches between rule/style.
  - [ ] **knowledge** — donut chart renders; FTS search box returns hits with `<mark>` highlights; clear search returns to browse mode.
  - [ ] **journal** — bar chart renders for `count_by_week`; date filter works.
  - [ ] **tasks** — donut renders; status pills colored; status/trigger filters work.
  - [ ] **cronjobs** — donut renders; type/status filters work.
  - [ ] **messages** — bar chart for `count_by_day`; FTS search hits with snippets; clicking session_id opens thread view; "back" returns.
  - [ ] **reactions** — table renders; actor filter works.
  - [ ] **sessions** — single-row table renders if a session is active.
  - [ ] **ledger** — bar chart `aggregate_by_stream`; "show payload" expands JSON drawer; tag substring filter works.
  - [ ] **query_costs** — line chart for `cost_by_day`; session filter works.
- [ ] Trigger a write from the bot (send a chat message via console gateway to seed a new message), refresh `messages` view, new row appears.
- [ ] Click "Log out" → cleared cookie → redirected to `/login`.
- [ ] Try accessing `https://localhost:3200/u/...` directly without logging in → redirected to `/login`.
- [ ] Switch user via picker → all views refresh to the new user's data.
- [ ] Trigger an invalid query (mutate URL to `?filter[bogus]=x`) → red error banner shows `INVALID_QUERY`.

- [ ] **Step 4: Run all tests one more time**

```bash
pnpm test
cd web/dashboard && pnpm test && cd ../..
```

- [ ] **Step 5: No commit needed unless cleanup found.**

---

## Done — frontend complete

The dashboard is now a fully functional read-only multi-user observability tool: 11 store browsing surfaces, FTS search where available, charts per store, single-token cookie auth over self-signed HTTPS, no polling, no mutations.

Future work tracked in spec §8 (`source_msg_id` cross-linking, custom SQL builder, Telegram-based auth, `DASHBOARD_PORT` env var, eventual edit dashboard).

---

## Self-review

1. **Spec coverage** — every spec section / requirement mapped:
   - Sidebar grouping (memory / activity / system) ✓ Task 3.1.
   - User picker ✓ Task 3.1.
   - Manual refresh ✓ RefreshButton, every view.
   - Cookie auth (no token in client storage) ✓ Tasks 1.1, 1.3, 2.1.
   - Generic StoreTable + per-store custom views ✓ Tasks 5.3, 6.1, 7.1–7.4.
   - Charts per store ✓ Task 5.4 + 6.1.
   - 11 stores covered ✓ Task 6.1 dispatcher routes the 4 custom; remaining 7 use GenericStoreView.
   - SPA served by Express ✓ Task 8.1.
   - TLS warning accepted manually ✓ Task 9.1.
   - Error mapping (DB_BUSY banner, INVALID_QUERY toast, UNAUTHENTICATED redirect) ✓ ErrorBanner + react-query auth-clear subscriber.

2. **Placeholder scan** — no "TBD" in step content. Task 3.2 introduces stub files explicitly so routing compiles, with the next step (4.1 / 6.1) replacing them fully — this is intentional staging.

3. **Type consistency:**
   - `StoreName`, `StoreConfig`, `ChartPayload`, `ListResponse`, `SearchResponse` all sourced from `@shared/*` (defined in backend Task 1.1).
   - `api` object shape consistent across components.
   - `RefreshButton` accepts `queryKey: readonly unknown[]` — every call site passes a `[]` or `as const` tuple.
   - `STORE_CONFIG` imported from `../../../../src/dashboard/store-config.js` in Task 6.1 — a fragile relative path. If preferred, expose via `@shared/store-config.ts` re-export. Decision: leave as-is to keep the import surface small; revisit if the path proves too brittle.
