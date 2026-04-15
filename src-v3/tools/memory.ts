// src-v3/tools/memory.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  MemoryStore,
  ProfileRecord,
  JournalRecord,
  TraitRecord,
  RelationshipRecord,
  GoalRecord,
  Layer,
  JournalType,
  JournalStatus,
  Intensity,
  TraitType,
  GoalStatus,
  EventOutcome,
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
  promoted_to_trait_id: string | null;
  session_id: string | null;
  source_msg_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface TraitResult {
  id: string;
  type: TraitType;
  label: string;
  confidence: number;
  evidence_count: number;
  source_obs_ids: string[] | null;
  first_seen: string;
  last_confirmed: string;
}

export interface RelationshipResult {
  id: string;
  name: string;
  role: string;
  dynamic: string | null;
  related_ids: string[] | null;
  source_session_id: string | null;
  last_mentioned: string;
  created_at: string;
}

export interface GoalResult {
  id: string;
  title: string;
  category: string | null;
  status: GoalStatus;
  target_date: string | null;
  related_ids: string[] | null;
  source_session_id: string | null;
  created_at: string;
  last_updated: string;
}

// ── Sanitizers ──────────────────────────────────────────

function sanitizeProfile(r: ProfileRecord): ProfileResult {
  return {
    id: r.id, category: r.category, layer: r.layer, key: r.key, value: r.value,
    confidence: r.confidence, source_session_id: r.source_session_id, source_msg_id: r.source_msg_id,
    last_updated: toIsoJakarta(r.last_updated), created_at: toIsoJakarta(r.created_at),
  };
}

function sanitizeJournal(r: JournalRecord): JournalResult {
  return {
    id: r.id, type: r.type, content: r.content, status: r.status, intensity: r.intensity,
    recurrence_count: r.recurrence_count, related_ids: r.related_ids,
    event_date: r.event_date, event_outcome: r.event_outcome, follow_up_needed: r.follow_up_needed,
    inferred_trait: r.inferred_trait, confidence: r.confidence,
    promoted_to_trait_id: r.promoted_to_trait_id, session_id: r.session_id, source_msg_id: r.source_msg_id,
    created_at: toIsoJakarta(r.created_at),
    resolved_at: r.resolved_at !== null ? toIsoJakarta(r.resolved_at) : null,
  };
}

function sanitizeTrait(r: TraitRecord): TraitResult {
  return {
    id: r.id, type: r.type, label: r.label, confidence: r.confidence, evidence_count: r.evidence_count,
    source_obs_ids: r.source_obs_ids,
    first_seen: toIsoJakarta(r.first_seen), last_confirmed: toIsoJakarta(r.last_confirmed),
  };
}

function sanitizeRelationship(r: RelationshipRecord): RelationshipResult {
  return {
    id: r.id, name: r.name, role: r.role, dynamic: r.dynamic, related_ids: r.related_ids,
    source_session_id: r.source_session_id,
    last_mentioned: toIsoJakarta(r.last_mentioned), created_at: toIsoJakarta(r.created_at),
  };
}

function sanitizeGoal(r: GoalRecord): GoalResult {
  return {
    id: r.id, title: r.title, category: r.category, status: r.status, target_date: r.target_date,
    related_ids: r.related_ids, source_session_id: r.source_session_id,
    created_at: toIsoJakarta(r.created_at), last_updated: toIsoJakarta(r.last_updated),
  };
}

// ── Handlers interface ──────────────────────────────────

export interface MemoryHandlers {
  saveProfile(rec: {
    category: string; layer: Layer; key: string; value: string;
    confidence?: number; source_msg_id?: string;
  }): ProfileResult;
  listProfile(opts?: { layer?: Layer; category?: string }): ProfileResult[];

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

  promoteTrait(args: {
    label: string;
    type: TraitType;
    confidenceMode?: 'avg' | 'max';
  }): TraitResult & { aggregated_from: number };

  listTraits(): TraitResult[];

  saveRelationship(rec: {
    name: string; role: string; dynamic?: string; related_ids?: string[];
  }): RelationshipResult;
  listRelationships(): RelationshipResult[];

  saveGoal(rec: {
    title: string; category?: string; status?: GoalStatus;
    target_date?: string; related_ids?: string[];
  }): GoalResult;
  updateGoalStatus(id: string, status: GoalStatus): { updated: boolean };
  listGoals(opts?: { status?: GoalStatus }): GoalResult[];
}

// ── promote_trait orchestration helper ──────────────────

export function promoteTraitImpl(
  store: MemoryStore,
  userId: string,
  args: { label: string; type: TraitType; confidenceMode?: 'avg' | 'max' }
): TraitResult & { aggregated_from: number } {
  const candidates = store.searchJournal({
    userId, type: 'trait_observation', limit: 100,
  });
  const obs = candidates.filter(
    o => o.inferred_trait === args.label && o.promoted_to_trait_id === null
  );

  if (obs.length === 0) {
    throw new Error(`No unpromoted observations found for trait '${args.label}'`);
  }

  const mode = args.confidenceMode ?? 'avg';
  const confidences = obs.map(o => o.confidence ?? 0);
  const aggConfidence = mode === 'max'
    ? Math.max(...confidences)
    : confidences.reduce((a, b) => a + b, 0) / confidences.length;

  const trait = store.upsertTrait({
    user_id: userId, type: args.type, label: args.label,
    confidence: aggConfidence, evidence_count: obs.length,
    source_obs_ids: obs.map(o => o.id),
  });

  store.linkObservationsToTrait(obs.map(o => o.id), trait.id);

  return { ...sanitizeTrait(trait), aggregated_from: obs.length };
}

// ── Build factory of MemoryHandlers from MemoryStore ────

export function buildMemoryHandlers(
  store: MemoryStore,
  userId: string,
  sessionId: string | null
): MemoryHandlers {
  return {
    saveProfile: (rec) => sanitizeProfile(store.upsertProfile({
      user_id: userId,
      category: rec.category, layer: rec.layer, key: rec.key, value: rec.value,
      confidence: rec.confidence ?? null,
      source_session_id: sessionId,
      source_msg_id: rec.source_msg_id ?? null,
    })),

    listProfile: (opts) => store.listProfile(userId, opts).map(sanitizeProfile),

    saveJournal: (rec) => sanitizeJournal(store.insertJournal({
      user_id: userId,
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
      promoted_to_trait_id: null,
      session_id: sessionId,
      source_msg_id: rec.source_msg_id ?? null,
      resolved_at: null,
    })),

    saveTraitObservation: (rec) => sanitizeJournal(store.insertJournal({
      user_id: userId,
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
      promoted_to_trait_id: null,
      session_id: sessionId,
      source_msg_id: rec.source_msg_id ?? null,
      resolved_at: null,
    })),

    resolveJournal: (id, outcome) => ({ resolved: store.resolveJournal(id, outcome ?? null) }),

    searchMemory: (filter) => store.searchJournal({ ...filter, userId }).map(sanitizeJournal),

    promoteTrait: (args) => promoteTraitImpl(store, userId, args),

    listTraits: () => store.listTraits(userId).map(sanitizeTrait),

    saveRelationship: (rec) => sanitizeRelationship(store.upsertRelationship({
      user_id: userId,
      name: rec.name, role: rec.role,
      dynamic: rec.dynamic ?? null,
      related_ids: rec.related_ids ?? null,
      source_session_id: sessionId,
    })),

    listRelationships: () => store.listRelationships(userId).map(sanitizeRelationship),

    saveGoal: (rec) => sanitizeGoal(store.insertGoal({
      user_id: userId,
      title: rec.title,
      category: rec.category ?? null,
      status: rec.status ?? 'active',
      target_date: rec.target_date ?? null,
      related_ids: rec.related_ids ?? null,
      source_session_id: sessionId,
    })),

    updateGoalStatus: (id, status) => ({ updated: store.updateGoalStatus(id, status) }),

    listGoals: (opts) => store.listGoals(userId, opts).map(sanitizeGoal),
  };
}

// ── Zod enums ───────────────────────────────────────────

const layerEnum = z.enum(['L2', 'L3']);
const journalTypeForSaveEnum = z.enum(['emotion', 'life_context', 'problem', 'event', 'conversation_summary']);
const journalTypeFullEnum = z.enum(['emotion', 'life_context', 'problem', 'event', 'conversation_summary', 'trait_observation']);
const journalStatusEnum = z.enum(['ongoing', 'resolved']);
const intensityEnum = z.enum(['low', 'medium', 'high']);
const traitTypeEnum = z.enum(['trait', 'habit']);
const goalStatusEnum = z.enum(['active', 'completed', 'abandoned']);
const eventOutcomeEnum = z.enum(['done', 'missed']);
const goalCategoryEnum = z.enum(['career', 'health', 'finance', 'education', 'personal', 'family']);
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
    `Save or update a singleton fact about the user (identity, location, preference, value/belief, cognitive style).
Profile is keyed by (category, key) — re-saving with same key updates the value.

Layer L3 = core identity (name, language, dob, location). Layer L2 = preferences/values/style.

Examples:
  save_profile({ category: "identity", layer: "L3", key: "name", value: "Mirza" })
  save_profile({ category: "preference", layer: "L2", key: "communication_style", value: "direct, no fluff", confidence: 0.9 })`,
    {
      category: z.string().min(1).describe("e.g. 'identity', 'location', 'preference', 'value_belief', 'cognitive_style'"),
      layer: layerEnum.describe("L3 for core identity, L2 for preferences/values"),
      key: z.string().min(1).describe("Stable key for this fact (e.g. 'name', 'language', 'communication_style')"),
      value: z.string().min(1).describe("The fact itself"),
      confidence: z.number().min(0).max(1).optional().describe("0..1 if inferred; omit for explicit user statement"),
      source_msg_id: z.string().optional().describe("Optional message id from search_messages that prompted this save"),
    },
    async (args) => {
      try { return ok(handlers.saveProfile(args)); } catch (err) { return fail(err); }
    }
  );

  const listProfileTool = tool(
    "list_profile",
    `List the user's stored profile entries (singleton facts). Optionally filter by layer or category.
Examples:
  list_profile() → all profile entries
  list_profile({ layer: "L3" }) → core identity only
  list_profile({ category: "preference" }) → preferences only`,
    {
      layer: layerEnum.optional(),
      category: z.string().optional(),
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
    `Record an observation that suggests a personality trait or habit. Use this BEFORE the trait is consolidated.
Multiple observations of the same inferred_trait can later be promoted into a 'traits' entry via promote_trait.

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
    `Mark an ongoing journal entry as resolved (e.g., problem solved, event completed).
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

For listing profile/traits/relationships/goals, use the dedicated list_* tools instead.

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

  const promoteTraitTool = tool(
    "promote_trait",
    `Consolidate multiple trait_observation entries with the same inferred_trait into a single traits entry.
Use this when you've seen enough evidence (e.g., 3+ observations) to confirm a trait.

Examples:
  promote_trait({ label: "perfeksionis", type: "trait" })
  promote_trait({ label: "morning routine: olahraga jam 6", type: "habit", confidenceMode: "max" })`,
    {
      label: z.string().min(1).describe("inferred_trait label to promote (must match observation rows exactly)"),
      type: traitTypeEnum.describe("'trait' (personality) or 'habit' (recurring behavior)"),
      confidenceMode: z.enum(['avg', 'max']).optional().describe("How to aggregate confidences (default 'avg')"),
    },
    async (args) => {
      try { return ok(handlers.promoteTrait(args)); } catch (err) { return fail(err); }
    }
  );

  const listTraitsTool = tool(
    "list_traits",
    `List all distilled traits and habits for the user.
Examples:
  list_traits() → all`,
    {},
    async () => {
      try { return listOk(handlers.listTraits()); } catch (err) { return fail(err); }
    }
  );

  const saveRelationshipTool = tool(
    "save_relationship",
    `Record or update a person in the user's life. Keyed by name — re-saving updates fields.

Examples:
  save_relationship({ name: "Budi", role: "atasan", dynamic: "memberi banyak guidance" })
  save_relationship({ name: "Sari", role: "istri" })`,
    {
      name: z.string().min(1).describe("Person's name (used as unique key)"),
      role: z.string().min(1).describe("Their role (atasan, teman, istri, anak, dokter, etc.)"),
      dynamic: z.string().optional().describe("Nature of the relationship dynamic"),
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

  const saveGoalTool = tool(
    "save_goal",
    `Record a goal/aspiration. Insert-only — use update_goal_status to change state.

Examples:
  save_goal({ title: "Pindah kerja ke Samsung Busan", category: "career", target_date: "2026-06-01" })
  save_goal({ title: "Olahraga rutin 3x seminggu", category: "health" })`,
    {
      title: z.string().min(1),
      category: goalCategoryEnum.optional(),
      status: goalStatusEnum.optional().describe("default 'active'"),
      target_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
      related_ids: z.array(z.string()).optional(),
    },
    async (args) => {
      try { return ok(handlers.saveGoal(args)); } catch (err) { return fail(err); }
    }
  );

  const updateGoalStatusTool = tool(
    "update_goal_status",
    `Update a goal's status. Use 'completed' when achieved, 'abandoned' when no longer pursued.

Examples:
  update_goal_status({ id: "uuid", status: "completed" })
  update_goal_status({ id: "uuid", status: "abandoned" })`,
    {
      id: z.string().min(1),
      status: goalStatusEnum,
    },
    async (args) => {
      try { return ok(handlers.updateGoalStatus(args.id, args.status)); } catch (err) { return fail(err); }
    }
  );

  const listGoalsTool = tool(
    "list_goals",
    `List user's goals. Optionally filter by status.
Examples:
  list_goals() → all
  list_goals({ status: "active" }) → only active goals`,
    {
      status: goalStatusEnum.optional(),
    },
    async (args) => {
      try { return listOk(handlers.listGoals(args)); } catch (err) { return fail(err); }
    }
  );

  return createSdkMcpServer({
    name: "memory",
    version: "2.0.0",
    tools: [
      saveProfileTool, listProfileTool,
      saveJournalTool, saveTraitObservationTool, resolveJournalTool, searchMemoryTool,
      promoteTraitTool, listTraitsTool,
      saveRelationshipTool, listRelationshipsTool,
      saveGoalTool, updateGoalStatusTool, listGoalsTool,
    ],
  });
}
