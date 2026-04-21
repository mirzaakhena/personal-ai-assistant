// src-v4/tools/memory.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  MemoryStore,
  ProfileRecord,
  JournalRecord,
  RelationshipRecord,
  Layer,
  JournalType,
  JournalStatus,
  Intensity,
  EventOutcome,
  Importance,
  Circle,
} from '../db/memory.js';
import { toIsoJakarta, parseIsoToMs } from '../utils/time.js';

// ── Sanitized result types (no user_id, ms → ISO) ──────────

export interface ProfileResult {
  id: string;
  category: string;
  layer: Layer;
  key: string;
  value: string;
  confidence: number | null;
  source_session_id: string | null;
  source_msg_id: string | null;
  importance: Importance;
  last_updated: string;
  created_at: string;
}

export interface JournalResult {
  id: string;
  type: JournalType;
  content: string;
  status: JournalStatus;
  intensity: Intensity;
  recurrence_count: number;
  related_ids: string[] | null;
  event_date: string | null;
  event_outcome: EventOutcome;
  follow_up_needed: number;
  inferred_trait: string | null;
  confidence: number | null;
  session_id: string | null;
  source_msg_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface RelationshipResult {
  id: string;
  name: string;
  role: string;
  dynamic: string | null;
  circle: Circle;
  related_ids: string[] | null;
  source_session_id: string | null;
  last_mentioned: string;
  created_at: string;
}

// ── Sanitizers ──────────────────────────────────────────

function sanitizeProfile(r: ProfileRecord): ProfileResult {
  return {
    id: r.id, category: r.category, layer: r.layer, key: r.key, value: r.value,
    confidence: r.confidence,
    source_session_id: r.source_session_id, source_msg_id: r.source_msg_id,
    importance: r.importance,
    last_updated: toIsoJakarta(r.last_updated), created_at: toIsoJakarta(r.created_at),
  };
}

function sanitizeJournal(r: JournalRecord): JournalResult {
  return {
    id: r.id, type: r.type, content: r.content, status: r.status, intensity: r.intensity,
    recurrence_count: r.recurrence_count, related_ids: r.related_ids,
    event_date: r.event_date, event_outcome: r.event_outcome, follow_up_needed: r.follow_up_needed,
    inferred_trait: r.inferred_trait, confidence: r.confidence,
    session_id: r.session_id, source_msg_id: r.source_msg_id,
    created_at: toIsoJakarta(r.created_at),
    resolved_at: r.resolved_at !== null ? toIsoJakarta(r.resolved_at) : null,
  };
}

function sanitizeRelationship(r: RelationshipRecord): RelationshipResult {
  return {
    id: r.id, name: r.name, role: r.role, dynamic: r.dynamic, circle: r.circle,
    related_ids: r.related_ids,
    source_session_id: r.source_session_id,
    last_mentioned: toIsoJakarta(r.last_mentioned), created_at: toIsoJakarta(r.created_at),
  };
}

// ── Handlers interface ──────────────────────────────────

export interface MemoryHandlers {
  saveProfile(rec: {
    category: string; layer: Layer; key: string; value: string;
    confidence?: number; source_msg_id?: string;
    importance?: Importance;
  }): ProfileResult;
  listProfile(opts?: { layer?: Layer; category?: string; importance?: Importance }): ProfileResult[];

  saveJournal(rec: {
    type: Exclude<JournalType, 'trait_observation'>;
    content: string;
    status?: JournalStatus;
    intensity?: Intensity;
    recurrence_count?: number;
    related_ids?: string[];
    event_date?: string;
    follow_up_needed?: number;
    source_msg_id?: string;
  }): JournalResult;

  saveTraitObservation(rec: {
    content: string;
    inferred_trait: string;
    confidence: number;
    related_ids?: string[];
    source_msg_id?: string;
  }): JournalResult;

  resolveJournal(id: string, outcome?: EventOutcome): { resolved: boolean };

  searchMemory(filter: {
    query?: string;
    type?: JournalType;
    status?: JournalStatus;
    fromTime?: number;
    toTime?: number;
    limit?: number;
    order?: 'newest' | 'oldest' | 'relevant';
  }): JournalResult[];

  saveRelationship(rec: {
    name: string; role: string; dynamic?: string; circle?: Circle; related_ids?: string[];
  }): RelationshipResult;
  listRelationships(): RelationshipResult[];
}

// ── Build factory of MemoryHandlers from MemoryStore ────

export function buildMemoryHandlers(
  store: MemoryStore,
  sessionId: string | null
): MemoryHandlers {
  return {
    saveProfile: (rec) => sanitizeProfile(store.upsertProfile({
      category: rec.category, layer: rec.layer, key: rec.key, value: rec.value,
      confidence: rec.confidence ?? null,
      source_session_id: sessionId,
      source_msg_id: rec.source_msg_id ?? null,
      importance: rec.importance,
    })),

    listProfile: (opts) => store.listProfile(opts).map(sanitizeProfile),

    saveJournal: (rec) => sanitizeJournal(store.insertJournal({
      type: rec.type as JournalType,
      content: rec.content,
      status: rec.status ?? null,
      intensity: rec.intensity ?? null,
      recurrence_count: rec.recurrence_count ?? 1,
      related_ids: rec.related_ids ?? null,
      event_date: rec.event_date ?? null,
      event_outcome: null,
      follow_up_needed: rec.follow_up_needed ?? 0,
      inferred_trait: null,
      confidence: null,
      session_id: sessionId,
      source_msg_id: rec.source_msg_id ?? null,
      resolved_at: null,
    })),

    saveTraitObservation: (rec) => sanitizeJournal(store.insertJournal({
      type: 'trait_observation',
      content: rec.content,
      status: null,
      intensity: null,
      recurrence_count: 1,
      related_ids: rec.related_ids ?? null,
      event_date: null,
      event_outcome: null,
      follow_up_needed: 0,
      inferred_trait: rec.inferred_trait,
      confidence: rec.confidence,
      session_id: sessionId,
      source_msg_id: rec.source_msg_id ?? null,
      resolved_at: null,
    })),

    resolveJournal: (id, outcome) => ({ resolved: store.resolveJournal(id, outcome ?? null) }),

    searchMemory: (filter) => store.searchJournal(filter).map(sanitizeJournal),

    saveRelationship: (rec) => sanitizeRelationship(store.upsertRelationship({
      name: rec.name, role: rec.role,
      dynamic: rec.dynamic ?? null,
      circle: rec.circle ?? null,
      related_ids: rec.related_ids ?? null,
      source_session_id: sessionId,
    })),

    listRelationships: () => store.listRelationships().map(sanitizeRelationship),
  };
}

// ── Zod enums ───────────────────────────────────────────

const layerEnum = z.enum(['L2', 'L3']);
const journalTypeForSaveEnum = z.enum(['emotion', 'life_context', 'problem', 'event', 'conversation_summary']);
const journalTypeFullEnum = z.enum(['emotion', 'life_context', 'problem', 'event', 'conversation_summary', 'trait_observation']);
const journalStatusEnum = z.enum(['ongoing', 'resolved']);
const intensityEnum = z.enum(['low', 'medium', 'high']);
const eventOutcomeEnum = z.enum(['done', 'missed']);
const orderEnum = z.enum(['newest', 'oldest', 'relevant']);

// ── Helper: wrap handler call in success/error envelope ──

function ok(payload: object): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...payload }) }] };
}
function fail(err: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: String(err) }) }] };
}
function listOk(results: object[]): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ count: results.length, results }) }] };
}

// ── MCP Server ──────────────────────────────────────────

export function createMemoryServer(handlers: MemoryHandlers) {
  const saveProfileTool = tool(
    "save_profile",
    `Save or update a singleton fact about the user (identity, location, preference, value/belief, cognitive style, rule).
Profile is keyed by (category, key) — re-saving with same key updates the value.

Layer L3 = core identity (name, language, dob, location). Layer L2 = preferences/values/style/rules.

For category="rule" entries, set importance="critical" for safety-relevant rules
(allergies, medical, legal). Use "normal" (default) for preferences/policies.
Critical entries always load in memory_context; normal L2 entries are top-15 capped by recency.

Examples:
  save_profile({ category: "identity", layer: "L3", key: "name", value: "Mirza" })
  save_profile({ category: "preference", layer: "L2", key: "communication_style", value: "direct, no fluff", confidence: 0.9 })
  save_profile({ category: "rule", layer: "L3", key: "allergy_food", value: "udang, kerang", importance: "critical" })
  save_profile({ category: "rule", layer: "L2", key: "before_leaving_home", value: "cabut colokan listrik, matikan AC" })`,
    {
      category: z.string().min(1).describe("e.g. 'identity', 'location', 'preference', 'value_belief', 'cognitive_style', 'rule'"),
      layer: layerEnum.describe("L3 for core identity & safety-critical rules, L2 for preferences/values/normal rules"),
      key: z.string().min(1).describe("Stable key for this fact (e.g. 'name', 'allergy_food', 'before_leaving_home')"),
      value: z.string().min(1).describe("The fact / rule action / preference itself"),
      confidence: z.number().min(0).max(1).optional().describe("0..1 if inferred; omit for explicit user statement"),
      source_msg_id: z.string().optional().describe("Optional message id from search_messages that prompted this save"),
      importance: z.enum(['critical', 'normal']).optional().describe("Critical = safety-relevant (allergies, medical, legal). Default 'normal'."),
    },
    async (args) => {
      try { return ok(handlers.saveProfile(args)); } catch (err) { return fail(err); }
    }
  );

  const listProfileTool = tool(
    "list_profile",
    `List the user's stored profile entries (singleton facts, preferences, rules). Optionally filter by layer, category, or importance.
Examples:
  list_profile() → all profile entries
  list_profile({ layer: "L3" }) → core identity only
  list_profile({ category: "rule" }) → all rules
  list_profile({ importance: "critical" }) → only critical (safety-relevant) entries`,
    {
      layer: layerEnum.optional(),
      category: z.string().optional(),
      importance: z.enum(['critical', 'normal']).optional(),
    },
    async (args) => {
      try { return listOk(handlers.listProfile(args)); } catch (err) { return fail(err); }
    }
  );

  const saveJournalTool = tool(
    "save_journal",
    `Record a temporal observation about the user — emotion, life context, ongoing problem, dated event, or conversation summary.
Use 'status: "ongoing"' for situations user is dealing with right now (use resolve_journal later when done).
For trait/habit observations, use save_trait_observation instead.

Examples:
  save_journal({ type: "life_context", content: "Sedang mengurus dokumen imigrasi Korea", status: "ongoing" })
  save_journal({ type: "emotion", content: "User excited about new job offer", intensity: "high" })
  save_journal({ type: "event", content: "User mulai kerja di Samsung", event_date: "2026-06-01" })`,
    {
      type: journalTypeForSaveEnum.describe("Observation kind (use save_trait_observation for trait/habit observations)"),
      content: z.string().min(1).describe("What you're observing/recording"),
      status: journalStatusEnum.optional().describe("'ongoing' for active situations; omit for one-off"),
      intensity: intensityEnum.optional(),
      recurrence_count: z.number().int().min(1).optional().describe("How many times you've observed this (default 1)"),
      related_ids: z.array(z.string()).optional().describe("UUIDs of related memory entries"),
      event_date: z.string().optional().describe("ISO date YYYY-MM-DD (only for type='event')"),
      follow_up_needed: z.number().int().min(0).max(1).optional().describe("1 if needs future check-in"),
      source_msg_id: z.string().optional(),
    },
    async (args) => {
      try { return ok(handlers.saveJournal(args)); } catch (err) { return fail(err); }
    }
  );

  const saveTraitObservationTool = tool(
    "save_trait_observation",
    `Record an observation that suggests a personality trait or habit pattern.
These are free-form signals for later pattern recognition. When you see enough evidence
for a stable trait/pattern, promote it to a profile entry (category='cognitive_style' or
'value_belief') via save_profile — that's how persistent traits live now.

Examples:
  save_trait_observation({ content: "User mengoreksi detail kecil 3x dalam diskusi ini", inferred_trait: "perfeksionis", confidence: 0.7 })
  save_trait_observation({ content: "User selalu reschedule meeting di pagi hari", inferred_trait: "bukan morning person", confidence: 0.6 })`,
    {
      content: z.string().min(1).describe("The observed behavior"),
      inferred_trait: z.string().min(1).describe("Short label for the trait/habit you're inferring (e.g. 'perfeksionis')"),
      confidence: z.number().min(0).max(1).describe("0..1 — how confident is this inference"),
      related_ids: z.array(z.string()).optional(),
      source_msg_id: z.string().optional(),
    },
    async (args) => {
      try { return ok(handlers.saveTraitObservation(args)); } catch (err) { return fail(err); }
    }
  );

  const resolveJournalTool = tool(
    "resolve_journal",
    `Mark an ongoing journal entry as resolved (e.g., problem solved, event completed, aspiration achieved or abandoned).
Find the entry's id via search_memory first.

Examples:
  resolve_journal({ id: "uuid-of-ongoing-entry" })
  resolve_journal({ id: "uuid-of-event", outcome: "done" })
  resolve_journal({ id: "uuid-of-event", outcome: "missed" })`,
    {
      id: z.string().min(1).describe("Journal entry UUID"),
      outcome: eventOutcomeEnum.optional().describe("'done' or 'missed' — useful for events"),
    },
    async (args) => {
      try { return ok(handlers.resolveJournal(args.id, args.outcome)); } catch (err) { return fail(err); }
    }
  );

  const searchMemoryTool = tool(
    "search_memory",
    `Search the journal of memory observations for the current user. Uses SQLite FTS5 (BM25 ranked) on content + inferred_trait.

For listing profile/relationships, use the dedicated list_* tools instead.

Query syntax: 'koper' (keyword), 'koper pilox' (implicit AND), '"koper pilox"' (phrase),
'koper*' (prefix), 'koper OR ransel' (boolean), 'koper NOT hitam' (exclude).

Examples:
  search_memory({ query: "imigrasi" }) → all observations matching
  search_memory({ type: "problem", status: "ongoing" }) → all unresolved problems
  search_memory({ query: "perfeksionis", type: "trait_observation" }) → trait obs about perfectionism`,
    {
      query: z.string().optional().describe("FTS5 query (default order is 'relevant' when present)"),
      type: journalTypeFullEnum.optional(),
      status: journalStatusEnum.optional(),
      from_time: z.string().optional().describe("ISO 8601 start of range (inclusive)"),
      to_time: z.string().optional().describe("ISO 8601 end of range (exclusive)"),
      limit: z.number().int().min(1).max(100).optional().describe("default 20, max 100"),
      order: orderEnum.optional().describe("default 'relevant' if query present, else 'newest'"),
    },
    async (args) => {
      try {
        const filter = {
          query: args.query,
          type: args.type,
          status: args.status,
          fromTime: args.from_time ? parseIsoToMs(args.from_time) : undefined,
          toTime: args.to_time ? parseIsoToMs(args.to_time) : undefined,
          limit: args.limit,
          order: args.order,
        };
        return listOk(handlers.searchMemory(filter));
      } catch (err) { return fail(err); }
    }
  );

  const saveRelationshipTool = tool(
    "save_relationship",
    `Record or update a person in the user's life. Keyed by name — re-saving updates fields.

CIRCLE semantics (how close to user):
- "inner" — keluarga inti serumah / hampir tiap hari (istri, suami, anak, ortu serumah, saudara kandung). Always loaded in bundle.
- "extended_family" — saudara di luar inti (mertua, keponakan, sepupu, paman, bibi).
- "close" — sahabat, mentor, orang yang pengaruhi hidup signifikan.
- "casual" — kenalan, tetangga, kolega biasa, PIC transaksi.
- omit (null) — belum diketahui kedekatannya.

Examples:
  save_relationship({ name: "Budi", role: "atasan", circle: "casual" })
  save_relationship({ name: "Sari", role: "istri", circle: "inner" })
  save_relationship({ name: "Andi", role: "sahabat SMA", circle: "close", dynamic: "sering curhat" })`,
    {
      name: z.string().min(1).describe("Person's name (used as unique key)"),
      role: z.string().min(1).describe("Their role (atasan, teman, istri, anak, dokter, etc.)"),
      dynamic: z.string().optional().describe("Nature of the relationship dynamic"),
      circle: z.enum(['inner', 'extended_family', 'close', 'casual']).optional().describe("Closeness bucket (see tool description)"),
      related_ids: z.array(z.string()).optional(),
    },
    async (args) => {
      try { return ok(handlers.saveRelationship(args)); } catch (err) { return fail(err); }
    }
  );

  const listRelationshipsTool = tool(
    "list_relationships",
    `List all known people in the user's life.`,
    {},
    async () => {
      try { return listOk(handlers.listRelationships()); } catch (err) { return fail(err); }
    }
  );

  return createSdkMcpServer({
    name: "memory",
    version: "3.0.0",
    tools: [
      saveProfileTool, listProfileTool,
      saveJournalTool, saveTraitObservationTool, resolveJournalTool, searchMemoryTool,
      saveRelationshipTool, listRelationshipsTool,
    ],
  });
}
