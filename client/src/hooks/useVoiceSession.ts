// ============================================================
// useVoiceSession — one study session on one socket.
//
// Opens the connection when the session page mounts (or its id changes) and
// closes it when the page goes away. Owns everything that happens inside a
// session: the conversation thread, the mic and its gating, the TTS playback,
// typed questions, lesson progress, notes and the event log.
//
// Two axes, as before:
//   connection: disconnected | connecting | connected   (the socket)
//   turn:       idle | listening | thinking | speaking  (what's happening)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api.ts';
import type { LevelSource } from './useOrbLevel.ts';
import { useAudioPlayback } from './useAudioPlayback.ts';
import { useOrbLevel } from './useOrbLevel.ts';
import { useVadMic } from './useVadMic.ts';
import { useWsClient } from './useWsClient.ts';
import {
  turnFor,
  type GroundingSource,
  type LessonView,
  type LogEntry,
  type LogKind,
  type NotesState,
  type Preferences,
  type ServerMessage,
  type ServerState,
  type Turn,
} from '../protocol.ts';

/** Log entries kept in memory. Old lines are dropped, not persisted. */
const MAX_LOG = 300;
/** How long a newly added note stays highlighted. */
const FRESH_MS = 2500;

let turnKey = 0;
const nextKey = () => `t${turnKey++}`;

export interface ThreadTurn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
}

/** The reply being produced right now (its reveal is paced to the audio). */
export interface LiveReply {
  id: number;
  text: string;
  /** The first audio of this reply has arrived. */
  audioStarted: boolean;
  sources: GroundingSource[];
}

interface Options {
  sessionId: string;
  prefs: Preferences;
  /** Continue a saved session (false: a brand-new one). */
  resume: boolean;
  groupId: string | null;
  voiceOutput: boolean;
  /** The session list may have changed (new turn, new title). */
  onLibraryChanged: () => void;
}

export function useVoiceSession({ sessionId, prefs, resume, groupId, voiceOutput, onLibraryChanged }: Options) {
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<ThreadTurn[]>([]);
  const [userDraft, setUserDraft] = useState(''); // live (Vosk) words while the student speaks
  const [reply, setReply] = useState<LiveReply>({ id: 0, text: '', audioStarted: false, sources: [] });
  const [title, setTitle] = useState<string | null>(null);
  const [activePrefs, setActivePrefs] = useState<Preferences>(prefs);
  const [liveCaptions, setLiveCaptions] = useState(true);
  const [ttsActive, setTtsActive] = useState(false);
  const [lesson, setLesson] = useState<LessonView | null>(null);
  const [notes, setNotes] = useState<NotesState | null>(null);
  const [freshNotes, setFreshNotes] = useState<ReadonlySet<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const replyRef = useRef(reply);
  const notesRef = useRef<NotesState | null>(null);
  const freshTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef(sessionId);
  const voiceOutputRef = useRef(voiceOutput);
  const libraryRef = useRef(onLibraryChanged);
  useEffect(() => {
    replyRef.current = reply;
    voiceOutputRef.current = voiceOutput;
    libraryRef.current = onLibraryChanged;
  });

  const logIdRef = useRef(0);
  const log = useCallback((text: string, kind: LogKind = 'sys') => {
    const at = new Date().toISOString().slice(11, 23);
    const entry: LogEntry = { id: logIdRef.current++, at, kind, text };
    setLogs((prev) => (prev.length < MAX_LOG ? [...prev, entry] : [...prev.slice(-(MAX_LOG - 1)), entry]));
  }, []);

  const playback = useAudioPlayback(log);
  const { enqueue, flush, remainingMs, speaking, analyserRef } = playback;

  /** Move the live reply into the settled thread (before a new turn starts). */
  const settleReply = useCallback(() => {
    const text = replyRef.current.text.trim();
    if (text) setTurns((t) => [...t, { key: nextKey(), role: 'assistant', text }]);
  }, []);

  const newReply = useCallback(() => {
    setReply((r) => ({ id: r.id + 1, text: '', audioStarted: false, sources: [] }));
  }, []);

  // Seconds of audio received for the current reply (diagnostics in the log).
  const audioBytesRef = useRef(0);

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'session_ack':
          setServerState(msg.state);
          sessionIdRef.current = msg.session_id;
          setTitle(msg.title);
          log(`${msg.resumed ? 'resumed' : 'new'} session ${msg.session_id.slice(0, 8)}${msg.title ? ` — "${msg.title}"` : ''}`, 'in');
          break;
        case 'history_load':
          setTurns(msg.turns.map((t) => ({ key: nextKey(), role: t.role, text: t.content })));
          setUserDraft('');
          newReply(); // GuruAI speaks first; its reply starts fresh
          setLesson(null);
          setNotes(null);
          notesRef.current = null;
          setLoaded(true);
          if (msg.turns.length > 0) log(`loaded ${msg.turns.length} saved turn(s)`, 'in');
          break;
        case 'preferences_ack':
          setActivePrefs(msg.preferences);
          setLiveCaptions(msg.live_captions);
          log(`voice ${msg.tts_voice}${msg.live_captions ? '' : ' · no live captions for this language'}`, 'in');
          break;
        case 'state_change':
          setServerState(msg.to);
          log(`${msg.from} → ${msg.to}`, 'in');
          break;
        case 'transcript_partial':
          setUserDraft(msg.text);
          break;
        case 'transcript_final':
          // A new student turn: the previous reply settles, a new one begins.
          settleReply();
          setTurns((t) => [...t, { key: nextKey(), role: 'user', text: msg.text }]);
          setUserDraft('');
          newReply();
          setNotice(null);
          audioBytesRef.current = 0;
          if (msg.detected_language) log(`detected language: ${msg.detected_language}`, 'in');
          log(`heard: "${msg.text}"${msg.duration_ms ? ` (${msg.duration_ms}ms)` : ''}`, 'in');
          break;
        case 'llm_token':
          setReply((r) => ({ ...r, text: r.text + msg.delta }));
          break;
        case 'grounding_sources':
          setReply((r) => ({ ...r, sources: msg.sources }));
          break;
        case 'tts_state':
          setTtsActive(msg.active);
          if (!msg.active && msg.spoken !== undefined) {
            const secs = audioBytesRef.current / 2 / 22050;
            log(
              `speech done — ${msg.spoken} sentence(s) spoken${msg.failed ? `, ${msg.failed} could not be spoken` : ''}, ${secs.toFixed(1)}s of audio received`,
              msg.failed ? 'err' : 'in',
            );
          }
          break;
        case 'tts_interrupted':
          setTtsActive(false);
          flush();
          log(`playback stopped (${msg.reason})`, 'in');
          break;
        case 'turn_complete':
          setServerState('IDLE');
          log(`turn complete (${msg.token_count} tokens)`, 'in');
          libraryRef.current();
          break;
        case 'session_context':
          if (msg.session_id === sessionIdRef.current) {
            setLesson({ topic: msg.topic, gist: msg.gist, chunks: msg.chunks, next: msg.next });
          }
          break;
        case 'notes_update': {
          if (msg.session_id !== sessionIdRef.current) break;
          const next: NotesState = {
            sessionId: msg.session_id,
            enabled: msg.enabled,
            defaultEnabled: msg.default_enabled,
            notebook: msg.notebook,
            pdfAvailable: msg.pdf_available,
            pdfReason: msg.pdf_reason,
          };
          // Highlight blocks that are new since the last update of this session.
          const prev = notesRef.current;
          if (prev && prev.sessionId === next.sessionId) {
            const old = new Set(prev.notebook.sections.flatMap((s) => s.blocks.map((b) => b.id)));
            const added = next.notebook.sections.flatMap((s) => s.blocks.map((b) => b.id)).filter((id) => !old.has(id));
            if (added.length > 0) {
              setFreshNotes(new Set(added));
              if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
              freshTimerRef.current = window.setTimeout(() => setFreshNotes(new Set()), FRESH_MS);
              log(`notes: +${added.length}`, 'in');
            }
          }
          notesRef.current = next;
          setNotes(next);
          break;
        }
        case 'session_updated':
          if (msg.session_id === sessionIdRef.current) setTitle(msg.title);
          libraryRef.current();
          break;
        case 'tool_call':
          log(`tool: ${msg.tool_name}`, 'in');
          break;
        case 'error':
          log(`${msg.code}: ${msg.message}`, 'err');
          // Say it where the student is looking, briefly.
          if (msg.code === 'STT_FAIL' || msg.code === 'INVALID_STATE' || msg.code === 'LLM_TIMEOUT') setNotice(msg.message);
          break;
      }
    },
    [flush, log, newReply, settleReply],
  );

  const onClosed = useCallback(() => {
    setServerState(null);
    setTtsActive(false);
  }, []);

  const onAudio = useCallback(
    (frame: ArrayBuffer) => {
      if (!voiceOutputRef.current) return; // switched off: drop what is in flight
      audioBytesRef.current += Math.max(0, frame.byteLength - 4);
      setReply((r) => (r.audioStarted ? r : { ...r, audioStarted: true }));
      enqueue(frame);
    },
    [enqueue],
  );

  const ws = useWsClient({ onMessage, onAudio, onClosed, log });
  const { connect, disconnect, send } = ws;

  // ── Connection lifecycle: one socket per session page ────────
  // The latest options are read at connect time only; changing them does not
  // reconnect (the voice is changed in-session, the language never is).
  const connectArgsRef = useRef({ prefs, resume, groupId });
  useEffect(() => {
    connectArgsRef.current = { prefs, resume, groupId };
  });
  useEffect(() => {
    const { prefs: p, resume: r, groupId: g } = connectArgsRef.current;
    sessionIdRef.current = sessionId;
    connect(p, { sessionId, resume: r, groupId: g, voiceOutput: voiceOutputRef.current });
    return () => {
      flush();
      disconnect();
    };
  }, [sessionId, connect, disconnect, flush]);

  const connected = ws.connection === 'connected';

  // ── Voice output on/off ──────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    send({ type: 'set_voice_output', session_id: sessionIdRef.current, enabled: voiceOutput });
    if (!voiceOutput) flush();
  }, [voiceOutput, connected, send, flush]);

  // ── Mic and gating ───────────────────────────────────────────
  const canCapture = connected && !muted;
  // The mic is ignored while GuruAI is speaking (and for the rest of the
  // server's turn), so neither its own voice nor room noise starts a new turn.
  const gated = speaking || ttsActive || (serverState !== null && serverState !== 'IDLE' && serverState !== 'LISTENING');
  const gatedRef = useRef(gated);
  useEffect(() => {
    gatedRef.current = gated;
  });

  const micLevelRef = useVadMic({
    active: canCapture,
    gatedRef,
    sessionIdRef,
    sendJson: send,
    sendPcm: ws.sendPcm,
    log,
  });

  const source: LevelSource = speaking ? 'tts' : canCapture ? 'mic' : 'none';
  const readLevel = useOrbLevel(micLevelRef, analyserRef, source);

  const turn: Turn = speaking || ttsActive ? 'speaking' : serverState ? turnFor(serverState) : 'idle';

  const status =
    ws.connection === 'connecting'
      ? 'Connecting…'
      : ws.connection === 'disconnected'
        ? 'Offline'
        : turn === 'listening'
          ? 'Listening…'
          : turn === 'thinking'
            ? 'Thinking…'
            : turn === 'speaking'
              ? 'Speaking'
              : muted
                ? 'Mic off — type, or turn the mic on'
                : 'Listening for your question';

  // A typed question can go between answers; while GuruAI is still talking it
  // replaces the rest of that answer.
  const canSend = connected && (serverState === 'IDLE' || serverState === null);
  const sendText = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || !canSend) return false;
      flush();
      send({ type: 'text_input', session_id: sessionIdRef.current, text: clean });
      return true;
    },
    [canSend, flush, send],
  );

  const stopSpeaking = useCallback(() => {
    flush();
    send({ type: 'stop_speaking', session_id: sessionIdRef.current });
  }, [flush, send]);

  const setNotesEnabled = useCallback(
    (enabled: boolean) => send({ type: 'set_notes', session_id: sessionIdRef.current, enabled }),
    [send],
  );

  const changeNotesDefault = useCallback(
    (enabled: boolean) => {
      api
        .setNotesDefault(enabled)
        .then(() => setNotes((n) => (n ? { ...n, defaultEnabled: enabled } : n)))
        .catch((err: Error) => log(`could not save the notes default: ${err.message}`, 'err'));
    },
    [log],
  );

  const canChangeVoice = connected && (serverState === 'IDLE' || serverState === null) && !speaking && !ttsActive;
  const changeVoice = useCallback(
    (voice: string) => {
      setActivePrefs((p) => ({ ...p, voice }));
      send({ type: 'update_preferences', session_id: sessionIdRef.current, preferences: { voice } });
    },
    [send],
  );

  const reconnect = useCallback(() => {
    const { prefs: p, groupId: g } = connectArgsRef.current;
    // Whatever it was, the session exists by now if anyone spoke: resume it.
    connect(p, { sessionId: sessionIdRef.current, resume: true, groupId: g, voiceOutput: voiceOutputRef.current });
  }, [connect]);

  return {
    connection: ws.connection,
    connected,
    loaded,
    serverState,
    turn,
    status,
    muted,
    setMuted,
    liveCaptions,
    turns,
    userDraft,
    reply,
    remainingMs,
    speaking: speaking || ttsActive,
    title,
    prefs: activePrefs,
    lesson,
    notes,
    freshNotes,
    logs,
    notice,
    dismissNotice: () => setNotice(null),
    readLevel,
    source,
    canSend,
    sendText,
    stopSpeaking,
    setNotesEnabled,
    changeNotesDefault,
    canChangeVoice,
    changeVoice,
    reconnect,
  };
}

export type VoiceSession = ReturnType<typeof useVoiceSession>;
