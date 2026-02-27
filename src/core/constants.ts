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

// Model
export const DEFAULT_MODEL = 'sonnet' as const;
export const FALLBACK_MODEL = 'haiku';

// Query
export const MAX_TURNS = 10;

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
