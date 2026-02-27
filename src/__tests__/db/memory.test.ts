import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let initMemoryDb: typeof import('../../db/memory.js').initMemoryDb;
let getMemoryDb: typeof import('../../db/memory.js').getMemoryDb;
let closeMemoryDb: typeof import('../../db/memory.js').closeMemoryDb;

beforeEach(async () => {
  const mod = await import('../../db/memory.js');
  initMemoryDb = mod.initMemoryDb;
  getMemoryDb = mod.getMemoryDb;
  closeMemoryDb = mod.closeMemoryDb;
});

afterEach(async () => {
  try {
    await closeMemoryDb();
  } catch {
    // already closed or not initialized
  }
});

describe('initMemoryDb', () => {
  it('connects successfully with mem:// engine', async () => {
    const db = await initMemoryDb('mem://');
    expect(db).toBeDefined();
  });

  it('creates all expected tables in the schema', async () => {
    const db = await initMemoryDb('mem://');
    const info = await db.query<[Record<string, unknown>]>('INFO FOR DB');
    // INFO FOR DB returns an object; tables may be under a 'tables' key or at top level
    const raw = info[0] as Record<string, unknown>;
    const tables =
      raw && typeof raw === 'object' && 'tables' in raw
        ? raw.tables as Record<string, unknown>
        : raw;
    expect(tables).toBeDefined();

    const tableNames = Object.keys(tables!);

    // Node tables
    expect(tableNames).toContain('person');
    expect(tableNames).toContain('preference');
    expect(tableNames).toContain('fact');
    expect(tableNames).toContain('routine');
    expect(tableNames).toContain('persona');

    // Edge tables
    expect(tableNames).toContain('has_preference');
    expect(tableNames).toContain('has_fact');
    expect(tableNames).toContain('has_routine');
    expect(tableNames).toContain('prefers_persona');
    expect(tableNames).toContain('knows');
  });
});

describe('getMemoryDb', () => {
  it('throws if not initialized', () => {
    expect(() => getMemoryDb()).toThrow();
  });

  it('returns the db instance after initialization', async () => {
    await initMemoryDb('mem://');
    const db = getMemoryDb();
    expect(db).toBeDefined();
  });
});

describe('closeMemoryDb', () => {
  it('closes the connection cleanly', async () => {
    await initMemoryDb('mem://');
    await expect(closeMemoryDb()).resolves.not.toThrow();
  });

  it('causes getMemoryDb to throw after close', async () => {
    await initMemoryDb('mem://');
    await closeMemoryDb();
    expect(() => getMemoryDb()).toThrow();
  });
});

describe('schema validation', () => {
  it('enforces person type ASSERT constraint', async () => {
    const db = await initMemoryDb('mem://');

    // Valid type should work
    await db.query(
      `CREATE person:test1 SET name = 'Test', type = 'self', phone = '+1'`
    );

    // Invalid type should be rejected
    await expect(
      db.query(
        `CREATE person:test2 SET name = 'Bad', type = 'invalid', phone = '+2'`
      )
    ).rejects.toThrow();
  });

  it('enforces importance ASSERT on preference', async () => {
    const db = await initMemoryDb('mem://');

    await db.query(
      `CREATE preference:p1 SET category = 'food', value = 'coffee', importance = 'fundamental'`
    );

    await expect(
      db.query(
        `CREATE preference:p2 SET category = 'food', value = 'tea', importance = 'wrong'`
      )
    ).rejects.toThrow();
  });

  it('enforces importance ASSERT on fact', async () => {
    const db = await initMemoryDb('mem://');

    await db.query(
      `CREATE fact:f1 SET content = 'test', importance = 'extended'`
    );

    await expect(
      db.query(
        `CREATE fact:f2 SET content = 'test', importance = 'wrong'`
      )
    ).rejects.toThrow();
  });

  it('enforces importance ASSERT on routine', async () => {
    const db = await initMemoryDb('mem://');

    await db.query(
      `CREATE routine:r1 SET activity = 'jog', importance = 'fundamental'`
    );

    await expect(
      db.query(
        `CREATE routine:r2 SET activity = 'jog', importance = 'wrong'`
      )
    ).rejects.toThrow();
  });

  it('sets DEFAULT created_at via time::now()', async () => {
    const db = await initMemoryDb('mem://');

    await db.query(
      `CREATE person:ts SET name = 'TimeTest', type = 'self', phone = '+999'`
    );

    const result = await db.query<[Array<{ created_at: string }>]>(
      `SELECT created_at FROM person:ts`
    );
    expect(result[0]?.[0]?.created_at).toBeDefined();
  });

  it('supports nullable embedding field on fact', async () => {
    const db = await initMemoryDb('mem://');

    // null embedding
    await db.query(
      `CREATE fact:emb1 SET content = 'no vector', importance = 'extended', embedding = NONE`
    );
    // with embedding
    await db.query(
      `CREATE fact:emb2 SET content = 'with vector', importance = 'extended', embedding = [0.1, 0.2, 0.3]`
    );

    const result = await db.query<[Array<{ embedding: number[] | null }>]>(
      `SELECT embedding FROM fact`
    );
    const embeddings = result[0]!.map((r) => r.embedding);
    // SurrealDB returns undefined for NONE values
    expect(embeddings).toContainEqual(undefined);
    expect(embeddings).toContainEqual([0.1, 0.2, 0.3]);
  });

  it('supports relation edges (knows, has_fact)', async () => {
    const db = await initMemoryDb('mem://');

    await db.query(`CREATE person:a SET name = 'A', type = 'self', phone = '+1'`);
    await db.query(`CREATE person:b SET name = 'B', type = 'contact', phone = '+2'`);
    await db.query(`RELATE person:a->knows->person:b SET relationship_type = 'friend'`);

    const traversal = await db.query<[unknown[]]>(
      `SELECT ->knows->person.* AS friends FROM person:a`
    );
    const friends = (traversal[0]?.[0] as { friends?: unknown[] })?.friends;
    expect(friends).toBeDefined();
    expect(friends).toHaveLength(1);
  });
});
