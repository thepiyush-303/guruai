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
      );`
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

/**
 * Returns the current rolling summary if one exists.
 */
export function getSummary(): PersistedSummary | null {
  if (!enabled || !db) return null;
  try {
    const row = db.prepare('SELECT text, covers_up_to_turn FROM summary WHERE id = 1').get() as PersistedSummary | undefined;
    return row ?? null;
  } catch (err) {
    console.error('[context] failed to get summary:', err);
    return null;
  }
}

/**
 * Upserts the rolling summary.
 */
export function updateSummary(text: string, coversUpToTurn: number): void {
  if (!enabled || !db) return;
  try {
    db.prepare(`
      INSERT INTO summary (id, text, updated_ts, covers_up_to_turn) 
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        text = excluded.text, 
        updated_ts = excluded.updated_ts, 
        covers_up_to_turn = excluded.covers_up_to_turn
    `).run(text, Date.now(), coversUpToTurn);
  } catch (err) {
    console.error('[context] failed to update summary:', err);
  }
}

/**
 * Gets turns that occur strictly after \`afterTurnId\`.
 */
export function getUnsummarizedTurns(afterTurnId: number, limit = 50): PersistedTurn[] {
  if (!enabled || !db) return [];
  try {
    const rows = db
      .prepare('SELECT id, session_id, role, content, ts FROM turns WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(afterTurnId, limit) as PersistedTurn[];
    return rows;
  } catch (err) {
    console.error('[context] failed to get unsummarized turns:', err);
    return [];
  }
}

/**
 * Gets the maximum turn ID in the db, used to check if summarizer needs to run.
 * Returns the highest autoincrement `id`, not a count — safe even if rows are deleted.
 */
export function getMaxTurnId(): number {
  if (!enabled || !db) return 0;
  try {
    const row = db.prepare('SELECT COALESCE(MAX(id), 0) as maxId FROM turns').get() as { maxId: number };
    return row.maxId ?? 0;
  } catch (err) {
    console.error('[context] failed to get max turn id:', err);
    return 0;
  }
}
