import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Project root directory (absolute, independent of cwd)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PROJECT_DIR = join(__dirname, '..', '..');

// Timezone
export const TIMEZONE = 'Asia/Jakarta';

// WhatsApp JID
export const WA_JID_PERSONAL = '@c.us';
export const WA_JID_GROUP = '@g.us';
export const WA_STATUS_BROADCAST = 'status@broadcast';
export const WA_AUTH_PATH = join(PROJECT_DIR, '.wwebjs_auth');
export const WA_LOCK_FILES = [
  join(WA_AUTH_PATH, 'session', 'SingletonLock'),
  join(WA_AUTH_PATH, 'session', 'SingletonSocket'),
] as const;
export const WA_CHROME_KILL_PATTERN = `chrome.*${WA_AUTH_PATH}`;

// Phone number extraction regex
export const JID_SUFFIX_REGEX = /@.*$/;

// Database
export const DATA_DIR = join(PROJECT_DIR, 'data');
export const CRONJOBS_DB_PATH = join(DATA_DIR, 'cronjobs.db');
export const SESSIONS_DB_PATH = join(DATA_DIR, 'sessions.db');

// Memory Database (SurrealDB)
export const MEMORY_DB_PATH = join(DATA_DIR, 'memory.db');
export const MEMORY_DB_NAMESPACE = 'assistant';
export const MEMORY_DB_DATABASE = 'memory';
export const MEMORY_FUNDAMENTAL_LIMIT = 5;
export const MEMORY_DECAY_HALF_LIFE_DAYS = 30;
export const MEMORY_EMBEDDING_ENABLED = false;

// Importance auto-promotion/demotion thresholds (Phase 8.4)
export const MEMORY_PROMOTION_ACCESS_THRESHOLD = 5; // extended → fundamental when access_count >= this
export const MEMORY_DEMOTION_INACTIVE_DAYS = 30; // fundamental → extended when not accessed for this many days

// Hybrid search weights (Phase 8.3)
// When embeddings enabled: vector 0.5 + keyword 0.3 + recency 0.2
// When embeddings disabled: keyword 0.7 + recency 0.3 (existing behavior)
export const MEMORY_VECTOR_WEIGHT = 0.5;
export const MEMORY_KEYWORD_WEIGHT = 0.3;
export const MEMORY_RECENCY_WEIGHT = 0.2;

// Model
export const DEFAULT_MODEL = 'sonnet' as const;
export const FALLBACK_MODEL = 'haiku';

// Query
export const MAX_TURNS = 10;

// Memory flush heuristic (Phase 9)
// Inject a save-reminder when user message count in session reaches this threshold
export const MEMORY_FLUSH_TURN_THRESHOLD = 7; // ~70% of MAX_TURNS

// Typing simulation
export const TYPING_MS_PER_CHAR = 30;
export const MIN_TYPING_DURATION_MS = 1000;
export const MAX_TYPING_DURATION_MS = 8000;
export const MIN_PAUSE_BEFORE_TYPING_MS = 1000;
export const MAX_PAUSE_BEFORE_TYPING_MS = 10_000_000;

// Cost formatting
export const COST_USD_PRECISION = 4;

// Cronjob statuses
export const CronjobStatuses = {
  PENDING: 'PENDING',
  EXECUTING: 'EXECUTING',
  EXECUTED: 'EXECUTED',
  FAILED: 'FAILED',
  MISSED: 'MISSED',
  CANCELLED: 'CANCELLED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
} as const;

export const TERMINAL_CRONJOB_STATUSES = [
  CronjobStatuses.CANCELLED,
  CronjobStatuses.COMPLETED,
  CronjobStatuses.EXECUTED,
  CronjobStatuses.FAILED,
  CronjobStatuses.MISSED,
] as const;

// Media
export const MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
export const SUPPORTED_DOCUMENT_TYPES = new Set([
  'application/pdf',
]);

// Commands
export const CMD_NEW = '/new';
export const CMD_STATUS = '/status';
export const CMD_RESTART = '/restart';

// Restart flag
export const RESTART_FLAG_FILE = join(DATA_DIR, 'restart-flag.json');

// Internal trigger server (for Claude Code Stop hook notifications)
export const TRIGGER_PORT = 3100;
export const TRIGGER_HOST = '127.0.0.1';

export const allBuiltInTools = [
  'Task',            'Bash',
  'Glob',            'Grep',
  'ExitPlanMode',    'Read',
  'Edit',            'Write',
  'NotebookEdit',    'WebFetch',
  'TodoWrite',       'WebSearch',
  'BashOutput',      'KillShell',
  'Skill',           'SlashCommand',
  'EnterPlanMode',   'getDiagnostics',
  'executeCode',     'AgentOutputTool',
  'TaskOutput',      'TaskStop',
  'AskUserQuestion', 'ToolSearch',
];
