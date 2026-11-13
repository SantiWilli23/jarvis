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
