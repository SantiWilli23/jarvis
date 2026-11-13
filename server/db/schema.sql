CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'dueno',
  password_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'web',
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at INTEGER,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  key TEXT NOT NULL,
  ok INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_key ON login_attempts(key, created_at);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'usuario',
  status TEXT NOT NULL DEFAULT 'activa',
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  raw_text BLOB NOT NULL,
  raw_sha256 TEXT NOT NULL,
  header_json TEXT NOT NULL DEFAULT '{}',
  prepared_json TEXT,
  review_first INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at INTEGER,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_seq ON tasks(user_id, status, seq);
CREATE TABLE IF NOT EXISTS task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente',
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_usage (
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  window_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider, window_key)
);
CREATE TABLE IF NOT EXISTS provider_state (
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  paused_until INTEGER,
  last_error TEXT,
  headers_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS claude_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER,
  day TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS phone_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  args_json TEXT,
  status TEXT NOT NULL,
  approval_id INTEGER,
  result TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_phone_actions_user_status ON phone_actions (user_id, status, id);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id INTEGER,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Modo Pro (chat de tres: usuario, Claude, Gemini). Ver docs/PRO.md.
CREATE TABLE IF NOT EXISTS pro_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nuevo hilo',
  repo TEXT,
  status TEXT NOT NULL DEFAULT 'abierto',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pro_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  round_id INTEGER,
  author TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'texto',
  text TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pro_messages_thread ON pro_messages (thread_id, id);
CREATE TABLE IF NOT EXISTS pro_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message_id INTEGER,
  task_kind TEXT,
  programmer TEXT,
  verifier TEXT,
  corrections INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planeando',
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pro_rounds_thread ON pro_rounds (thread_id, id);
CREATE TABLE IF NOT EXISTS pro_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT,
  repo TEXT,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'solo_lectura',
  status TEXT NOT NULL DEFAULT 'pendiente',
  tree_before TEXT,
  tree_after TEXT,
  diff TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pro_jobs_status ON pro_jobs (user_id, status);
CREATE TABLE IF NOT EXISTS pro_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'informe',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pro_reports_job ON pro_reports (job_id);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT,
  role TEXT,
  job_id INTEGER,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage (user_id, day, engine);
