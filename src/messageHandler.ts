// ============================================================
// messageHandler.ts — Routes incoming WS messages through the
// state machine and dispatches side effects.
// ============================================================

import WebSocket from 'ws';
import { SessionContext, ServerState, ClientMessage, ServerMessage, IncomingEventType } from './types';
import { transition, isTransitionError } from './stateMachine';
import { dispatchSideEffects, emitStateChange, sendJson, feedLiveStt } from './sideEffects';
import { normalizePreferences, updateSessionPreferences } from './session';
import { getActiveSentenceBuffer, setActiveSentenceBuffer } from './sharedState';
import { appendTurn, touchSession } from './contextStore';
import { openSession, persistSessionSettings, saveSessionRow, sendPreferencesAck } from './sessionLifecycle';
import { updateMemoryBackground } from './memory/memoryUpdater';
import { setNotesEnabled, updateNotesBackground } from './notes/notesAgent';
import { maybeTitleSession } from './titler';

/**
 * Handle a text (JSON) message from the client.
 * Parses, validates, maps to an IncomingEventType, then runs
 * the state machine and dispatches resulting side-effects.
 */
export function handleTextMessage(
  raw: string,
  ws: WebSocket,
  ctx: SessionContext,
): void {
  let msg: ClientMessage;

  // ── 1. Parse ───────────────────────────────────────────────
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    sendError(ws, ctx, 'INTERNAL', 'Malformed JSON payload', true);
    return;
  }

  // ── 2. Map message type → internal event ──────────────────
  switch (msg.type) {
    case 'session_init':
      // session_init is handled by server.ts before messageHandler is active
      // If we receive it mid-session, ignore it.
      console.warn(`[${ctx.sessionId}] Received unexpected session_init mid-session — ignoring`);
      return;

    case 'speech_start': {
      ctx.turnStartedAt = Date.now();
      // Reset per-turn latency markers for a fresh responsiveness measurement.
      ctx.speechEndAt = null;
      ctx.sttFinalAt = null;
      ctx.firstTokenAt = null;
      ctx.voskFirstPartialAt = null;
      runTransition(ws, ctx, 'speech_start');
      break;
    }

    case 'speech_end': {
      ctx.speechEndAt = Date.now();  // start of the perceived-latency window
      runTransition(ws, ctx, 'speech_end');
      break;
    }

    case 'vad_misfire': {
      runTransition(ws, ctx, 'vad_misfire');
      break;
    }

    case 'update_preferences': {
      // Voice / class / board within this session. The language is bound to
      // the session — a new language is a new session (switch_session).
      if (ctx.state !== ServerState.IDLE) {
        sendError(ws, ctx, 'INVALID_STATE', 'Preferences can only be changed while idle', true);
        return;
      }
      const prefs = normalizePreferences({ ...msg.preferences, language: ctx.preferences.language }, ctx.preferences);
      updateSessionPreferences(ctx, prefs);
      persistSessionSettings(ctx);
      sendPreferencesAck(ws, ctx);
      break;
    }

    case 'set_notes': {
      // Works at any time: the notes agent runs in the background. The
      // resulting notes_update reaches the client through onNotesChanged.
      setNotesEnabled(ctx.sessionId, msg.enabled === true);
      break;
    }

    case 'switch_session': {
      // Start a new session (new language) or resume a saved one, on this
      // same connection. Only between turns, so nothing is mid-flight.
      if (ctx.state !== ServerState.IDLE) {
        sendError(ws, ctx, 'INVALID_STATE', 'Sessions can only be switched while idle', true);
        return;
      }
      openSession(ws, {
        sessionId: msg.session_id,
        preferences: msg.preferences,
        resume: msg.resume === true,
        groupId: msg.group_id,
      });
      break;
    }

    case 'tool_result': {
      // Tool results are client-side only per PRD; server handles this internally.
      // Placeholder for Phase 5.
      console.log(`[${ctx.sessionId}] Received tool_result for call_id=${msg.tool_call_id} (Phase 5 stub)`);
      break;
    }

    default: {
      // Exhaustiveness guard — TypeScript should catch this at compile time
      const unreachable = msg as { type: string };
      sendError(ws, ctx, 'INTERNAL', `Unknown message type: ${unreachable.type}`, true);
    }
  }
}

/**
 * Handle a binary (PCM) frame from the client.
 * Only valid in LISTENING state — all other states reject and log a warning.
 */
export function handleBinaryMessage(
  buf: Buffer,
  ws: WebSocket,
  ctx: SessionContext,
): void {
  if (ctx.state !== ServerState.LISTENING) {
    console.warn(
      `[${ctx.sessionId}] Binary PCM received in state ${ctx.state} — dropping ${buf.length} bytes`,
    );
    return;
  }

  // Stream the frame straight on — Gnani Prisma transcribes while the student
  // is still talking, and Vosk turns it into live captions. Nothing is written
  // to disk (PRD §1.3 privacy requirement).
  feedLiveStt(buf);

  // State machine: LISTENING + pcm_binary → LISTENING (no state_change emitted)
  const result = transition(ctx.state, 'pcm_binary');
  if (isTransitionError(result)) {
    console.error(`[${ctx.sessionId}] Unexpected: ${result.message}`);
    return;
  }
  // Side effects for pcm_binary are dispatched without a state_change emit
  dispatchSideEffects(result.sideEffects, { ws, ctx });
}

// ── Internal helpers ──────────────────────────────────────────

/**
 * Run a state machine transition, dispatch side-effects, and emit
 * a state_change message to the client if the state actually changed.
 */
function runTransition(
  ws: WebSocket,
  ctx: SessionContext,
  event: Parameters<typeof transition>[1],
): void {
  const prevState = ctx.state;
  const result = transition(ctx.state, event);

  if (isTransitionError(result)) {
    console.warn(`[${ctx.sessionId}] ${result.message}`);
    sendError(ws, ctx, 'INVALID_STATE', result.message, true);
    return;
  }

  ctx.state = result.nextState;
  emitStateChange(ws, prevState, result.nextState);
  dispatchSideEffects(result.sideEffects, { ws, ctx });
}

function sendError(
  ws: WebSocket,
  ctx: SessionContext,
  code: ServerMessage & { type: 'error' } extends { code: infer C } ? C : never,
  message: string,
  recoverable: boolean,
): void {
  const msg: ServerMessage = {
    type: 'error',
    session_id: ctx.sessionId,
    code,
    message,
    recoverable,
    timestamp_ms: Date.now(),
  };
  sendJson(ws, msg);
}

/**
 * Handle internal events fired by the speech engines and LLM streams.
 * Called from server.ts when a subprocess emits a transcript or error.
 */
export function handleInternalEvent(
  eventType: IncomingEventType,
  payload: unknown,
  ws: WebSocket,
  ctx: SessionContext,
): void {
  const p = payload as Record<string, unknown> | undefined;

  switch (eventType) {
    // ── Live Vosk captions (display-only) ─────────────────────
    // Never enter conversationHistory: Prisma's final is what the LLM sees.
    // No state transition — these arrive continuously while LISTENING.
    case 'vosk_partial':
    case 'vosk_final': {
      const text = ((p?.text as string) ?? '').trim();
      if (!text) break;

      // Captions belong to the utterance being spoken/transcribed. Once the LLM
      // is answering, a late frame would overwrite the response text in the UI.
      if (ctx.state !== ServerState.LISTENING && ctx.state !== ServerState.TRANSCRIBING) {
        break;
      }

      if (eventType === 'vosk_partial' && !ctx.voskFirstPartialAt) {
        ctx.voskFirstPartialAt = Date.now();
        if (ctx.turnStartedAt) {
          console.log(`[latency] first live caption: ${ctx.voskFirstPartialAt - ctx.turnStartedAt}ms after speech_start`);
        }
      }

      const msg: ServerMessage = {
        type: 'transcript_partial',
        session_id: ctx.sessionId,
        text,
        confidence: null,
        timestamp_ms: Date.now(),
      };
      sendJson(ws, msg);
      break;
    }

    case 'stt_final': {
      const text        = (p?.text as string) ?? '';
      const duration_ms = (p?.duration_ms as number) ?? 0;
      const detected    = p?.detected_language as string | undefined;
      const via         = (p?.via as string | undefined) ?? 'stream';
      const gnaniMs     = p?.gnani_latency_ms as number | undefined;

      if (ctx.state !== ServerState.TRANSCRIBING) {
        console.warn(`[${ctx.sessionId}] stt_final ignored in state ${ctx.state}`);
        break;
      }

      // Empty transcript (noise / nothing recognised) — reset to IDLE, skip the LLM.
      if (!text.trim()) {
        console.log(`[${ctx.sessionId}] Empty transcript — resetting to IDLE`);
        ctx.pendingError = { code: 'STT_FAIL', message: "I didn't catch that. Please say it again." };
        runTransition(ws, ctx, 'stt_error'); // reuse error path (goes back to IDLE)
        break;
      }

      // 1. Send transcript_final to browser
      const msg: ServerMessage = {
        type: 'transcript_final',
        session_id: ctx.sessionId,
        text,
        duration_ms,
        timestamp_ms: Date.now(),
        ...(detected ? { detected_language: detected } : {}),
      };
      sendJson(ws, msg);
      console.log(`[${ctx.sessionId}] transcript_final${detected ? ` [${detected}]` : ''}: "${text.slice(0, 80)}"`);

      // Latency: STT wall time (speech_end → transcript ready), commit → final,
      // and Gnani's own reported processing time.
      ctx.sttFinalAt = Date.now();
      if (ctx.speechEndAt) {
        console.log(
          `[latency] STT: ${ctx.sttFinalAt - ctx.speechEndAt}ms wall (${duration_ms}ms after commit` +
          `${gnaniMs !== undefined ? `, gnani ${gnaniMs}ms` : ''}${via === 'rest' ? ', via REST retry' : ''})`,
        );
      }

      // 2. Append user turn to conversation history for the LLM
      ctx.conversationHistory.push({ role: 'user', content: text });

      // Persist the user turn. The session row is created on its first turn, so
      // sessions nobody spoke in are never listed. (Its title is generated from
      // the content once the first answer is in — see titler.ts.)
      saveSessionRow(ctx);
      appendTurn(ctx.sessionId, 'user', text);
      touchSession(ctx.sessionId);

      // 3. Transition TRANSCRIBING → LLM_STREAMING
      runTransition(ws, ctx, 'stt_final');
      break;
    }

    case 'stt_error': {
      const code    = (p?.code as string) ?? 'UNKNOWN';
      const msg_str = (p?.msg as string) ?? 'Unknown STT error';
      console.error(`[${ctx.sessionId}] stt_error (${code}): ${msg_str}`);
      if (ctx.state !== ServerState.TRANSCRIBING) {
        console.warn(`[${ctx.sessionId}] stt_error ignored in state ${ctx.state}`);
        break;
      }
      ctx.pendingError = {
        code: 'STT_FAIL',
        message: code === 'NO_API_KEY'
          ? 'Speech recognition is not configured: set GNANI_API_KEY in .env.'
          : `Speech recognition failed: ${msg_str}`,
      };
      runTransition(ws, ctx, 'stt_error');
      break;
    }

    case 'llm_token': {
      const delta      = (p?.delta as string) ?? '';
      const tokenIndex = (p?.tokenIndex as number) ?? 0;

      // Latency: the first token marks the LLM's time-to-first-token (first audio
      // follows one sentence-buffer flush + one Timbre round trip later).
      if (!ctx.firstTokenAt) {
        ctx.firstTokenAt = Date.now();
        const ttft = ctx.sttFinalAt ? ctx.firstTokenAt - ctx.sttFinalAt : -1;
        const perceived = ctx.speechEndAt ? ctx.firstTokenAt - ctx.speechEndAt : -1;
        console.log(`[latency] LLM TTFT: ${ttft}ms | perceived speech_end→first token: ${perceived}ms`);
      }

      // 1. Stream token to browser for live text display
      const msg: ServerMessage = {
        type: 'llm_token',
        session_id: ctx.sessionId,
        delta,
        token_index: tokenIndex,
        timestamp_ms: Date.now(),
      };
      sendJson(ws, msg);

      // 2. First token: LLM_STREAMING → TTS_STREAMING. Its START_TTS effect
      //    creates the sentence buffer, so this must run BEFORE the append below
      //    — otherwise the first token is never spoken.
      if (ctx.state === ServerState.LLM_STREAMING) {
        runTransition(ws, ctx, 'llm_token');
      }

      // 3. Feed token to sentence buffer → queues Timbre synthesis at sentence boundaries
      const activeSentenceBuffer = getActiveSentenceBuffer();
      if (activeSentenceBuffer) {
        activeSentenceBuffer.append(delta);
      }
      break;
    }

    case 'llm_stream_complete': {
      // Persist the assistant's spoken answer to the durable transcript. The
      // full text arrives on this event (from groq/geminiStream); the tool-call
      // path sends empty text here and is intentionally not persisted.
      // The opener (greeting / recap) is spoken but not stored: it is not part
      // of the lesson, and would only clutter the transcript and the memory.
      const fullText = (p?.fullText as string) ?? '';
      const wasOpener = ctx.openerActive === true;
      ctx.openerActive = false;
      if (fullText.trim() && !wasOpener) {
        appendTurn(ctx.sessionId, 'assistant', fullText.trim());
        touchSession(ctx.sessionId);
        maybeTitleSession(ctx.sessionId);
      }

      // Flush any remaining buffered text to TTS
      const activeSentenceBuffer = getActiveSentenceBuffer();
      if (activeSentenceBuffer) {
        activeSentenceBuffer.flush();
        setActiveSentenceBuffer(null);
      }
      // Transition to IDLE; side-effect SEND_TURN_COMPLETE sends metrics to browser
      runTransition(ws, ctx, 'llm_stream_complete');
      
      // Update the session memory and learner profile in the background.
      if (!wasOpener) {
        updateMemoryBackground(ctx.sessionId);
        updateNotesBackground(ctx.sessionId); // no-op when notes are off
      }
      break;
    }

    case 'session_opener': {
      // Only when nothing else is happening (the student may already be talking).
      if (ctx.state !== ServerState.IDLE) break;
      ctx.pendingOpener = p?.kind === 'resumed' ? 'resumed' : 'new';
      runTransition(ws, ctx, 'session_opener');
      break;
    }

    case 'llm_tool_call': {
      const name = p?.name as string | undefined;
      const args = p?.args as string | undefined;
      const id = p?.id as string | undefined;
      if (name && id) {
        ctx.pendingToolCall = { name, args: args || '{}', id };
      }
      runTransition(ws, ctx, 'llm_tool_call');
      console.log(`[${ctx.sessionId}] llm_tool_call: ${String(p?.name)}`);
      break;
    }

    case 'tool_result_ready': {
      // The backend tool execution finished and history was updated. 
      // State machine transitioning TOOL_EXECUTING -> LLM_STREAMING will call START_LLM_STREAM.
      runTransition(ws, ctx, 'tool_result_ready');
      break;
    }

    case 'llm_error': {
      const code = (p?.code as string) ?? 'UNKNOWN';
      const msg  = (p?.msg as string) ?? 'Unknown LLM error';
      console.error(`[${ctx.sessionId}] llm_error (${code}): ${msg}`);

      // Only meaningful while an LLM turn is in flight. If we've already reset
      // (e.g. a late/duplicate error), ignore it rather than emit INVALID_STATE.
      if (
        ctx.state !== ServerState.LLM_STREAMING &&
        ctx.state !== ServerState.TTS_STREAMING &&
        ctx.state !== ServerState.TOOL_EXECUTING
      ) {
        console.warn(`[${ctx.sessionId}] llm_error ignored in state ${ctx.state}`);
        break;
      }

      // Stash the real reason so NOTIFY_CLIENT_ERROR surfaces it to the browser.
      ctx.pendingError = {
        code: 'LLM_TIMEOUT',
        message: `LLM request failed (${code}): ${msg}`,
      };
      runTransition(ws, ctx, 'llm_error');
      break;
    }

    default:
      console.log(`[${ctx.sessionId}] Unhandled internal event: ${eventType}`);
  }
}
