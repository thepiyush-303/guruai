// ============================================================
// protocol.ts — the wire contract, client side.
// Mirrors the server→client half of src/types.ts. Kept as a
// separate copy because the client is a separate build with its
// own tsconfig; if you change a message shape, change both.
// ============================================================

export const SAMPLE_RATE = 16000; // PRD §2.1 — exactly 16kHz
export const FRAME_SIZE = 512; // PRD §2.1/§2.2 — 512 samples = 32ms
export const TTS_SAMPLE_RATE = 22050; // Gnani Timbre is asked for raw s16le at this rate

// ── Languages & preferences (mirrors src/languages.ts) ────────

export type LanguageId = 'en' | 'hi' | 'hinglish' | 'bn' | 'gu' | 'kn' | 'ml' | 'mr' | 'pa' | 'ta' | 'te';

export interface LanguageOption {
  id: LanguageId;
  label: string;
  nativeLabel: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { id: 'hinglish', label: 'Hinglish', nativeLabel: 'Hinglish' },
  { id: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
  { id: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી' },
  { id: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
  { id: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം' },
  { id: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
  { id: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ' },
  { id: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
  { id: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
];

export function isLanguageId(v: unknown): v is LanguageId {
  return LANGUAGE_OPTIONS.some((l) => l.id === v);
}

export function languageOption(id: LanguageId): LanguageOption {
  return LANGUAGE_OPTIONS.find((l) => l.id === id) ?? LANGUAGE_OPTIONS[0];
}

export type Board = 'CBSE' | 'ICSE' | 'STATE' | 'OTHER';

export const GRADE_OPTIONS: Array<{ value: string; label: string }> = [
  ...['6', '7', '8', '9', '10', '11', '12'].map((g) => ({ value: g, label: `Class ${g}` })),
  { value: 'college', label: 'College' },
];

export const BOARD_OPTIONS: Array<{ value: Board; label: string }> = [
  { value: 'CBSE', label: 'CBSE' },
  { value: 'ICSE', label: 'ICSE' },
  { value: 'STATE', label: 'State board' },
  { value: 'OTHER', label: 'Other' },
];

export interface Preferences {
  language: LanguageId;
  /** Timbre voice id (see GET /api/voices). */
  voice?: string;
  grade?: string;
  board?: Board;
}

/** One Timbre voice, as listed by GET /api/voices. */
export interface VoiceOption {
  id: string;
  gender: 'Female' | 'Male';
  persona: string;
  language?: string;
}

/** A saved study session, as listed by GET /api/sessions. */
export interface SessionSummary {
  id: string;
  /** Generated from the conversation ('auto') or typed by the student ('user'); null until then. */
  title: string | null;
  title_source: 'auto' | 'user' | null;
  group_id: string | null;
  language: LanguageId;
  voice: string | null;
  grade: string | null;
  board: Board | null;
  created_ts: number;
  updated_ts: number;
  turn_count: number;
  last_text: string | null;
}

/** One small idea of a lesson, as tracked by the session memory. */
export interface LessonChunk {
  title: string;
  status: 'pending' | 'explained' | 'understood' | 'struggling';
}

/** Lesson progress of the open session (from the server's session memory). */
export interface LessonView {
  topic: string | null;
  gist: string;
  chunks: LessonChunk[];
  next: number;
}

/** One item of the study notes. */
export interface NoteBlock {
  id: string;
  kind: 'point' | 'definition' | 'formula' | 'example' | 'tip' | 'question' | string;
  text: string;
  latex?: string;
}

export interface Notebook {
  subject: string | null;
  topic: string | null;
  version: number;
  sections: Array<{ id: string; heading: string; blocks: NoteBlock[] }>;
}

/** The open session's notes, as last sent by the server. */
export interface NotesState {
  sessionId: string;
  enabled: boolean;
  defaultEnabled: boolean;
  notebook: Notebook;
  pdfAvailable: boolean;
  pdfReason: string | null;
}

/** What GuruAI remembers about the student (GET /api/profile). */
export interface LearnerProfile {
  name?: string;
  class?: string;
  board?: string;
  school?: string;
  city?: string;
  exam_goal?: string;
  interests?: string[];
  learning_preferences?: string[];
  strengths?: string[];
  difficulties?: string[];
  notes?: string[];
}

/** A student-made folder of sessions. */
export interface SessionGroup {
  id: string;
  name: string;
  created_ts: number;
  updated_ts: number;
}

// Server state machine (src/types.ts ServerState). A union rather than an
// enum: the client tsconfig sets erasableSyntaxOnly, which forbids enums.
export type ServerState =
  | 'IDLE'
  | 'LISTENING'
  | 'TRANSCRIBING'
  | 'LLM_STREAMING'
  | 'TTS_STREAMING'
  | 'BARGE_IN_INTERRUPTED'
  | 'TOOL_EXECUTING';

export interface GroundingSource {
  title: string;
  uri: string;
}

/** One persisted line of conversation, as loaded from the server on connect. */
export interface PersistedTurn {
  role: 'user' | 'assistant';
  content: string;
  session_id: string;
  ts: number;
}

export type ServerMessage =
  | {
      type: 'session_ack';
      session_id: string;
      server_version: string;
      tts_sample_rate: number;
      state: ServerState;
      resumed: boolean;
      title: string | null;
      group_id: string | null;
    }
  | { type: 'state_change'; from: ServerState; to: ServerState; timestamp_ms: number }
  | { type: 'transcript_partial'; session_id: string; text: string; confidence: number | null; timestamp_ms: number }
  | { type: 'transcript_final'; session_id: string; text: string; duration_ms: number; timestamp_ms: number; detected_language?: string }
  | { type: 'llm_token'; session_id: string; delta: string; token_index: number; timestamp_ms: number }
  | { type: 'tool_call'; session_id: string; tool_call_id: string; tool_name: string; arguments: Record<string, unknown>; timestamp_ms: number }
  | { type: 'tts_interrupted'; session_id: string; reason: 'barge_in' | 'stopped' | 'new_question' | 'voice_off'; timestamp_ms: number }
  | { type: 'turn_complete'; session_id: string; total_latency_ms: number; token_count: number; timestamp_ms: number }
  | { type: 'error'; session_id: string; code: string; message: string; recoverable: boolean; timestamp_ms: number }
  | { type: 'grounding_sources'; session_id: string; queries: string[]; sources: GroundingSource[]; timestamp_ms: number }
  | { type: 'history_load'; session_id: string; turns: PersistedTurn[] }
  | { type: 'preferences_ack'; session_id: string; preferences: Preferences; live_captions: boolean; tts_voice: string }
  | { type: 'tts_state'; session_id: string; active: boolean; timestamp_ms: number; spoken?: number; failed?: number }
  | { type: 'session_updated'; session_id: string; title: string | null }
  | ({ type: 'session_context'; session_id: string } & LessonView)
  | {
      type: 'notes_update';
      session_id: string;
      enabled: boolean;
      default_enabled: boolean;
      notebook: Notebook;
      pdf_available: boolean;
      pdf_reason: string | null;
    };

export type ClientMessage =
  | {
      type: 'session_init';
      session_id: string;
      audio_format: { sample_rate: number; channels: 1; bit_depth: 16; encoding: 'pcm_s16le' };
      client_capabilities: { supports_barge_in: boolean; vad_library: string; browser: string };
      preferences: Preferences;
      /** Continue the saved session `session_id` instead of starting a new one. */
      resume: boolean;
      /** For a new session: the group to save it in. */
      group_id: string | null;
      /** Speak replies (default) or send text only. */
      voice_output: boolean;
    }
  | { type: 'text_input'; session_id: string; text: string }
  | { type: 'set_voice_output'; session_id: string; enabled: boolean }
  | { type: 'stop_speaking'; session_id: string }
  | { type: 'update_preferences'; session_id: string; preferences: Partial<Preferences> }
  | { type: 'switch_session'; session_id: string; preferences: Preferences; resume: boolean; group_id: string | null }
  | { type: 'set_notes'; session_id: string; enabled: boolean }
  | { type: 'speech_start'; session_id: string; timestamp_ms: number }
  | { type: 'speech_end'; session_id: string; duration_ms: number; timestamp_ms: number }
  | { type: 'vad_misfire'; session_id: string; timestamp_ms: number };

// ── UI-facing projections ─────────────────────────────────────

export type Connection = 'disconnected' | 'connecting' | 'connected';

/** What the user is being told is happening, independent of connection. */
export type Turn = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Server state → turn. TTS_STREAMING is deliberately *not* mapped to
 *  'speaking': the server leaves that state the moment the last audio chunk is
 *  written, seconds before the user stops hearing it. The UI decides
 *  'speaking' from the playback clock instead (see useAudioPlayback). */
export function turnFor(state: ServerState): Turn {
  switch (state) {
    case 'LISTENING':
      return 'listening';
    case 'TRANSCRIBING':
    case 'LLM_STREAMING':
    case 'TOOL_EXECUTING':
      return 'thinking';
    case 'TTS_STREAMING':
      return 'speaking';
    case 'IDLE':
    case 'BARGE_IN_INTERRUPTED':
      return 'idle';
  }
}

export type LogKind = 'sys' | 'in' | 'out' | 'err';

export interface LogEntry {
  id: number;
  at: string; // HH:MM:SS.mmm
  kind: LogKind;
  text: string;
}
