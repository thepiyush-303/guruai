// ============================================================
// sideEffects.ts — Side effect dispatcher
// Executes the named effects the pure state machine returns:
// Gnani Prisma STT, Gnani Timbre TTS, Vosk live captions, LLM streams.
// ============================================================

import * as fs from 'fs';
import WebSocket from 'ws';
import { SideEffectName, SessionContext, ServerMessage, ServerState, IncomingEventType, SessionPreferences } from './types';
import { getStt } from './gnaniStt';
import { getTts } from './gnaniTts';
import * as voskProcess from './voskProcess';
import { getLanguage, voskModelFor } from './languages';
import { SentenceBuffer } from './sentenceBuffer';
import { startGroqStream, abortGroqStream } from './groqStream';
import { startGeminiStream, abortGeminiStream } from './geminiStream';
import { setActiveSentenceBuffer } from './sharedState';
import { sanitizeForTTS } from './ttsUtils';
import { SessionStore, refreshContext } from './session';
import { openerInstruction } from './prompts/teacher';
import { loadProfile } from './memory/learnerProfile';
import { loadSessionMemory } from './memory/sessionMemory';

// ── Sentence buffer & internal event callback ─────────────────

let sentenceBuffer: SentenceBuffer | null = null;
let activeWs: WebSocket | null = null;

// Set at startup so LLM / STT callbacks can fire handleInternalEvent
let internalEventEmitter: ((event: IncomingEventType, payload?: unknown) => void) | null = null;

export function setInternalEventEmitter(
  emitter: (event: IncomingEventType, payload?: unknown) => void
): void {
  internalEventEmitter = emitter;
}

export function getActiveWs(): WebSocket | null { return activeWs; }

/** Fire an internal state-machine event (routed through server.ts → handleInternalEvent). */
export function emitInternal(event: IncomingEventType, payload?: unknown): void {
  internalEventEmitter?.(event, payload);
}

function resetSentenceBuffer(): void {
  sentenceBuffer?.reset();
  sentenceBuffer = null;
}

// ── Public: speech services, wired at server startup ──────────

/**
 * Called once at server startup: wires Gnani STT and Vosk events into the
 * state machine and warms the Gnani TTS connection.
 * @param emitInternalEvent  Callback into messageHandler/server to fire internal events
 */
export function initSpeechServices(
  emitInternalEvent: (event: IncomingEventType, payload?: unknown) => void
): void {
  internalEventEmitter = emitInternalEvent;

  // Gnani Prisma → one final (or error) per utterance
  getStt().onEvent((ev) => {
    if (ev.type === 'final') {
      emitInternalEvent('stt_final', {
        text: ev.text,
        duration_ms: ev.duration_ms,
        detected_language: ev.detected_language,
        gnani_latency_ms: ev.gnani_latency_ms,
        via: ev.via,
      });
    } else {
      emitInternalEvent('stt_error', { code: ev.code, msg: ev.msg });
    }
  });

  // Vosk live-caption events → internal events. Display-only: they never
  // enter conversationHistory — Prisma's final is what the LLM sees.
  voskProcess.onVoskEvent((ev) => {
    switch (ev.type) {
      case 'partial':
        emitInternalEvent('vosk_partial', { text: ev.text });
        break;
      case 'final':
        emitInternalEvent('vosk_final', { text: ev.text });
        break;
      case 'error':
        // Non-fatal: live captions degrade, Prisma finals are unaffected.
        console.error(`[vosk] ${ev.code}: ${ev.msg}`);
        break;
    }
  });

  // Tell the client when speech output starts and finishes, so it can keep the
  // mic closed for the whole answer (see TtsStateMessage).
  getTts().onActivity((active) => {
    const ws = activeWs;
    if (!ws) return;
    sendJson(ws, {
      type: 'tts_state',
      session_id: SessionStore.get()?.sessionId ?? '',
      active,
      timestamp_ms: Date.now(),
    });
  });

  // Warm the TTS socket. STT and Vosk start once the session's language is known.
  getTts().start();
}

/**
 * Point every speech engine at the session's language.
 * Returns whether live (Vosk) captions are available for it.
 */
export function applyPreferences(prefs: SessionPreferences): { liveCaptions: boolean; ttsVoice: string } {
  const lang = getLanguage(prefs.language);
  getStt().configure(lang);
  getStt().connect();
  getTts().configure(lang, prefs.voice);

  let model = voskModelFor(lang);
  if (model && !fs.existsSync(model)) {
    console.warn(`[vosk] model for ${lang.label} not found at ${model} — live captions off`);
    model = null;
  }
  voskProcess.setModel(model);
  console.log(`[speech] language=${lang.label} stt=${lang.sttLanguageCode} tts=${lang.ttsLanguage} live_captions=${model !== null}`);
  return { liveCaptions: model !== null, ttsVoice: getTts().voice };
}

/**
 * Feed one live PCM frame to both recognizers: Gnani (authoritative final)
 * and Vosk (live captions). Called per binary frame from messageHandler.
 */
export function feedLiveStt(pcm: Buffer): void {
  getStt().writeChunk(pcm);
  voskProcess.writeChunk(pcm);
}

/** The client disconnected: release the STT socket and silence any queued speech. */
export function endSpeechSession(): void {
  resetSentenceBuffer();
  setActiveSentenceBuffer(null);
  getStt().stop();
  getTts().kill();
}

export function stopSpeechServices(): void {
  getStt().stop();
  getTts().stop();
  voskProcess.stop();
}

// ── Dispatcher ─────────────────────────────────────────────────

export interface SideEffectContext {
  ws: WebSocket;
  ctx: SessionContext;
}

export function dispatchSideEffects(
  effects: SideEffectName[],
  { ws, ctx }: SideEffectContext,
): void {
  activeWs = ws;
  for (const effect of effects) {
    switch (effect) {
      case 'OPEN_STT_STREAM':
        openSttStream(ctx);
        break;
      case 'COMMIT_STT':
        commitStt(ctx);
        break;
      case 'DISCARD_STT':
        discardStt(ctx);
        break;
      case 'START_LLM_STREAM':
        triggerLLMStream(ctx);
        break;
      case 'ABORT_LLM_STREAM':
        triggerAbortLLM(ctx);
        break;
      case 'START_TTS':
        startTts(ws, ctx);
        break;
      case 'STOP_TTS':
        stopTts(ws, ctx);
        break;
      case 'SEND_FILLER_TTS':
        sendFillerTts(ws, ctx);
        break;
      case 'SEND_TURN_COMPLETE':
        sendTurnComplete(ws, ctx);
        break;
      case 'NOTIFY_CLIENT_ERROR':
        notifyClientError(ws, ctx);
        break;
      case 'EXECUTE_TOOL':
        executeTool(ws, ctx);
        break;
      case 'NOOP':
        break;
    }
  }
}

// ── STT side-effects (Gnani Prisma + Vosk captions) ───────────

function openSttStream(ctx: SessionContext): void {
  getStt().beginUtterance();
  voskProcess.resetSilent();  // drop any leftover recognizer state from the last turn
  console.log(`[${ctx.sessionId}] OPEN_STT_STREAM — utterance started`);
}

function commitStt(ctx: SessionContext): void {
  console.log(`[${ctx.sessionId}] COMMIT_STT — awaiting Prisma final`);
  getStt().commit();
  // Vosk already has every frame (fed live) — just flush its final caption.
  voskProcess.finalizeUtterance();
}

function discardStt(ctx: SessionContext): void {
  console.log(`[${ctx.sessionId}] DISCARD_STT — VAD misfire, utterance dropped`);
  getStt().discard();
  voskProcess.resetSilent();  // discard live captions for the misfired utterance
}

// ── TTS side-effects (Gnani Timbre) ────────────────────────────

function startTts(ws: WebSocket, ctx: SessionContext): void {
  const tts = getTts();
  tts.beginTurn();
  const buf = new SentenceBuffer((sentence) => {
    const speakable = sanitizeForTTS(sentence);
    if (speakable) tts.synthesize(speakable, ws);
  });
  sentenceBuffer = buf;
  setActiveSentenceBuffer(buf);   // share with messageHandler llm_token handler
  console.log(`[${ctx.sessionId}] START_TTS — sentence buffer active`);
}

function stopTts(ws: WebSocket, ctx: SessionContext): void {
  console.log(`[${ctx.sessionId}] STOP_TTS — speech cancelled`);
  resetSentenceBuffer();
  setActiveSentenceBuffer(null);   // clear messageHandler reference
  getTts().kill();

  const msg: ServerMessage = {
    type: 'tts_interrupted',
    session_id: ctx.sessionId,
    reason: 'barge_in',
    timestamp_ms: Date.now(),
  };
  sendJson(ws, msg);
}

function sendFillerTts(ws: WebSocket, ctx: SessionContext): void {
  console.log(`[${ctx.sessionId}] SEND_FILLER_TTS`);
  getTts().sendFillerPhrase(ws);
}

// ── Tools ──────────────────────────────────────────────────────
// GuruAI registers no tools yet (weather/Todoist were Vani's and are no longer
// offered to the LLM; their modules remain in src/tools/). Phase 3 adds
// set_notes. Any call that does arrive gets an error result so the LLM can
// carry on rather than hang in TOOL_EXECUTING.

function executeTool(_ws: WebSocket, ctx: SessionContext): void {
  const tool = ctx.pendingToolCall;
  if (!tool) {
    console.warn(`[${ctx.sessionId}] EXECUTE_TOOL but no pendingToolCall found`);
    return;
  }
  ctx.pendingToolCall = undefined;

  const emit = internalEventEmitter;
  if (!emit) return;

  console.log(`[${ctx.sessionId}] EXECUTE_TOOL: ${tool.name}(${tool.args}) — not available`);
  ctx.conversationHistory.push({
    role: 'tool',
    content: JSON.stringify({ error: `Tool ${tool.name} is not available` }),
    tool_call_id: tool.id,
  });
  emit('tool_result_ready');
}

// ── Generic LLM side-effects ──────────────────────────────────

function triggerLLMStream(ctx: SessionContext): void {
  if (!internalEventEmitter) {
    console.warn(`[${ctx.sessionId}] START_LLM_STREAM: internalEventEmitter not set`);
    return;
  }

  const emit = internalEventEmitter;
  const provider = process.env.LLM_PROVIDER ?? 'groq';

  // Latest learner profile + session memory, every time (updated in the
  // background between turns).
  refreshContext(ctx);

  // The opener: an in-memory instruction stands in for the student's turn.
  ctx.openerActive = false;
  if (ctx.pendingOpener) {
    const kind = ctx.pendingOpener;
    ctx.pendingOpener = undefined;
    ctx.openerActive = true;
    ctx.conversationHistory.push({
      role: 'user',
      content: openerInstruction(kind, loadProfile(), loadSessionMemory(ctx.sessionId).memory),
      ephemeral: true,
    });
  }

  const startStreamPhase = provider === 'gemini' ? startGeminiStream : startGroqStream;

  // Fire-and-forget (async stream runs in background)
  startStreamPhase(ctx, (ev) => {
    switch (ev.type) {
      case 'llm_token':
        emit('llm_token', { delta: ev.delta, tokenIndex: ev.tokenIndex });
        break;
      case 'llm_tool_call':
        emit('llm_tool_call', { name: ev.name, args: ev.args, id: ev.id });
        break;
      case 'llm_stream_complete':
        emit('llm_stream_complete', { fullText: ev.fullText });
        break;
      case 'llm_error':
        console.error(`[llm] Error ${ev.code}: ${ev.msg}`);
        emit('llm_error', { code: ev.code, msg: ev.msg });
        break;
      case 'grounding_sources': {
        // Broadcast grounding attribution to the client WebSocket (Phase 9)
        // This event does NOT affect the state machine.
        const ws = activeWs;
        if (ws) {
          const msg: ServerMessage = {
            type: 'grounding_sources',
            session_id: ctx.sessionId,
            queries: (ev as any).queries ?? [],
            sources: (ev as any).sources ?? [],
            timestamp_ms: Date.now(),
          };
          sendJson(ws, msg);
        }
        break;
      }
    }
  }).catch((err) => {
    console.error(`[llm] Unhandled stream error: ${err}`);
    emit('llm_error', { code: 'LLM_FATAL', msg: String(err) });
  });

  console.log(`[${ctx.sessionId}] START_LLM_STREAM — ${provider} stream initiated`);
}

function triggerAbortLLM(ctx: SessionContext): void {
  console.log(`[${ctx.sessionId}] ABORT_LLM_STREAM — aborting LLM stream`);
  const provider = process.env.LLM_PROVIDER ?? 'groq';
  if (provider === 'gemini') {
    abortGeminiStream();
  } else {
    abortGroqStream();
  }
}

// ── Completion & error messages ───────────────────────────────

function sendTurnComplete(ws: WebSocket, ctx: SessionContext): void {
  const latency = ctx.turnStartedAt !== null
    ? Date.now() - ctx.turnStartedAt
    : -1;

  const msg: ServerMessage = {
    type: 'turn_complete',
    session_id: ctx.sessionId,
    total_latency_ms: latency,
    token_count: ctx.tokenCount,
    timestamp_ms: Date.now(),
  };

  sendJson(ws, msg);
  ctx.turnStartedAt = null;
  ctx.tokenCount = 0;
  // Do NOT stop TTS here. The Timbre queue is still synthesizing the sentences
  // we just queued — the turn "completes" the instant the LLM stream ends, long
  // before the audio has finished. TTS is only cancelled by STOP_TTS or shutdown.
  resetSentenceBuffer();
  setActiveSentenceBuffer(null);  // clear messageHandler reference
  console.log(`[${ctx.sessionId}] turn_complete (latency=${latency}ms)`);
}

function notifyClientError(ws: WebSocket, ctx: SessionContext): void {
  // If a specific error was stashed (an LLM or STT failure), surface the real
  // code+message; otherwise default to the STT failure message.
  const pending = ctx.pendingError;
  const msg: ServerMessage = {
    type: 'error',
    session_id: ctx.sessionId,
    code: pending?.code ?? 'STT_FAIL',
    message: pending?.message ?? 'Speech transcription failed. Please try again.',
    recoverable: true,
    timestamp_ms: Date.now(),
  };
  sendJson(ws, msg);
  ctx.pendingError = undefined;
  console.error(`[${ctx.sessionId}] Error sent to client: ${msg.code} — ${msg.message}`);
}

// ── WS helpers ─────────────────────────────────────────────────

export function sendJson(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function emitStateChange(
  ws: WebSocket,
  from: ServerState,
  to: ServerState,
): void {
  if (from === to) return;
  const msg: ServerMessage = {
    type: 'state_change',
    from,
    to,
    timestamp_ms: Date.now(),
  };
  sendJson(ws, msg);
  console.log(`[state] ${from} → ${to}`);
}
