// ============================================================
// contextStore.ts — durable conversation transcript (SQLite)
//
// Persists finalized user/assistant turns so the conversation survives a
// disconnect or a server restart. Audio is NEVER written here — only the text
// of what was said, per the privacy stance (PRD §1.3, revised by D10).
//
// better-sqlite3 is loaded with a dynamic require inside a try/catch so the
// build, the tests, and a fresh checkout without the native module still run:
// if it is missing (or fails to load), the store disables itself and every
// call becomes a no-op. Whisper → LLM → TTS is unaffected. This mirrors the
// graceful-disable pattern used for the optional Vosk subprocess.
//
// Install on real hardware:  npm install better-sqlite3
// ============================================================

// ── Minimal structural types for the slice of better-sqlite3 we use ──
interface PreparedStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface SqliteDb {
  pragma(source: string): unknown;
  exec(sql: string): unknown;
  prepare(sql: string): PreparedStatement;
}
type SqliteCtor = new (path: string) => SqliteDb;

/** One persisted line of conversation. `role` is only ever user or assistant —
 *  system prompts and tool results are not part of the readable transcript. */
export interface PersistedTurn {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  session_id: string;
  ts: number;
}

export interface PersistedSummary {
  text: string;
  covers_up_to_turn: number;
}

/** One study session: a conversation in one language, resumable later. */
export interface SessionRecord {
  id: string;
  /** Generated from the conversation ('auto') or typed by the student ('user'). */
  title: string | null;
  title_source: 'auto' | 'user' | null;
  group_id: string | null;
  language: string;
  voice: string | null;
  grade: string | null;
  board: string | null;
  /** 'topic' (a syllabus topic id in study_ref) or 'open' (a category id); null for a plain session. */
  study_kind: string | null;
  study_ref: string | null;
  created_ts: number;
  updated_ts: number;
}

export interface SessionListItem extends SessionRecord {
  turn_count: number;
  /** The most recent line said in the session, for the list preview. */
  last_text: string | null;
}

/** A student-made folder of sessions. */
export interface SessionGroup {
  id: string;
  name: string;
  created_ts: number;
  updated_ts: number;
}

export interface SessionMeta {
  id: string;
  /** Only applied when the session row is first created. */
  groupId?: string | null;
  language: string;
  voice?: string;
  grade?: string;
  board?: string;
  /** Only applied when the session row is first created. */
  studyKind?: string;
  studyRef?: string;
}

const TITLE_MAX = 80;
const GROUP_NAME_MAX = 60;

// ── Singleton state ───────────────────────────────────────────
let db: SqliteDb | null = null;
let enabled = false;
let initialized = false;

/** How many of the most-recent turns to load for the history sidebar on
 *  connect. Bounds the payload so a long-lived transcript never blows up the
 *  handshake; 400 ≈ 200 exchanges, far more than a voice session needs. */
const HISTORY_LOAD_LIMIT = 400;

/**
 * Open (or create) the transcript database. Idempotent. Safe to call when the
 * native module is absent — it just leaves the store disabled.
 */
export function initContextStore(dbPath = process.env.VANI_DB_PATH ?? 'data/vani.db'): boolean {
  if (initialized) return enabled;
  initialized = true;

  try {
    const Database = require('better-sqlite3') as SqliteCtor;
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    const dir = path.dirname(dbPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(
      `CREATE TABLE IF NOT EXISTS turns (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT    NOT NULL,
        role       TEXT    NOT NULL,
        content    TEXT    NOT NULL,
        ts         INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS summary (
        id                 INTEGER PRIMARY KEY CHECK(id=1),
        text               TEXT    NOT NULL,
        updated_ts         INTEGER NOT NULL,
        covers_up_to_turn  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT    PRIMARY KEY,
        title         TEXT,
        language      TEXT    NOT NULL,
        voice         TEXT,
        grade         TEXT,
        board         TEXT,
        summary       TEXT,
        summary_upto  INTEGER NOT NULL DEFAULT 0,
        created_ts    INTEGER NOT NULL,
        updated_ts    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS turns_by_session ON turns (session_id, id);`
    );
    // Columns added after the sessions table first shipped.
    const cols = new Set((db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((c) => c.name));
    if (!cols.has('group_id')) db.exec('ALTER TABLE sessions ADD COLUMN group_id TEXT');
    if (!cols.has('title_source')) db.exec('ALTER TABLE sessions ADD COLUMN title_source TEXT');
    if (!cols.has('study_kind')) db.exec('ALTER TABLE sessions ADD COLUMN study_kind TEXT');
    if (!cols.has('study_ref')) db.exec('ALTER TABLE sessions ADD COLUMN study_ref TEXT');
    db.exec(
      `CREATE TABLE IF NOT EXISTS session_groups (
        id          TEXT    PRIMARY KEY,
        name        TEXT    NOT NULL,
        created_ts  INTEGER NOT NULL,
        updated_ts  INTEGER NOT NULL
      );`
    );
    // Phase 2 memory: structured per-session context and the global learner profile.
    db.exec(
      `CREATE TABLE IF NOT EXISTS session_context (
        session_id    TEXT    PRIMARY KEY,
        data          TEXT    NOT NULL,
        upto_turn_id  INTEGER NOT NULL DEFAULT 0,
        updated_ts    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notebooks (
        session_id    TEXT    PRIMARY KEY,
        enabled       INTEGER NOT NULL DEFAULT 1,
        doc           TEXT    NOT NULL,
        upto_turn_id  INTEGER NOT NULL DEFAULT 0,
        updated_ts    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learner_profile (
        key                TEXT    PRIMARY KEY,
        value              TEXT    NOT NULL,
        updated_ts         INTEGER NOT NULL,
        source_session_id  TEXT
      );`
    );
    // Earlier rolling summaries become the gist of the structured session memory.
    db.exec(
      `INSERT OR IGNORE INTO session_context (session_id, data, upto_turn_id, updated_ts)
       SELECT id, json_object('gist', summary), summary_upto, updated_ts
         FROM sessions WHERE summary IS NOT NULL AND summary <> '';`
    );
    // Backfill: turns recorded before sessions existed get a session row each
    // (one per old connection). Untitled — the titler names them from content.
    db.exec(
      `INSERT OR IGNORE INTO sessions (id, language, created_ts, updated_ts)
       SELECT session_id, 'en', MIN(ts), MAX(ts) FROM turns GROUP BY session_id;`
    );
    enabled = true;
    console.log(`[context] transcript store ready at ${dbPath}`);
  } catch (err) {
    enabled = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[context] transcript store disabled — conversation history will not persist. ` +
        `Install it with \`npm install better-sqlite3\`. (${msg})`,
    );
  }
  return enabled;
}

/** True when turns are actually being persisted. */
export function isContextStoreEnabled(): boolean {
  return enabled;
}

/**
 * Append one finalized turn. No-op when the store is disabled. Never throws —
 * a persistence failure must not take down the live conversation.
 */
export function appendTurn(sessionId: string, role: 'user' | 'assistant', content: string): void {
  if (!enabled || !db) return;
  const text = content.trim();
  if (!text) return;
  try {
    db.prepare('INSERT INTO turns (session_id, role, content, ts) VALUES (?, ?, ?, ?)').run(
      sessionId,
      role,
      text,
      Date.now(),
    );
  } catch (err) {
    console.error(`[context] failed to append ${role} turn:`, err);
  }
}

/**
 * The most-recent turns in chronological order (oldest first), ready to send to
 * a freshly connected client for the history sidebar. Empty when disabled.
 */
export function loadRecentTurns(limit = HISTORY_LOAD_LIMIT): PersistedTurn[] {
  if (!enabled || !db) return [];
  try {
    const rows = db
      .prepare('SELECT session_id, role, content, ts FROM turns ORDER BY id DESC LIMIT ?')
      .all(limit) as PersistedTurn[];
    return rows.reverse();
  } catch (err) {
    console.error('[context] failed to load turns:', err);
    return [];
  }
}

// ── Sessions ──────────────────────────────────────────────────

/**
 * Create the session row if needed and record its current settings. Called when
 * the first turn of a session is stored (so sessions nobody spoke in are not
 * kept) and whenever its voice/class/board change.
 */
export function upsertSession(meta: SessionMeta): void {
  if (!enabled || !db) return;
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO sessions (id, group_id, language, voice, grade, board, study_kind, study_ref, created_ts, updated_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         language = excluded.language, voice = excluded.voice,
         grade = excluded.grade, board = excluded.board, updated_ts = excluded.updated_ts`,
    ).run(
      meta.id,
      meta.groupId && getGroup(meta.groupId) ? meta.groupId : null,
      meta.language, meta.voice ?? null, meta.grade ?? null, meta.board ?? null,
      meta.studyKind ?? null, meta.studyRef ?? null, now, now,
    );
  } catch (err) {
    console.error('[context] failed to upsert session:', err);
  }
}

/** Mark activity. */
export function touchSession(id: string): void {
  if (!enabled || !db) return;
  try {
    db.prepare('UPDATE sessions SET updated_ts = ? WHERE id = ?').run(Date.now(), id);
  } catch (err) {
    console.error('[context] failed to touch session:', err);
  }
}

/**
 * Set a session's title. An 'auto' title never replaces one the student typed.
 * Returns whether the title changed.
 */
export function setSessionTitle(id: string, title: string, source: 'auto' | 'user'): boolean {
  if (!enabled || !db) return false;
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!clean) return false;
  try {
    const guard = source === 'auto' ? " AND COALESCE(title_source, '') <> 'user'" : '';
    const r = db.prepare(`UPDATE sessions SET title = ?, title_source = ? WHERE id = ?${guard}`).run(clean, source, id) as { changes: number };
    return r.changes > 0;
  } catch (err) {
    console.error('[context] failed to set session title:', err);
    return false;
  }
}

/** Number of stored turns in a session. */
export function countSessionTurns(id: string): number {
  if (!enabled || !db) return 0;
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM turns WHERE session_id = ?').get(id) as { n: number }).n;
  } catch {
    return 0;
  }
}

/** Sessions that have been spoken in but never titled from their content. */
export function sessionsNeedingTitle(limit = 30): string[] {
  if (!enabled || !db) return [];
  try {
    return (
      db
        .prepare(
          `SELECT s.id FROM sessions s
            WHERE s.title_source IS NULL
              AND (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) >= 2
            ORDER BY s.updated_ts DESC LIMIT ?`,
        )
        .all(limit) as Array<{ id: string }>
    ).map((r) => r.id);
  } catch (err) {
    console.error('[context] failed to find untitled sessions:', err);
    return [];
  }
}

/** Put a session in a group, or take it out (null). False if either does not exist. */
export function moveSession(id: string, groupId: string | null): boolean {
  if (!enabled || !db) return false;
  if (groupId !== null && !getGroup(groupId)) return false;
  try {
    const r = db.prepare('UPDATE sessions SET group_id = ? WHERE id = ?').run(groupId, id) as { changes: number };
    return r.changes > 0;
  } catch (err) {
    console.error('[context] failed to move session:', err);
    return false;
  }
}

/** Delete a session and everything said in it. */
export function deleteSession(id: string): boolean {
  if (!enabled || !db) return false;
  try {
    db.prepare('DELETE FROM turns WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM session_context WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM notebooks WHERE session_id = ?').run(id);
    const r = db.prepare('DELETE FROM sessions WHERE id = ?').run(id) as { changes: number };
    return r.changes > 0;
  } catch (err) {
    console.error('[context] failed to delete session:', err);
    return false;
  }
}

// ── Groups ────────────────────────────────────────────────────

export function listGroups(): SessionGroup[] {
  if (!enabled || !db) return [];
  try {
    return db.prepare('SELECT id, name, created_ts, updated_ts FROM session_groups ORDER BY name COLLATE NOCASE').all() as SessionGroup[];
  } catch (err) {
    console.error('[context] failed to list groups:', err);
    return [];
  }
}

export function getGroup(id: string): SessionGroup | null {
  if (!enabled || !db) return null;
  try {
    return (db.prepare('SELECT id, name, created_ts, updated_ts FROM session_groups WHERE id = ?').get(id) as SessionGroup | undefined) ?? null;
  } catch {
    return null;
  }
}

export function createGroup(id: string, name: string): SessionGroup | null {
  if (!enabled || !db) return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_MAX);
  if (!clean) return null;
  const now = Date.now();
  try {
    db.prepare('INSERT INTO session_groups (id, name, created_ts, updated_ts) VALUES (?, ?, ?, ?)').run(id, clean, now, now);
    return { id, name: clean, created_ts: now, updated_ts: now };
  } catch (err) {
    console.error('[context] failed to create group:', err);
    return null;
  }
}

export function renameGroup(id: string, name: string): boolean {
  if (!enabled || !db) return false;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_MAX);
  if (!clean) return false;
  try {
    const r = db.prepare('UPDATE session_groups SET name = ?, updated_ts = ? WHERE id = ?').run(clean, Date.now(), id) as { changes: number };
    return r.changes > 0;
  } catch (err) {
    console.error('[context] failed to rename group:', err);
    return false;
  }
}

/** Delete a group. Its sessions are kept and become ungrouped. */
export function deleteGroup(id: string): boolean {
  if (!enabled || !db) return false;
  try {
    db.prepare('UPDATE sessions SET group_id = NULL WHERE group_id = ?').run(id);
    const r = db.prepare('DELETE FROM session_groups WHERE id = ?').run(id) as { changes: number };
    return r.changes > 0;
  } catch (err) {
    console.error('[context] failed to delete group:', err);
    return false;
  }
}

export function getSession(id: string): SessionRecord | null {
  if (!enabled || !db) return null;
  try {
    const row = db
      .prepare('SELECT id, title, title_source, group_id, language, voice, grade, board, study_kind, study_ref, created_ts, updated_ts FROM sessions WHERE id = ?')
      .get(id) as SessionRecord | undefined;
    return row ?? null;
  } catch (err) {
    console.error('[context] failed to get session:', err);
    return null;
  }
}

/** Sessions with at least one turn, most recently active first. */
export function listSessions(limit = 200): SessionListItem[] {
  if (!enabled || !db) return [];
  try {
    return db
      .prepare(
        `SELECT s.id, s.title, s.title_source, s.group_id, s.language, s.voice, s.grade, s.board, s.study_kind, s.study_ref, s.created_ts, s.updated_ts,
                (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turn_count,
                (SELECT substr(content, 1, 140) FROM turns t WHERE t.session_id = s.id ORDER BY t.id DESC LIMIT 1) AS last_text
           FROM sessions s
          WHERE EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id)
          ORDER BY s.updated_ts DESC
          LIMIT ?`,
      )
      .all(limit) as SessionListItem[];
  } catch (err) {
    console.error('[context] failed to list sessions:', err);
    return [];
  }
}

/** The latest `limit` turns of one session, oldest first. */
export function loadSessionTurns(sessionId: string, limit = HISTORY_LOAD_LIMIT): PersistedTurn[] {
  if (!enabled || !db) return [];
  try {
    const rows = db
      .prepare('SELECT id, session_id, role, content, ts FROM turns WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit) as PersistedTurn[];
    return rows.reverse();
  } catch (err) {
    console.error('[context] failed to load session turns:', err);
    return [];
  }
}

// ── Per-session rolling summary ───────────────────────────────

export function getSessionSummary(sessionId: string): PersistedSummary | null {
  if (!enabled || !db) return null;
  try {
    const row = db
      .prepare('SELECT summary AS text, summary_upto AS covers_up_to_turn FROM sessions WHERE id = ?')
      .get(sessionId) as { text: string | null; covers_up_to_turn: number } | undefined;
    return row && row.text ? { text: row.text, covers_up_to_turn: row.covers_up_to_turn } : null;
  } catch (err) {
    console.error('[context] failed to get session summary:', err);
    return null;
  }
}

export function updateSessionSummary(sessionId: string, text: string, coversUpToTurn: number): void {
  if (!enabled || !db) return;
  try {
    db.prepare('UPDATE sessions SET summary = ?, summary_upto = ? WHERE id = ?').run(text, coversUpToTurn, sessionId);
  } catch (err) {
    console.error('[context] failed to update session summary:', err);
  }
}

/** Turns of a session with id > afterTurnId, oldest first. */
export function getUnsummarizedSessionTurns(sessionId: string, afterTurnId: number, limit = 50): PersistedTurn[] {
  if (!enabled || !db) return [];
  try {
    return db
      .prepare('SELECT id, session_id, role, content, ts FROM turns WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(sessionId, afterTurnId, limit) as PersistedTurn[];
  } catch (err) {
    console.error('[context] failed to get unsummarized turns:', err);
    return [];
  }
}

// ── Structured session memory (JSON; validated in memory/sessionMemory.ts) ──

export interface SessionContextRow {
  data: string;
  upto_turn_id: number;
  updated_ts: number;
}

export function getSessionContextRow(sessionId: string): SessionContextRow | null {
  if (!enabled || !db) return null;
  try {
    return (
      (db
        .prepare('SELECT data, upto_turn_id, updated_ts FROM session_context WHERE session_id = ?')
        .get(sessionId) as SessionContextRow | undefined) ?? null
    );
  } catch (err) {
    console.error('[context] failed to read session context:', err);
    return null;
  }
}

export function saveSessionContextRow(sessionId: string, data: string, uptoTurnId: number): void {
  if (!enabled || !db) return;
  try {
    db.prepare(
      `INSERT INTO session_context (session_id, data, upto_turn_id, updated_ts) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, upto_turn_id = excluded.upto_turn_id, updated_ts = excluded.updated_ts`,
    ).run(sessionId, data, uptoTurnId, Date.now());
  } catch (err) {
    console.error('[context] failed to save session context:', err);
  }
}

/** Turns of a session with id > afterTurnId, oldest first. */
export function getSessionTurnsAfter(sessionId: string, afterTurnId: number, limit = 50): PersistedTurn[] {
  return getUnsummarizedSessionTurns(sessionId, afterTurnId, limit);
}

/** The most recently active other sessions, for "earlier sessions" context. */
export function recentOtherSessions(excludeId: string, limit = 5): Array<{ id: string; title: string; language: string }> {
  if (!enabled || !db) return [];
  try {
    return db
      .prepare(
        `SELECT id, title, language FROM sessions
          WHERE id <> ? AND title IS NOT NULL AND title <> ''
          ORDER BY updated_ts DESC LIMIT ?`,
      )
      .all(excludeId, limit) as Array<{ id: string; title: string; language: string }>;
  } catch (err) {
    console.error('[context] failed to list recent sessions:', err);
    return [];
  }
}

// ── Global learner profile (validated in memory/learnerProfile.ts) ──

export interface ProfileRow {
  key: string;
  value: string;
  updated_ts: number;
  source_session_id: string | null;
}

export function listProfileRows(): ProfileRow[] {
  if (!enabled || !db) return [];
  try {
    return db.prepare('SELECT key, value, updated_ts, source_session_id FROM learner_profile ORDER BY key').all() as ProfileRow[];
  } catch (err) {
    console.error('[context] failed to read learner profile:', err);
    return [];
  }
}

export function upsertProfileRow(key: string, value: string, sessionId: string | null): void {
  if (!enabled || !db) return;
  try {
    db.prepare(
      `INSERT INTO learner_profile (key, value, updated_ts, source_session_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ts = excluded.updated_ts,
         source_session_id = excluded.source_session_id`,
    ).run(key, value, Date.now(), sessionId);
  } catch (err) {
    console.error('[context] failed to save profile fact:', err);
  }
}

export function deleteProfileRow(key: string): boolean {
  if (!enabled || !db) return false;
  try {
    return (db.prepare('DELETE FROM learner_profile WHERE key = ?').run(key) as { changes: number }).changes > 0;
  } catch (err) {
    console.error('[context] failed to delete profile fact:', err);
    return false;
  }
}

export function clearProfile(): void {
  if (!enabled || !db) return;
  try {
    db.exec('DELETE FROM learner_profile');
  } catch (err) {
    console.error('[context] failed to clear profile:', err);
  }
}

// ── Settings (meta table) ─────────────────────────────────────

export function getMeta(key: string): string | null {
  if (!enabled || !db) return null;
  try {
    return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  } catch {
    return null;
  }
}

export function setMeta(key: string, value: string): void {
  if (!enabled || !db) return;
  try {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  } catch (err) {
    console.error('[context] failed to save setting:', err);
  }
}

// ── Notebooks (JSON; validated in notes/notebook.ts) ───────────

export interface NotebookRow {
  enabled: number;
  doc: string;
  upto_turn_id: number;
  updated_ts: number;
}

export function getNotebookRow(sessionId: string): NotebookRow | null {
  if (!enabled || !db) return null;
  try {
    return (
      (db.prepare('SELECT enabled, doc, upto_turn_id, updated_ts FROM notebooks WHERE session_id = ?').get(sessionId) as
        | NotebookRow
        | undefined) ?? null
    );
  } catch (err) {
    console.error('[context] failed to read notebook:', err);
    return null;
  }
}

export function saveNotebookRow(sessionId: string, isEnabled: boolean, doc: string, uptoTurnId: number): void {
  if (!enabled || !db) return;
  try {
    db.prepare(
      `INSERT INTO notebooks (session_id, enabled, doc, upto_turn_id, updated_ts) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET enabled = excluded.enabled, doc = excluded.doc,
         upto_turn_id = excluded.upto_turn_id, updated_ts = excluded.updated_ts`,
    ).run(sessionId, isEnabled ? 1 : 0, doc, uptoTurnId, Date.now());
  } catch (err) {
    console.error('[context] failed to save notebook:', err);
  }
}
