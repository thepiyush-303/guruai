// ============================================================
// session.ts — SessionContext factory, preferences and store
// Single-user per PRD §1.2 (no multi-tenancy on local hardware)
// ============================================================

import * as crypto from 'crypto';
import { SessionContext, ServerState, ConversationMessage, SessionPreferences, Board } from './types';
import { getGroup, getSession, loadSessionTurns, recentOtherSessions } from './contextStore';
import { DEFAULT_LANGUAGE, isLanguageId } from './languages';
import { defaultVoice, isVoice } from './voices';
import { buildTeacherPrompt } from './prompts/teacher';
import { emptyMemory, loadSessionMemory } from './memory/sessionMemory';
import { loadProfile } from './memory/learnerProfile';
import { loadNotes } from './notes/notesAgent';

/** Recent turns of the session replayed to the LLM verbatim (older ones live in the summary). */
const CONTEXT_TURNS = 12;

/** Session ids come from the client and key the database: keep them boring. */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

const BOARDS: Board[] = ['CBSE', 'ICSE', 'STATE', 'OTHER'];
const GRADES = ['6', '7', '8', '9', '10', '11', '12', 'college'];

/** Coerce untrusted client input into valid preferences, falling back to `base`. */
export function normalizePreferences(
  raw: Partial<SessionPreferences> | undefined,
  base: SessionPreferences = { language: DEFAULT_LANGUAGE },
): SessionPreferences {
  const out: SessionPreferences = { ...base };
  if (raw && isLanguageId(raw.language)) out.language = raw.language;
  if (raw && 'voice' in raw && isVoice(raw.voice)) out.voice = raw.voice;
  if (!isVoice(out.voice)) out.voice = defaultVoice();
  if (raw && 'grade' in raw) {
    out.grade = typeof raw.grade === 'string' && GRADES.includes(raw.grade) ? raw.grade : undefined;
  }
  if (raw && 'board' in raw) {
    out.board = BOARDS.includes(raw.board as Board) ? raw.board : undefined;
  }
  return out;
}

/**
 * The system prompt for a session with no memory yet (kept for callers and
 * tests that only have preferences). Real turns use systemContentFor, which
 * adds the learner profile and this session's memory.
 */
export function buildSystemPrompt(prefs: SessionPreferences): string {
  return buildTeacherPrompt({ prefs, profile: {}, memory: emptyMemory(), recentSessions: [] });
}

function systemContentFor(sessionId: string, prefs: SessionPreferences): string {
  return buildTeacherPrompt({
    prefs,
    profile: loadProfile(),
    memory: loadSessionMemory(sessionId).memory,
    recentSessions: recentOtherSessions(sessionId).map((s) => s.title),
    notesEnabled: loadNotes(sessionId).enabled,
  });
}

/**
 * Rebuild the system message from the database: the latest learner profile
 * and session memory (updated in the background after every exchange).
 * Called before every LLM call, so each answer sees the current lesson state.
 */
export function refreshContext(ctx: SessionContext): void {
  const content = systemContentFor(ctx.sessionId, ctx.preferences);
  if (ctx.conversationHistory[0]?.role === 'system') {
    ctx.conversationHistory[0] = { role: 'system', content };
  } else {
    ctx.conversationHistory.unshift({ role: 'system', content });
  }
}

/** A context for `sessionId`, with that session's summary and recent turns as LLM context. */
export function createSession(sessionId: string, prefs: SessionPreferences): SessionContext {
  const conversationHistory: ConversationMessage[] = [
    { role: 'system', content: systemContentFor(sessionId, prefs) },
  ];
  for (const turn of loadSessionTurns(sessionId, CONTEXT_TURNS)) {
    conversationHistory.push({ role: turn.role, content: turn.content });
  }

  return {
    sessionId,
    state: ServerState.IDLE,
    preferences: prefs,
    conversationHistory,
    tokenCount: 0,
    turnStartedAt: null,
    createdAt: Date.now(),
  };
}

export interface OpenRequest {
  sessionId: unknown;
  preferences?: Partial<SessionPreferences>;
  resume?: boolean;
  groupId?: unknown;
}

export interface OpenResult {
  ctx: SessionContext;
  resumed: boolean;
  title: string | null;
  groupId: string | null;
}

/**
 * Resolve a client's request to a session. Resuming a saved session restores
 * its own language/voice/class/board (the session is bound to its language);
 * anything else starts a fresh session with the requested preferences.
 */
export function openSessionContext(req: OpenRequest): OpenResult {
  const sessionId = isValidSessionId(req.sessionId) ? req.sessionId : crypto.randomUUID();
  const saved = req.resume ? getSession(sessionId) : null;

  if (saved) {
    const prefs = normalizePreferences({
      language: saved.language as SessionPreferences['language'],
      voice: saved.voice ?? undefined,
      grade: saved.grade ?? undefined,
      board: (saved.board ?? undefined) as Board | undefined,
    });
    const ctx = createSession(sessionId, prefs);
    ctx.groupId = saved.group_id;
    return { ctx, resumed: true, title: saved.title, groupId: saved.group_id };
  }

  // A fresh session must not collide with a saved one.
  const id = getSession(sessionId) ? crypto.randomUUID() : sessionId;
  const ctx = createSession(id, normalizePreferences(req.preferences));
  const groupId = typeof req.groupId === 'string' && getGroup(req.groupId) ? req.groupId : null;
  ctx.groupId = groupId;
  return { ctx, resumed: false, title: null, groupId };
}

/** Apply new voice/class/board mid-session: the system prompt is rebuilt in place. */
export function updateSessionPreferences(ctx: SessionContext, prefs: SessionPreferences): void {
  ctx.preferences = prefs;
  refreshContext(ctx);
}

// Single active session — enforced at connection time in server.ts
let activeSession: SessionContext | null = null;

export const SessionStore = {
  set(ctx: SessionContext): void {
    activeSession = ctx;
  },

  get(): SessionContext | null {
    return activeSession;
  },

  getOrThrow(): SessionContext {
    if (!activeSession) {
      throw new Error('No active session');
    }
    return activeSession;
  },

  clear(): void {
    if (activeSession) {
      console.log(`[session] Session ${activeSession.sessionId} cleared`);
    }
    activeSession = null;
  },

  has(): boolean {
    return activeSession !== null;
  },
};
