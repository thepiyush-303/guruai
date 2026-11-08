// ============================================================
// types.ts — All shared types for the voice agent server
// Derived from PRD §3 (WebSocket Protocol & State Machine)
// ============================================================

import type { LanguageId } from './languages';

// ── Server State Machine ─────────────────────────────────────

export enum ServerState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  TRANSCRIBING = 'TRANSCRIBING',
  LLM_STREAMING = 'LLM_STREAMING',
  TTS_STREAMING = 'TTS_STREAMING',
  BARGE_IN_INTERRUPTED = 'BARGE_IN_INTERRUPTED',
  TOOL_EXECUTING = 'TOOL_EXECUTING',
}

// ── Named Side Effects (Phase 1: stubs; replaced in later phases) ──

export type SideEffectName =
  | 'OPEN_STT_STREAM'     // new utterance on the Gnani Prisma socket
  | 'COMMIT_STT'          // speech_end: commit the utterance, await the final
  | 'DISCARD_STT'         // vad_misfire: drop the utterance
  | 'START_LLM_STREAM'
  | 'ABORT_LLM_STREAM'
  | 'START_TTS'           // first LLM token: open a sentence buffer → Gnani Timbre
  | 'STOP_TTS'            // drop queued speech and cancel the request in flight
  | 'SEND_FILLER_TTS'
  | 'SEND_TURN_COMPLETE'
  | 'NOTIFY_CLIENT_ERROR'
  | 'EXECUTE_TOOL'
  | 'NOOP';

// ── Incoming Events (from client or internal) ─────────────────

export type IncomingEventType =
  | 'session_init'
  | 'speech_start'
  | 'speech_end'
  | 'vad_misfire'
  | 'tool_result'
  | 'update_preferences'  // client changes voice / class / board (IDLE only)
  | 'switch_session'      // client starts a new session or resumes a saved one (IDLE only)
  | 'session_opener'      // internal: GuruAI speaks first when a session opens
  | 'set_notes'           // client switches study notes on/off for this session
  | 'text_input'          // client typed a question instead of speaking it (IDLE only)
  | 'set_voice_output'    // client switches spoken replies on/off (text-only mode)
  | 'stop_speaking'       // client asks GuruAI to stop talking (between answers)
  | 'pcm_binary'          // internal tag for binary WS frames
  | 'stt_final'           // internal: Gnani Prisma final transcript for the utterance
  | 'stt_error'           // internal: Gnani Prisma failure / timeout
  | 'vosk_partial'        // internal: live interim caption from Vosk (display-only)
  | 'vosk_final'          // internal: Vosk end-of-utterance caption (display-only)
  | 'llm_token'           // internal: text delta from Groq/Gemini
  | 'llm_tool_call'       // internal: tool_call delta from Groq/Gemini
  | 'llm_stream_complete' // internal: LLM stream finished
  | 'llm_error'           // internal: LLM stream failed (bad key/model/network)
  | 'tool_result_ready'   // internal: tool executor finished
  | 'tool_timeout'        // internal: tool exceeded 500ms
  | 'grounding_sources';  // internal: Gemini grounding metadata (Phase 9)

export interface IncomingEvent {
  type: IncomingEventType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

// ── Session preferences (GuruAI) ──────────────────────────────

export type Board = 'CBSE' | 'ICSE' | 'STATE' | 'OTHER';

export interface SessionPreferences {
  language: LanguageId;
  /** Timbre voice id; must belong to the configured TTS model. */
  voice?: string;
  /** "6".."12" or "college"; optional. */
  grade?: string;
  board?: Board;
  /** What this session is about: a syllabus topic, or an open-chat area. */
  study?: StudyChoice;
}

/**
 * A syllabus topic (see src/catalog), or free chat in a category. `ask` is a
 * first question to answer straight away instead of the greeting.
 */
export type StudyChoice =
  | { kind: 'topic'; topicId: string }
  | { kind: 'open'; categoryId: string; ask?: string };

// ── Client → Server JSON Messages (PRD §3.3.1) ───────────────

export interface SessionInitMessage {
  type: 'session_init';
  session_id: string;
  audio_format: {
    sample_rate: 16000;
    channels: 1;
    bit_depth: 16;
    encoding: 'pcm_s16le';
  };
  client_capabilities: {
    supports_barge_in: boolean;
    vad_library: string;
    browser: string;
  };
  /** GuruAI: language / voice / class / board. Defaults to English when absent. */
  preferences?: Partial<SessionPreferences>;
  /** Resume the saved session `session_id` (its language and history) instead of starting fresh. */
  resume?: boolean;
  /** For a NEW session: the student-made group to save it in. */
  group_id?: string | null;
  /** Speak the replies (default) or send text only. Per device, so per connection. */
  voice_output?: boolean;
}

export interface SpeechStartMessage {
  type: 'speech_start';
  session_id: string;
  timestamp_ms: number;
}

export interface SpeechEndMessage {
  type: 'speech_end';
  session_id: string;
  duration_ms: number;
  timestamp_ms: number;
}

export interface VadMisfireMessage {
  type: 'vad_misfire';
  session_id: string;
  timestamp_ms: number;
}

export interface ToolResultMessage {
  type: 'tool_result';
  tool_call_id: string;
  result: unknown;
  error: string | null;
}

/** Change voice / class / board within the current session. Language is fixed per session. */
export interface UpdatePreferencesMessage {
  type: 'update_preferences';
  session_id: string;
  preferences: Partial<SessionPreferences>;
}

/** Switch study notes on/off for the current session. */
export interface SetNotesMessage {
  type: 'set_notes';
  session_id: string;
  enabled: boolean;
}

/** Leave the current session for a new one (e.g. a new language) or a saved one. */
export interface SwitchSessionMessage {
  type: 'switch_session';
  session_id: string;
  preferences?: Partial<SessionPreferences>;
  resume?: boolean;
  /** For a NEW session: the student-made group to save it in. */
  group_id?: string | null;
}

/** A question typed instead of spoken. Treated exactly like a final transcript. */
export interface TextInputMessage {
  type: 'text_input';
  session_id: string;
  text: string;
}

/** Spoken replies on/off for this connection (off: text only, no TTS calls). */
export interface SetVoiceOutputMessage {
  type: 'set_voice_output';
  session_id: string;
  enabled: boolean;
}

/** Stop the answer being spoken right now (the text stays). */
export interface StopSpeakingMessage {
  type: 'stop_speaking';
  session_id: string;
}

export type ClientMessage =
  | SessionInitMessage
  | TextInputMessage
  | SetVoiceOutputMessage
  | StopSpeakingMessage
  | SpeechStartMessage
  | SpeechEndMessage
  | VadMisfireMessage
  | ToolResultMessage
  | UpdatePreferencesMessage
  | SwitchSessionMessage
  | SetNotesMessage;

// ── Server → Client JSON Messages (PRD §3.3.2) ───────────────

export interface SessionAckMessage {
  type: 'session_ack';
  session_id: string;
  server_version: string;
  tts_sample_rate: 22050;
  state: ServerState;
  /** True when this is a saved session being continued. */
  resumed: boolean;
  /** The session's title (generated from its content, or typed by the student). */
  title: string | null;
  /** The group the session belongs to, if any. */
  group_id: string | null;
}

export interface StateChangeMessage {
  type: 'state_change';
  from: ServerState;
  to: ServerState;
  timestamp_ms: number;
}

export interface TranscriptPartialMessage {
  type: 'transcript_partial';
  session_id: string;
  text: string;
  confidence: number | null;
  timestamp_ms: number;
}

export interface TranscriptFinalMessage {
  type: 'transcript_final';
  session_id: string;
  text: string;
  duration_ms: number;
  timestamp_ms: number;
  /** Prisma v3.0 language identification, when it reports one. */
  detected_language?: string;
}

// GuruAI: the server's effective preferences after session_init / update_preferences.
export interface PreferencesAckMessage {
  type: 'preferences_ack';
  session_id: string;
  preferences: SessionPreferences;
  /** Vosk has a model for this language, so live captions will appear. */
  live_captions: boolean;
  tts_voice: string;
}

export interface LlmTokenMessage {
  type: 'llm_token';
  session_id: string;
  delta: string;
  token_index: number;
  timestamp_ms: number;
}

export interface ToolCallMessage {
  type: 'tool_call';
  session_id: string;
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  timestamp_ms: number;
}

export interface TtsInterruptedMessage {
  type: 'tts_interrupted';
  session_id: string;
  reason: 'barge_in' | 'stopped' | 'new_question' | 'voice_off';
  timestamp_ms: number;
}

export interface TurnCompleteMessage {
  type: 'turn_complete';
  session_id: string;
  total_latency_ms: number;
  token_count: number;
  timestamp_ms: number;
}

export interface ErrorMessage {
  type: 'error';
  session_id: string;
  code: 'STT_FAIL' | 'LLM_TIMEOUT' | 'TTS_FAIL' | 'TOOL_TIMEOUT' | 'INVALID_STATE' | 'INTERNAL';
  message: string;
  recoverable: boolean;
  timestamp_ms: number;
}

// v2.0 Phase 9: server → client, rendered as visual attribution panel (never spoken)
export interface GroundingSourcesMessage {
  type: 'grounding_sources';
  session_id: string;
  queries: string[];
  sources: Array<{ title: string; uri: string }>;
  timestamp_ms: number;
}

// Sent right after session_ack: this session's saved transcript (empty for a
// new session), so the client can show where the student left off.
// Display-only — distinct from the LLM's in-prompt context.
export interface HistoryLoadMessage {
  type: 'history_load';
  session_id: string;
  turns: Array<{ role: 'user' | 'assistant'; content: string; session_id: string; ts: number }>;
}

// GuruAI: the server's speech output started (first sentence queued) or is
// finished (queue drained / cancelled). The client keeps the mic closed while
// active — including the gaps between sentences, which the playback clock alone
// cannot see — so GuruAI never "hears" itself.
export interface TtsStateMessage {
  type: 'tts_state';
  session_id: string;
  active: boolean;
  timestamp_ms: number;
  /** On active=false: sentences spoken in full, and those that could not be spoken. */
  spoken?: number;
  failed?: number;
}

// GuruAI: the lesson's progress, from the session memory (sent when a session
// opens and after every background memory update).
export interface SessionContextMessage {
  type: 'session_context';
  session_id: string;
  topic: string | null;
  gist: string;
  chunks: Array<{ title: string; status: 'pending' | 'explained' | 'understood' | 'struggling' }>;
  next: number;
}

// GuruAI: the session's study notes (sent on open, on every change, on toggle).
export interface NotesUpdateMessage {
  type: 'notes_update';
  session_id: string;
  enabled: boolean;
  /** Whether new sessions start with notes on. */
  default_enabled: boolean;
  notebook: {
    subject: string | null;
    topic: string | null;
    version: number;
    sections: Array<{ id: string; heading: string; blocks: Array<{ id: string; kind: string; text: string; latex?: string }> }>;
  };
  pdf_available: boolean;
  pdf_reason: string | null;
}

// GuruAI: a session's metadata changed (e.g. its title was generated).
export interface SessionUpdatedMessage {
  type: 'session_updated';
  session_id: string;
  title: string | null;
}

export type ServerMessage =
  | SessionAckMessage
  | StateChangeMessage
  | TranscriptPartialMessage
  | TranscriptFinalMessage
  | LlmTokenMessage
  | ToolCallMessage
  | TtsInterruptedMessage
  | TurnCompleteMessage
  | ErrorMessage
  | GroundingSourcesMessage
  | HistoryLoadMessage
  | PreferencesAckMessage
  | TtsStateMessage
  | SessionUpdatedMessage
  | SessionContextMessage
  | NotesUpdateMessage;

// ── Session Context ───────────────────────────────────────────

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  /** In-memory only (e.g. the opener instruction) — never stored or shown. */
  ephemeral?: boolean;
}

export interface SessionContext {
  sessionId: string;
  state: ServerState;
  preferences: SessionPreferences;
  /** Group a new session is saved into on its first turn. */
  groupId?: string | null;
  /** Set by the session_opener event; consumed by the next START_LLM_STREAM. */
  pendingOpener?: 'new' | 'resumed' | 'open';
  /** The LLM turn in flight is the opener: its reply is spoken but not stored. */
  openerActive?: boolean;
  conversationHistory: ConversationMessage[];
  tokenCount: number;
  turnStartedAt: number | null;
  createdAt: number;
  // Per-turn latency instrumentation (all reset on speech_start). Used to log the
  // REAL responsiveness breakdown — STT wall time, Groq time-to-first-token, and
  // perceived speech_end→first-token — instead of the misleading speech_start-based
  // total_latency_ms. See messageHandler.
  speechEndAt?: number | null;
  sttFinalAt?: number | null;
  firstTokenAt?: number | null;
  // First live Vosk caption of the turn — measures how fast the user sees words
  // appear, which is the responsiveness the live-STT work is meant to improve.
  voskFirstPartialAt?: number | null;
  // Set just before a NOTIFY_CLIENT_ERROR side-effect so the dispatcher can
  // send the real error code+message to the client. Cleared after sending.
  pendingError?: { code: ErrorMessage['code']; message: string };
  // Set just before an EXECUTE_TOOL side-effect
  pendingToolCall?: { name: string; args: string; id?: string };
}
