// src/dashboard/routes/store-list.ts

import type { Express, Request, Response, NextFunction } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { STORE_CONFIG } from '../store-config.js';
import { STORE_NAMES, type StoreName } from '../shared/store-types.js';
import { buildListQuery } from '../filter-builder.js';
import { StoreNotFoundError } from '../error-middleware.js';
import type { UserDb } from '../../db/user-db.js';
import type { ListQuery } from '../shared/api-types.js';
import type { KnowledgeCategory } from '../../db/knowledge.js';
import type { PreferenceKind } from '../../db/preferences.js';
import type { TaskStatus, TaskTriggerType } from '../../db/tasks.js';
import type { CronjobType, CronjobStatus } from '../../db/cronjobs.js';
import type { Sender } from '../../db/message.js';
import type { ReactionActor } from '../../db/reactions.js';

export function mountStoreListRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  // Enable qs-style nested parsing so filter[key]=val → { filter: { key: val } }
  app.set('query parser', 'extended');
  app.get(
    '/api/users/:uid/stores/:store/list',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        const storeName = req.params['store'] as StoreName;
        if (!STORE_NAMES.includes(storeName)) throw new StoreNotFoundError(storeName);
        const cfg = STORE_CONFIG[storeName];
        const params = parseQuery(req.query);
        const built = buildListQuery(cfg, params);  // validates filter/sort whitelist
        const db = deps.pool.acquire(uid);
        const result = await deps.pool.runWithRetry(() => listFor(storeName, db, params, built));
        res.json({
          rows: result.rows,
          total: result.total,
          page: params.page ?? 1,
          limit: built.limit,
        });
      } catch (err) { next(err); }
    },
  );
}

function parseQuery(q: Request['query']): ListQuery {
  const out: ListQuery = {};
  if (q.filter && typeof q.filter === 'object') out.filter = q.filter as ListQuery['filter'];
  if (typeof q.sort === 'string')  out.sort = q.sort;
  if (typeof q.page === 'string')  out.page = parseInt(q.page, 10);
  if (typeof q.limit === 'string') out.limit = parseInt(q.limit, 10);
  return out;
}

function listFor(
  name: StoreName, db: UserDb, q: ListQuery,
  built: { limit: number; offset: number },
): { rows: unknown[]; total: number } {
  const f = (q.filter ?? {}) as Record<string, string | string[]>;
  function scalar(v: string | string[] | undefined): string | undefined {
    return Array.isArray(v) ? v[0] : v;
  }
  function pair(v: string | string[] | undefined): [string?, string?] {
    return Array.isArray(v) ? [v[0], v[1]] : [v, v];
  }

  switch (name) {
    case 'profile': {
      const all = db.profile.getAllRows();
      return { rows: all.slice(built.offset, built.offset + built.limit), total: all.length };
    }
    case 'preferences': {
      const kind = scalar(f.kind) as PreferenceKind | undefined;
      const all = db.preferences.list({ kind });
      return { rows: all.slice(built.offset, built.offset + built.limit), total: all.length };
    }
    case 'knowledge':
      return db.knowledge.listPage({
        category: scalar(f.category) as KnowledgeCategory | undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'journal': {
      const [edFrom, edTo] = pair(f.event_date);
      const [caFrom, caTo] = pair(f.created_at);
      return db.journal.listPage({
        eventDateFrom: edFrom, eventDateTo: edTo,
        createdFrom: caFrom != null ? Number(caFrom) : undefined,
        createdTo:   caTo   != null ? Number(caTo)   : undefined,
        limit: built.limit, offset: built.offset,
      });
    }
    case 'tasks': {
      const [ddFrom, ddTo] = pair(f.due_date);
      return db.tasks.listPage({
        status:       scalar(f.status) as TaskStatus | undefined,
        trigger_type: scalar(f.trigger_type) as TaskTriggerType | undefined,
        dueDateFrom:  ddFrom, dueDateTo: ddTo,
        limit: built.limit, offset: built.offset,
      });
    }
    case 'cronjobs':
      return db.cronjobs.listPage({
        type:   scalar(f.type)   as CronjobType | undefined,
        status: scalar(f.status) as CronjobStatus | undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'messages': {
      const [tsFrom, tsTo] = pair(f.timestamp);
      return db.messages.listPage({
        gateway:    scalar(f.gateway),
        sender:     scalar(f.sender) as Sender | undefined,
        session_id: scalar(f.session_id),
        timestampFrom: tsFrom != null ? Number(tsFrom) : undefined,
        timestampTo:   tsTo   != null ? Number(tsTo)   : undefined,
        limit: built.limit, offset: built.offset,
      });
    }
    case 'reactions':
      return db.reactions.listPage({
        actor: scalar(f.actor) as ReactionActor | undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'sessions': {
      const id = db.sessions.get();
      const updated = db.sessions.getLastActivity?.() ?? null;
      const rows = id ? [{ id: 1, session_id: id, updated_at: updated }] : [];
      return { rows, total: rows.length };
    }
    case 'ledger': {
      const [tsFrom, tsTo] = pair(f.ts);
      return db.ledger.listPage({
        stream:   scalar(f.stream),
        tagsLike: scalar(f.tags),
        tsFrom: tsFrom != null ? Number(tsFrom) : undefined,
        tsTo:   tsTo   != null ? Number(tsTo)   : undefined,
        limit: built.limit, offset: built.offset,
      });
    }
    case 'query_costs': {
      const [tsFrom, tsTo] = pair(f.timestamp);
      return db.queryCosts.listPage({
        sessionId: scalar(f.session_id),
        model:     scalar(f.model),
        timestampFrom: tsFrom != null ? Number(tsFrom) : undefined,
        timestampTo:   tsTo   != null ? Number(tsTo)   : undefined,
        limit: built.limit, offset: built.offset,
      });
    }
  }
}
