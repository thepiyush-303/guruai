// ============================================================
// stateMachine.ts — Pure state transition function
// Each row in PRD §3.2 is a case in this switch.
// Returns { nextState, sideEffects } — no I/O, fully testable.
// ============================================================

import { ServerState, SideEffectName, IncomingEventType } from './types';

export interface TransitionResult {
  nextState: ServerState;
  sideEffects: SideEffectName[];
}

export interface TransitionError {
  code: 'INVALID_STATE';
  message: string;
}

export type TransitionOutcome = TransitionResult | TransitionError;

export function isTransitionError(r: TransitionOutcome): r is TransitionError {
  return 'code' in r;
}

/**
 * Pure state machine transition.
 * Returns the next state and a list of named side-effects to execute.
 * Never performs I/O itself.
 */
export function transition(
  currentState: ServerState,
  event: IncomingEventType,
): TransitionOutcome {
  switch (currentState) {
    // ── IDLE ──────────────────────────────────────────────────
    case ServerState.IDLE:
      switch (event) {
        case 'speech_start':
          return {
            nextState: ServerState.LISTENING,
            sideEffects: ['OPEN_STT_STREAM'],
          };
        case 'vad_misfire':
          // No-op: stay IDLE, no side effects
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['NOOP'],
          };
        case 'session_opener':
          // A session just opened: GuruAI speaks first (greeting / recap).
          return {
            nextState: ServerState.LLM_STREAMING,
            sideEffects: ['START_LLM_STREAM'],
          };
        case 'text_input':
          // A typed question: no audio to transcribe, straight to the answer.
          return {
            nextState: ServerState.LLM_STREAMING,
            sideEffects: ['START_LLM_STREAM'],
          };
        default:
          return invalidTransition(currentState, event);
      }

    // ── LISTENING ─────────────────────────────────────────────
    case ServerState.LISTENING:
      switch (event) {
        case 'pcm_binary':
          // The frame was already streamed to Gnani + Vosk by handleBinaryMessage.
          // Must NOT re-open the STT stream here: OPEN_STT_STREAM starts a new
          // utterance, which would throw away everything said so far.
          return {
            nextState: ServerState.LISTENING,
            sideEffects: ['NOOP'],
          };
        case 'speech_end':
          return {
            nextState: ServerState.TRANSCRIBING,
            sideEffects: ['COMMIT_STT'],
          };
        case 'vad_misfire':
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['DISCARD_STT'],
          };
        default:
          return invalidTransition(currentState, event);
      }

    // ── TRANSCRIBING ──────────────────────────────────────────
    case ServerState.TRANSCRIBING:
      switch (event) {
        case 'stt_final':
          return {
            nextState: ServerState.LLM_STREAMING,
            sideEffects: ['START_LLM_STREAM'],
          };
        case 'stt_error':
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['NOTIFY_CLIENT_ERROR'],
          };
        // VAD events can arrive while STT is finalizing; silently ignore them.
        case 'speech_start':
        case 'speech_end':
        case 'vad_misfire':
          return { nextState: ServerState.TRANSCRIBING, sideEffects: ['NOOP'] };
        default:
          return invalidTransition(currentState, event);
      }

    // ── LLM_STREAMING ─────────────────────────────────────────
    case ServerState.LLM_STREAMING:
      switch (event) {
        case 'llm_token':
          // Buffer token; check sentence boundary; send to TTS when ready
          return {
            nextState: ServerState.TTS_STREAMING,
            sideEffects: ['START_TTS'],
          };
        case 'llm_tool_call':
          return {
            nextState: ServerState.TOOL_EXECUTING,
            sideEffects: ['SEND_FILLER_TTS', 'EXECUTE_TOOL'],
          };
        case 'llm_stream_complete':
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['SEND_TURN_COMPLETE'],
          };
        case 'speech_start':
          // Barge-in while generating
          return {
            nextState: ServerState.BARGE_IN_INTERRUPTED,
            sideEffects: ['ABORT_LLM_STREAM', 'STOP_TTS'],
          };
        case 'llm_error':
          // LLM stream failed (bad key, decommissioned model, network, etc.)
          // before/while generating — reset to IDLE and surface the real error.
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['ABORT_LLM_STREAM', 'NOTIFY_CLIENT_ERROR'],
          };
        default:
          return invalidTransition(currentState, event);
      }

    // ── TTS_STREAMING ─────────────────────────────────────────
    case ServerState.TTS_STREAMING:
      switch (event) {
        case 'llm_token':
          // More tokens arriving; keep producing TTS
          return {
            nextState: ServerState.TTS_STREAMING,
            sideEffects: ['NOOP'],
          };
        case 'llm_stream_complete':
          // LLM done — the TTS queue keeps draining; go IDLE
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['SEND_TURN_COMPLETE'],
          };
        case 'llm_error':
          // Groq stream failed mid-response — stop TTS playback and reset.
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['ABORT_LLM_STREAM', 'STOP_TTS', 'NOTIFY_CLIENT_ERROR'],
          };
        // VAD fires on TTS playback audio; ignore to avoid barge-in false positives.
        case 'speech_start':
        case 'speech_end':
        case 'vad_misfire':
          return { nextState: ServerState.TTS_STREAMING, sideEffects: ['NOOP'] };
        default:
          return invalidTransition(currentState, event);
      }

    // ── TOOL_EXECUTING ────────────────────────────────────────
    case ServerState.TOOL_EXECUTING:
      switch (event) {
        case 'tool_result_ready':
          // Tool returned successfully; re-enter LLM stream with result
          return {
            nextState: ServerState.LLM_STREAMING,
            sideEffects: ['START_LLM_STREAM'],
          };
        case 'tool_timeout':
          // Inject synthetic error result and continue
          return {
            nextState: ServerState.LLM_STREAMING,
            sideEffects: ['START_LLM_STREAM'],
          };
        case 'llm_error':
          // LLM continuation after a tool call failed — reset and surface error.
          return {
            nextState: ServerState.IDLE,
            sideEffects: ['ABORT_LLM_STREAM', 'NOTIFY_CLIENT_ERROR'],
          };
        default:
          return invalidTransition(currentState, event);
      }

    // ── BARGE_IN_INTERRUPTED ──────────────────────────────────
    case ServerState.BARGE_IN_INTERRUPTED:
      switch (event) {
        case 'speech_start':
          // New utterance starts after barge-in flush
          return {
            nextState: ServerState.LISTENING,
            sideEffects: ['OPEN_STT_STREAM'],
          };
        case 'vad_misfire':
        case 'speech_end':
          // Ignore stale events that arrive after barge-in
          return { nextState: ServerState.BARGE_IN_INTERRUPTED, sideEffects: ['NOOP'] };
        default:
          return invalidTransition(currentState, event);
      }

    default:
      return invalidTransition(currentState, event);
  }
}

function invalidTransition(
  state: ServerState,
  event: IncomingEventType,
): TransitionError {
  return {
    code: 'INVALID_STATE',
    message: `Event "${event}" is not valid in state "${state}"`,
  };
}
