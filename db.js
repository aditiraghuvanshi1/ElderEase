'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

/* SCHEMA
   users          one row per person; role = elder | caretaker | family (volunteer helpers stay in the browser app)
   sessions       hashed session tokens (HttpOnly cookie on the client)
   care_links     "this member may see/help this elder": role caretaker = view + edit, family = view only
   invites        single-use passcodes an elder creates for family / caretakers (stored hashed, expire in 48 h)
   medications    + med_times (daily clock times) + a 7-char weekday mask
   dose_events    ONE ROW PER SCHEDULED DOSE: pending -> taken | skipped | missed, with who/when (adherence history)
   dose_audit     every status change is kept, so a correction never erases the original record
   appointments   stored in UTC, entered/shown in the elder's local time
   email_log      every reminder / alert / digest; dedupe_key UNIQUE means a restart can never send the same email twice
   login_attempts brute-force lockouts that survive restarts
   password_resets one-time reset links (only a SHA-256 of the token is stored), 30 minutes, single use */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('elder','caretaker','family')),
  age INTEGER,
  pass_hash TEXT NOT NULL,
  tz_offset_min INTEGER NOT NULL DEFAULT 330,
  email_reminders INTEGER NOT NULL DEFAULT 1,
  digest TEXT NOT NULL DEFAULT 'weekly' CHECK(digest IN ('off','daily','weekly')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts(
  key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locks INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS care_links(
  id INTEGER PRIMARY KEY,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('caretaker','family')),
  created_at TEXT NOT NULL,
  UNIQUE(elder_id, member_id)
);
CREATE TABLE IF NOT EXISTS invites(
  id INTEGER PRIMARY KEY,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('caretaker','family')),
  expires_at TEXT NOT NULL,
  used_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS medications(
  id INTEGER PRIMARY KEY,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, dose TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  days TEXT NOT NULL DEFAULT '1111111',
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS med_times(
  id INTEGER PRIMARY KEY,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  hhmm TEXT NOT NULL,
  UNIQUE(medication_id, hhmm)
);
CREATE TABLE IF NOT EXISTS dose_events(
  id INTEGER PRIMARY KEY,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  hhmm TEXT NOT NULL,
  due_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','taken','skipped','missed')),
  acted_at TEXT, acted_by INTEGER REFERENCES users(id), note TEXT NOT NULL DEFAULT '',
  UNIQUE(medication_id, local_date, hhmm)
);
CREATE INDEX IF NOT EXISTS idx_dose_elder_due ON dose_events(elder_id, due_at);
CREATE INDEX IF NOT EXISTS idx_dose_status_due ON dose_events(status, due_at);
CREATE TABLE IF NOT EXISTS dose_audit(
  id INTEGER PRIMARY KEY,
  dose_id INTEGER NOT NULL REFERENCES dose_events(id) ON DELETE CASCADE,
  old_status TEXT, new_status TEXT NOT NULL, by_user INTEGER, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments(
  id INTEGER PRIMARY KEY,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, doctor TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(starts_at);
CREATE TABLE IF NOT EXISTS password_resets(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_log(
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  elder_id INTEGER,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL, body_text TEXT NOT NULL, body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','dev','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, provider_id TEXT,
  created_at TEXT NOT NULL, sent_at TEXT
);
`;

function open(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);
    return db;
}
function tx(db, fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
module.exports = { open, tx };
