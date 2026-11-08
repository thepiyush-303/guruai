// ============================================================
// sessionLifecycle.ts — opening a study session on a connection.
//
// Used both by the session_init handshake and by switch_session mid-connection
// (a new language, or resuming a saved session). The WebSocket is just the
// transport: one connection can move between sessions without reconnecting.
// ============================================================

import WebSocket from 'ws';
import { ServerMessage, SessionContext } from './types';
import { OpenRequest, SessionStore, openSessionContext } from './session';
import { applyPreferences, emitInternal, endSpeechSession, sendJson } from './sideEffects';
import { currentView } from './memory/memoryUpdater';
import { viewOf, type SessionContextView } from './memory/sessionMemory';
import { loadNotes, notesDefault, type NotesState } from './notes/notesAgent';
import { pdfAvailable, pdfUnavailableReason } from './notes/pdf';
import { loadSessionTurns, getSession, upsertSession } from './contextStore';
import { findTopic } from './catalog';

const SERVER_VERSION = '0.3.0';
const OPENER_DELAY_MS = Number(process.env.OPENER_DELAY_MS ?? 400);

/** The session's study notes, for the notes panel. */
export function sendNotesUpdate(ws: WebSocket, sessionId: string, state: NotesState): void {
  const { subject, topic, version, sections } = state.notebook;
  sendJson(ws, {
    type: 'notes_update',
    session_id: sessionId,
    enabled: state.enabled,
    default_enabled: notesDefault(),
    notebook: { subject, topic, version, sections },
    pdf_available: pdfAvailable(),
    pdf_reason: pdfUnavailableReason(),
  });
}

/** Lesson progress for the client's sidebar. */
export function sendSessionContext(ws: WebSocket, sessionId: string, view: SessionContextView = viewOf({
  topic: null, gist: '', lesson: null, student: { understood: [], struggling: [], misconceptions: [] }, last_offer: null,
})): void {
  sendJson(ws, { type: 'session_context', session_id: sessionId, ...view });
}

/**
 * Point the speech engines at the session's preferences and tell the client
 * what is now in effect (and whether live captions exist for the language).
 */
export function sendPreferencesAck(ws: WebSocket, ctx: SessionContext): void {
  const { liveCaptions, ttsVoice } = applyPreferences(ctx.preferences);
  const ack: ServerMessage = {
    type: 'preferences_ack',
    session_id: ctx.sessionId,
    preferences: ctx.preferences,
    live_captions: liveCaptions,
    tts_voice: ttsVoice,
  };
  sendJson(ws, ack);
}

/** Open (or resume) a session and make it the active one for this connection. */
export function openSession(ws: WebSocket, req: OpenRequest): SessionContext {
  // Leaving another session: silence its speech and release its STT socket.
  if (SessionStore.has()) endSpeechSession();

  const { ctx, resumed, title, groupId } = openSessionContext(req);
  SessionStore.set(ctx);

  const p = ctx.preferences;
  console.log(
    `[session] ${resumed ? 'resumed' : 'new'} ${ctx.sessionId} ` +
    `(language=${p.language} voice=${p.voice ?? '-'} grade=${p.grade ?? '-'} board=${p.board ?? '-'})`,
  );

  sendJson(ws, {
    type: 'session_ack',
    session_id: ctx.sessionId,
    server_version: SERVER_VERSION,
    tts_sample_rate: 22050,
    state: ctx.state,
    resumed,
    title,
    group_id: groupId,
  });

  sendPreferencesAck(ws, ctx);

  // Always sent — empty for a new session — so the client clears the last one.
  const turns = loadSessionTurns(ctx.sessionId);
  sendJson(ws, {
    type: 'history_load',
    session_id: ctx.sessionId,
    turns: turns.map(({ role, content, session_id, ts }) => ({ role, content, session_id, ts })),
  });

  sendSessionContext(ws, ctx.sessionId, currentView(ctx.sessionId));
  sendNotesUpdate(ws, ctx.sessionId, loadNotes(ctx.sessionId));

  // GuruAI speaks first: a welcome back with a recap, the first chunk of a
  // chosen syllabus topic, a greeting — or, when the learner already typed a
  // question in the picker, the answer to it. Slightly delayed so the client
  // has applied the acks and opened its mic gate state.
  // A topic lesson opens with a real first turn, so the first chunk is part of
  // the stored lesson (and the memory marks it explained).
  const study = ctx.preferences.study;
  const topic = study?.kind === 'topic' ? findTopic(study.topicId) : null;
  const fresh = !(resumed && turns.length > 0);
  const ask = !fresh ? undefined : topic ? `Teach me: ${topic.topic.title}` : study?.kind === 'open' ? study.ask : undefined;
  const kind = !fresh ? 'resumed' : ask ? 'ask' : study?.kind === 'open' ? 'open' : 'new';
  setTimeout(() => {
    if (SessionStore.get() === ctx) emitInternal('session_opener', { kind, text: ask });
  }, OPENER_DELAY_MS);

  return ctx;
}

/** Persist the session's current settings (only once it has been saved, i.e. spoken in). */
export function persistSessionSettings(ctx: SessionContext): void {
  if (!getSession(ctx.sessionId)) return;
  saveSessionRow(ctx);
}

export function saveSessionRow(ctx: SessionContext): void {
  const p = ctx.preferences;
  const study = p.study;
  upsertSession({
    id: ctx.sessionId, groupId: ctx.groupId, language: p.language, voice: p.voice, grade: p.grade, board: p.board,
    studyKind: study?.kind,
    studyRef: study?.kind === 'topic' ? study.topicId : study?.kind === 'open' ? study.categoryId : undefined,
  });
}
