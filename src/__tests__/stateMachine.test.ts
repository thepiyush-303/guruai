// ============================================================
// stateMachine.test.ts
// Unit tests — one test per PRD §3.2 transition table row.
// All transitions tested; invalid transitions tested for error.
// ============================================================

import { transition, isTransitionError } from '../stateMachine';
import { ServerState } from '../types';

// ── Helpers ───────────────────────────────────────────────────

function expectTransition(
  from: ServerState,
  event: Parameters<typeof transition>[1],
  toState: ServerState,
  includesEffect?: string,
) {
  const result = transition(from, event);
  expect(isTransitionError(result)).toBe(false);
  if (isTransitionError(result)) return; // type narrowing

  expect(result.nextState).toBe(toState);
  if (includesEffect) {
    expect(result.sideEffects).toContain(includesEffect);
  }
}

function expectInvalidTransition(
  from: ServerState,
  event: Parameters<typeof transition>[1],
) {
  const result = transition(from, event);
  expect(isTransitionError(result)).toBe(true);
  if (isTransitionError(result)) {
    expect(result.code).toBe('INVALID_STATE');
  }
}

// ── IDLE ──────────────────────────────────────────────────────

describe('IDLE state', () => {
  it('session_opener → LLM_STREAMING, GuruAI speaks first', () => {
    expectTransition(ServerState.IDLE, 'session_opener', ServerState.LLM_STREAMING, 'START_LLM_STREAM');
  });

  it('text_input → LLM_STREAMING, a typed question needs no transcription', () => {
    expectTransition(ServerState.IDLE, 'text_input', ServerState.LLM_STREAMING, 'START_LLM_STREAM');
  });

  it('text_input is not valid while the student speaks or an answer streams', () => {
    expectInvalidTransition(ServerState.LISTENING, 'text_input');
    expectInvalidTransition(ServerState.TRANSCRIBING, 'text_input');
    expectInvalidTransition(ServerState.LLM_STREAMING, 'text_input');
  });

  it('session_opener is not valid mid-turn', () => {
    expectInvalidTransition(ServerState.LISTENING, 'session_opener');
  });

  it('speech_start → LISTENING, opens STT stream', () => {
    expectTransition(ServerState.IDLE, 'speech_start', ServerState.LISTENING, 'OPEN_STT_STREAM');
  });

  it('vad_misfire → IDLE, no-op', () => {
    expectTransition(ServerState.IDLE, 'vad_misfire', ServerState.IDLE, 'NOOP');
  });

  it('speech_end in IDLE → INVALID_STATE', () => {
    expectInvalidTransition(ServerState.IDLE, 'speech_end');
  });

  it('pcm_binary in IDLE → INVALID_STATE', () => {
    expectInvalidTransition(ServerState.IDLE, 'pcm_binary');
  });
});

// ── LISTENING ────────────────────────────────────────────────

describe('LISTENING state', () => {
  it('pcm_binary → LISTENING (buffer frame)', () => {
    expectTransition(ServerState.LISTENING, 'pcm_binary', ServerState.LISTENING);
  });

  it('pcm_binary must NOT re-open the STT stream (would restart the utterance)', () => {
    const result = transition(ServerState.LISTENING, 'pcm_binary');
    expect(isTransitionError(result)).toBe(false);
    if (!isTransitionError(result)) {
      // OPEN_STT_STREAM begins a new utterance; firing it per-frame would throw
      // away everything said so far.
      expect(result.sideEffects).not.toContain('OPEN_STT_STREAM');
    }
  });

  it('speech_end → TRANSCRIBING, commits STT', () => {
    expectTransition(ServerState.LISTENING, 'speech_end', ServerState.TRANSCRIBING, 'COMMIT_STT');
  });

  it('vad_misfire → IDLE, discards buffer', () => {
    expectTransition(ServerState.LISTENING, 'vad_misfire', ServerState.IDLE, 'DISCARD_STT');
  });

  it('speech_start in LISTENING → INVALID_STATE (guard)', () => {
    expectInvalidTransition(ServerState.LISTENING, 'speech_start');
  });
});

// ── TRANSCRIBING ─────────────────────────────────────────────

describe('TRANSCRIBING state', () => {
  it('speech_start while finalizing is ignored', () => {
    expectTransition(ServerState.TRANSCRIBING, 'speech_start', ServerState.TRANSCRIBING);
  });

  it('stt_final → LLM_STREAMING, starts LLM stream', () => {
    expectTransition(ServerState.TRANSCRIBING, 'stt_final', ServerState.LLM_STREAMING, 'START_LLM_STREAM');
  });

  it('stt_error → IDLE, notifies client', () => {
    expectTransition(ServerState.TRANSCRIBING, 'stt_error', ServerState.IDLE, 'NOTIFY_CLIENT_ERROR');
  });

  it('speech_start in TRANSCRIBING → TRANSCRIBING (ignore stray VAD while Whisper works)', () => {
    // Half-duplex: VAD events can arrive during transcription; they are ignored
    // (NOOP) rather than raising INVALID_STATE. See stateMachine TRANSCRIBING case.
    expectTransition(ServerState.TRANSCRIBING, 'speech_start', ServerState.TRANSCRIBING, 'NOOP');
  });
});

// ── LLM_STREAMING ────────────────────────────────────────────

describe('LLM_STREAMING state', () => {
  it('llm_token → TTS_STREAMING, starts TTS', () => {
    expectTransition(ServerState.LLM_STREAMING, 'llm_token', ServerState.TTS_STREAMING, 'START_TTS');
  });

  it('llm_tool_call → TOOL_EXECUTING, sends filler TTS', () => {
    expectTransition(ServerState.LLM_STREAMING, 'llm_tool_call', ServerState.TOOL_EXECUTING, 'SEND_FILLER_TTS');
  });

  it('llm_stream_complete → IDLE, sends turn_complete', () => {
    expectTransition(ServerState.LLM_STREAMING, 'llm_stream_complete', ServerState.IDLE, 'SEND_TURN_COMPLETE');
  });

  it('speech_start (barge-in) → BARGE_IN_INTERRUPTED, aborts Groq + stops TTS', () => {
    const result = transition(ServerState.LLM_STREAMING, 'speech_start');
    expect(isTransitionError(result)).toBe(false);
    if (!isTransitionError(result)) {
      expect(result.nextState).toBe(ServerState.BARGE_IN_INTERRUPTED);
      expect(result.sideEffects).toContain('ABORT_LLM_STREAM');
      expect(result.sideEffects).toContain('STOP_TTS');
    }
  });
});

// ── TTS_STREAMING ────────────────────────────────────────────

describe('TTS_STREAMING state', () => {
  it('llm_token → TTS_STREAMING (more tokens queued for TTS)', () => {
    expectTransition(ServerState.TTS_STREAMING, 'llm_token', ServerState.TTS_STREAMING);
  });

  it('llm_stream_complete → IDLE, sends turn_complete', () => {
    expectTransition(ServerState.TTS_STREAMING, 'llm_stream_complete', ServerState.IDLE, 'SEND_TURN_COMPLETE');
  });

  it('speech_start → TTS_STREAMING (half-duplex: VAD fires on our own playback; no barge-in)', () => {
    // Server-side barge-in during playback was removed for half-duplex operation:
    // the mic hears the assistant's own TTS, so speech_start here is self-echo, not
    // the user. It is ignored (NOOP). Real barge-in is deferred to Phase 6.
    expectTransition(ServerState.TTS_STREAMING, 'speech_start', ServerState.TTS_STREAMING, 'NOOP');
  });
});

// ── TOOL_EXECUTING ───────────────────────────────────────────

describe('TOOL_EXECUTING state', () => {
  it('tool_result_ready → LLM_STREAMING, re-enters LLM stream', () => {
    expectTransition(ServerState.TOOL_EXECUTING, 'tool_result_ready', ServerState.LLM_STREAMING, 'START_LLM_STREAM');
  });

  it('tool_timeout → LLM_STREAMING, injects error + re-enters LLM stream', () => {
    expectTransition(ServerState.TOOL_EXECUTING, 'tool_timeout', ServerState.LLM_STREAMING, 'START_LLM_STREAM');
  });

  it('speech_start in TOOL_EXECUTING → INVALID_STATE', () => {
    expectInvalidTransition(ServerState.TOOL_EXECUTING, 'speech_start');
  });
});

// ── BARGE_IN_INTERRUPTED ─────────────────────────────────────

describe('BARGE_IN_INTERRUPTED state', () => {
  it('speech_start → LISTENING, re-opens STT stream', () => {
    expectTransition(ServerState.BARGE_IN_INTERRUPTED, 'speech_start', ServerState.LISTENING, 'OPEN_STT_STREAM');
  });

  it('vad_misfire → BARGE_IN_INTERRUPTED (ignore stale VAD event after barge-in)', () => {
    expectTransition(ServerState.BARGE_IN_INTERRUPTED, 'vad_misfire', ServerState.BARGE_IN_INTERRUPTED, 'NOOP');
  });

  it('stt_final in BARGE_IN_INTERRUPTED → INVALID_STATE', () => {
    expectInvalidTransition(ServerState.BARGE_IN_INTERRUPTED, 'stt_final');
  });
});

// ── llm_error (Groq failure) handling ────────────────────────
// Regression: a Groq failure must reset to IDLE and notify the client,
// NOT throw INVALID_STATE and leave the session stuck (see prod incident
// where llm_error was routed through stt_error, invalid in LLM_STREAMING).

describe('llm_error handling', () => {
  it('LLM_STREAMING + llm_error → IDLE, notifies client', () => {
    expectTransition(ServerState.LLM_STREAMING, 'llm_error', ServerState.IDLE, 'NOTIFY_CLIENT_ERROR');
  });

  it('TTS_STREAMING + llm_error → IDLE, stops TTS + notifies client', () => {
    const result = transition(ServerState.TTS_STREAMING, 'llm_error');
    expect(isTransitionError(result)).toBe(false);
    if (!isTransitionError(result)) {
      expect(result.nextState).toBe(ServerState.IDLE);
      expect(result.sideEffects).toContain('STOP_TTS');
      expect(result.sideEffects).toContain('NOTIFY_CLIENT_ERROR');
    }
  });

  it('TOOL_EXECUTING + llm_error → IDLE, notifies client', () => {
    expectTransition(ServerState.TOOL_EXECUTING, 'llm_error', ServerState.IDLE, 'NOTIFY_CLIENT_ERROR');
  });

  it('llm_error is NOT valid in IDLE (guard against stray/late errors)', () => {
    expectInvalidTransition(ServerState.IDLE, 'llm_error');
  });
});
