// ============================================================
// App — owns the two state axes and wires the hooks together.
//
//   connection: disconnected | connecting | connected   (the socket)
//   turn:       idle | listening | thinking | speaking  (what's happening)
//
// The mic may capture only when connected and unmuted. Those are separate on
// purpose: connecting is a deliberate act, and opening the mic is another one.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantCaption, TranscriptSide, UserCaption } from './components/Captions.tsx';
import { Controls } from './components/Controls.tsx';
import { HistorySidebar } from './components/HistorySidebar.tsx';
import { LogSidebar } from './components/LogSidebar.tsx';
import { Orb } from './components/Orb.tsx';
import { SessionSetup } from './components/SessionSetup.tsx';
import * as api from './api.ts';
import type { SessionsSnapshot } from './api.ts';
import type { SessionActions } from './components/SessionList.tsx';
import type { GroupActions } from './components/SessionsPanel.tsx';
import { useAudioPlayback } from './hooks/useAudioPlayback.ts';
import { useOrbLevel, type LevelSource } from './hooks/useOrbLevel.ts';
import { useVadMic } from './hooks/useVadMic.ts';
import { useWsClient } from './hooks/useWsClient.ts';
import {
  GRADE_OPTIONS,
  LANGUAGE_OPTIONS,
  isLanguageId,
  languageOption,
  turnFor,
  type GroundingSource,
  type LanguageId,
  type LogEntry,
  type LogKind,
  type PersistedTurn,
  type Preferences,
  type ServerMessage,
  type ServerState,
  type LessonView,
  type SessionGroup,
  type SessionSummary,
  type VoiceOption,
} from './protocol.ts';

/** Log entries kept in memory. Old lines are dropped, not persisted. */
const MAX_LOG = 300;

/** Settled turns each side of the stage keeps for scroll-back (Fix #3). */
const HISTORY_PER_SIDE = 5;

/** The student's last choices are remembered on this device only. */
const PREFS_KEY = 'guruai.preferences';

function loadPrefs(): Preferences {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Preferences> | null;
    if (raw && isLanguageId(raw.language)) {
      return { language: raw.language, voice: raw.voice, grade: raw.grade, board: raw.board };
    }
  } catch {
    /* storage blocked or corrupt — use defaults */
  }
  return { language: 'en' };
}

function savePrefs(prefs: Preferences): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked — preferences just won't persist */
  }
}

export default function App() {
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [muted, setMuted] = useState(true);
  const [userText, setUserText] = useState('');
  const [userFinal, setUserFinal] = useState(false);
  const [assistantText, setAssistantText] = useState('');
  const [replyId, setReplyId] = useState(0);
  const [sources, setSources] = useState<GroundingSource[]>([]);
  // Flips true on the first TTS audio chunk of a reply; paces the assistant
  // caption reveal (Fix #2). Reset on each new transcript_final.
  const [audioStarted, setAudioStarted] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  // Whether Vosk has a model for this language. Without one, the user's words
  // appear only when Prisma's final arrives — a pulse stands in meanwhile.
  const [liveCaptions, setLiveCaptions] = useState(true);
  useEffect(() => savePrefs(prefs), [prefs]);

  // Voices for the configured Timbre model, and the saved sessions to resume.
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  // The group a session started from the start screen is saved in.
  const [setupGroupId, setSetupGroupId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  // The open session's id, as state for rendering (sessionIdRef serves callbacks).
  const [currentSessionId, setCurrentSessionId] = useState('');
  // The server is still producing speech for this answer (sentences queued or
  // in flight). Covers the gaps between sentences that the playback clock
  // cannot see — without it the mic re-opened in every gap and heard GuruAI.
  const [ttsActive, setTtsActive] = useState(false);
  // Lesson progress of the open session (from the server's session memory).
  const [lesson, setLesson] = useState<LessonView | null>(null);

  // Stage scroll-back: the last few settled turns per side (Fix #3).
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [assistantHistory, setAssistantHistory] = useState<string[]>([]);
  // This session's saved transcript, shown in the sidebar. Seeded from the
  // server when the session opens, then appended to as the session goes.
  const [history, setHistory] = useState<PersistedTurn[]>([]);

  // Refs for stale-closure-safe access to live text (used for archiving).
  const userTextRef = useRef(userText);
  const assistantTextRef = useRef(assistantText);
  const sessionIdRef = useRef('');
  useEffect(() => { userTextRef.current = userText; });
  useEffect(() => { assistantTextRef.current = assistantText; });

  const logIdRef = useRef(0);
  const log = useCallback((text: string, kind: LogKind = 'sys') => {
    const at = new Date().toISOString().slice(11, 23);
    const entry: LogEntry = { id: logIdRef.current++, at, kind, text };
    setLogs((prev) => (prev.length < MAX_LOG ? [...prev, entry] : [...prev.slice(-(MAX_LOG - 1)), entry]));
  }, []);

  const applySnapshot = useCallback((snap: SessionsSnapshot) => {
    setSessions(snap.sessions);
    setGroups(snap.groups);
    // A deleted group must not stay selected for new sessions.
    setSetupGroupId((g) => (g && snap.groups.some((x) => x.id === g) ? g : null));
  }, []);

  const refreshSessions = useCallback(() => {
    api
      .fetchSessions()
      .then(applySnapshot)
      .catch((err: Error) => log(`could not load saved sessions: ${err.message}`, 'err'));
  }, [log, applySnapshot]);

  useEffect(() => {
    refreshSessions();
    api
      .fetchVoices()
      .then((v) => {
        setVoices(v.voices);
        // Keep a remembered voice only if the server's model still offers it.
        setPrefs((p) => (p.voice && v.voices.some((x) => x.id === p.voice) ? p : { ...p, voice: v.default_voice }));
      })
      .catch((err: Error) => log(`could not load voices: ${err.message}`, 'err'));
  }, [refreshSessions, log]);

  const playback = useAudioPlayback(log);
  const { enqueue, flush, remainingMs, speaking, analyserRef } = playback;

  // useWsClient needs this, and this needs useWsClient's disconnect. The ref
  // breaks the cycle; it is assigned right after the hook runs.
  const disconnectRef = useRef<() => void>(() => {});

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'session_ack':
          setServerState(msg.state);
          sessionIdRef.current = msg.session_id;
          setCurrentSessionId(msg.session_id);
          setSessionTitle(msg.title);
          log(`${msg.resumed ? 'resumed' : 'new'} session ${msg.session_id.slice(0, 8)}${msg.title ? ` — "${msg.title}"` : ''}`, 'in');
          break;
        case 'state_change':
          setServerState(msg.to);
          log(`${msg.from} → ${msg.to}`, 'in');
          break;
        case 'transcript_partial':
          setUserText(msg.text);
          setUserFinal(false);
          break;
        case 'transcript_final': {
          if (msg.detected_language) log(`detected language: ${msg.detected_language}`, 'in');
          // Archive the just-finished assistant text as a settled bubble (Fix #3).
          const prevAssistant = assistantTextRef.current.trim();
          if (prevAssistant) {
            setAssistantHistory((h) => [...h.slice(-(HISTORY_PER_SIDE - 1)), prevAssistant]);
          }
          // Archive the previous user text too (the one the assistant just replied to).
          const prevUser = userTextRef.current.trim();
          if (prevUser) {
            setUserHistory((h) => [...h.slice(-(HISTORY_PER_SIDE - 1)), prevUser]);
          }
          setUserText(msg.text);
          setUserFinal(true);
          // A final transcript is the start of a reply, so clear the last one.
          // Bumping the id remounts the caption, which resets its reveal.
          setAssistantText('');
          setReplyId((n) => n + 1);
          setSources([]);
          setAudioStarted(false);
          log(`heard: "${msg.text}" (${msg.duration_ms}ms)`, 'in');
          break;
        }
        case 'llm_token':
          setAssistantText((prev) => prev + msg.delta);
          break;
        case 'tool_call':
          log(`tool: ${msg.tool_name}`, 'in');
          break;
        case 'tts_state':
          setTtsActive(msg.active);
          break;
        case 'session_context':
          if (msg.session_id === sessionIdRef.current) {
            setLesson({ topic: msg.topic, gist: msg.gist, chunks: msg.chunks, next: msg.next });
          }
          break;
        case 'session_updated':
          if (msg.session_id === sessionIdRef.current) setSessionTitle(msg.title);
          refreshSessions();
          break;
        case 'tts_interrupted':
          setTtsActive(false);
          flush();
          log('playback stopped — interrupted', 'in');
          break;
        case 'turn_complete': {
          setServerState('IDLE');
          log(`turn complete (${msg.total_latency_ms}ms, ${msg.token_count} tokens)`, 'in');
          // Append finalized turns to the sidebar history so the current session
          // shows up without waiting for a reconnect (Fix #4).
          const uText = userTextRef.current.trim();
          const aText = assistantTextRef.current.trim();
          const sid = sessionIdRef.current;
          const now = Date.now();
          if (uText) setHistory((h) => [...h, { role: 'user', content: uText, session_id: sid, ts: now - 1 }]);
          if (aText) setHistory((h) => [...h, { role: 'assistant', content: aText, session_id: sid, ts: now }]);
          // The title is generated server-side and arrives as session_updated.
          refreshSessions();
          break;
        }
        case 'grounding_sources':
          setSources(msg.sources);
          log(`${msg.sources.length} source(s) cited`, 'in');
          break;
        case 'error':
          log(`${msg.code}: ${msg.message}`, 'err');
          if (!msg.recoverable) disconnectRef.current();
          break;
        case 'history_load': {
          // A session just opened: show its saved transcript, and put its last
          // exchanges on the stage so a resumed lesson picks up visibly.
          setHistory(msg.turns);
          sessionIdRef.current = msg.session_id;
          const said = (role: 'user' | 'assistant') =>
            msg.turns.filter((t) => t.role === role).slice(-HISTORY_PER_SIDE).map((t) => t.content);
          setUserHistory(said('user'));
          setAssistantHistory(said('assistant'));
          setUserText('');
          setUserFinal(false);
          setAssistantText('');
          setReplyId((n) => n + 1);
          setSources([]);
          // GuruAI speaks first in a new session; its caption must pace to that audio.
          setAudioStarted(false);
          setLesson(null);
          if (msg.turns.length > 0) log(`loaded ${msg.turns.length} saved turn(s)`, 'in');
          break;
        }
        case 'preferences_ack':
          setPrefs(msg.preferences);
          setLiveCaptions(msg.live_captions);
          log(
            `language ${languageOption(msg.preferences.language).label} · voice ${msg.tts_voice}` +
              (msg.live_captions ? '' : ' · no live captions for this language'),
            'in',
          );
          break;
      }
    },
    [flush, log, refreshSessions],
  );

  // Closing the socket — for any reason, including the server dropping it —
  // closes the mic with it.
  const onClosed = useCallback(() => {
    setMuted(true);
    setServerState(null);
    setTtsActive(false);
    refreshSessions();
  }, [refreshSessions]);

  // The first audio chunk of a reply flips audioStarted so the assistant caption
  // starts revealing in step with the voice. setState is idempotent, so the
  // later chunks are no-ops.
  const onAudio = useCallback(
    (frame: ArrayBuffer) => {
      setAudioStarted(true);
      enqueue(frame);
    },
    [enqueue],
  );

  const ws = useWsClient({ onMessage, onAudio, onClosed, log });
  useEffect(() => {
    disconnectRef.current = ws.disconnect;
  });

  const connected = ws.connection === 'connected';
  const canCapture = connected && !muted;

  // The mic is ignored while the assistant's audio is playing and for the rest
  // of the server's turn, so neither our own voice nor room noise can start a
  // new turn. Half-duplex until barge-in lands (D7).
  const gated = speaking || ttsActive || (serverState !== null && serverState !== 'IDLE' && serverState !== 'LISTENING');
  const gatedRef = useRef(gated);
  useEffect(() => {
    gatedRef.current = gated;
  });

  const micLevelRef = useVadMic({
    active: canCapture,
    gatedRef,
    sessionIdRef,
    sendJson: ws.send,
    sendPcm: ws.sendPcm,
    log,
  });

  const source: LevelSource = speaking ? 'tts' : canCapture ? 'mic' : 'none';
  const readLevel = useOrbLevel(micLevelRef, analyserRef, source);

  const turn = speaking || ttsActive ? 'speaking' : serverState ? turnFor(serverState) : 'idle';
  const status =
    ws.connection === 'disconnected'
      ? 'Offline'
      : ws.connection === 'connecting'
        ? 'Connecting'
        : muted
          ? 'Mic off'
          : turn === 'listening'
            ? 'Listening'
            : turn === 'thinking'
              ? 'Thinking'
              : turn === 'speaking'
                ? 'Speaking'
                : 'Ready';

  const placeholder = !connected
    ? 'Not connected.'
    : muted
      ? 'Mic is off.'
      : turn === 'listening' && !liveCaptions
        ? 'Listening…'
        : 'Ask me anything.';

  // Sessions can change only between answers — nothing may be mid-flight.
  const canSwitch = connected && (serverState === 'IDLE' || serverState === null) && !speaking && !ttsActive;

  /** Start a brand-new session with these preferences, optionally inside a group. */
  const startNew = (next: Preferences, groupId: string | null = null) => {
    setPrefs(next);
    setSessionTitle(null);
    if (connected) {
      ws.send({ type: 'switch_session', session_id: crypto.randomUUID(), preferences: next, resume: false, group_id: groupId });
    } else {
      ws.connect(next, { groupId });
      setMuted(false); // the click that starts a lesson is also consent to listen
    }
  };

  /** Continue a saved session: its own language, voice and history. */
  const resume = (s: SessionSummary) => {
    const next: Preferences = {
      language: s.language,
      voice: s.voice ?? prefs.voice,
      grade: s.grade ?? undefined,
      board: s.board ?? undefined,
    };
    setPrefs(next);
    setHistoryOpen(false);
    if (connected) {
      ws.send({ type: 'switch_session', session_id: s.id, preferences: next, resume: true, group_id: null });
    } else {
      ws.connect(next, { sessionId: s.id, resume: true });
      setMuted(false);
    }
  };

  // A new language is a new session (each session is in one language).
  const changeLanguage = (language: LanguageId) => startNew({ ...prefs, language });

  // Organising sessions: each call returns the fresh list, applied directly.
  const sessionActions: SessionActions = {
    onRename: async (id, title) => {
      applySnapshot(await api.renameSession(id, title));
      if (id === sessionIdRef.current) setSessionTitle(title);
    },
    onMove: async (id, groupId) => applySnapshot(await api.moveSession(id, groupId)),
    onDelete: async (id) => applySnapshot(await api.deleteSession(id)),
  };
  const groupActions: GroupActions = {
    onCreateGroup: async (name) => applySnapshot(await api.createGroup(name)),
    onRenameGroup: async (id, name) => applySnapshot(await api.renameGroup(id, name)),
    onDeleteGroup: async (id) => applySnapshot(await api.deleteGroup(id)),
  };

  // A new voice continues the same session.
  const changeVoice = (voice: string) => {
    setPrefs((p) => ({ ...p, voice }));
    ws.send({ type: 'update_preferences', session_id: sessionIdRef.current, preferences: { voice } });
  };

  const level = [GRADE_OPTIONS.find((g) => g.value === prefs.grade)?.label, prefs.board === 'STATE' ? 'State board' : prefs.board]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="app">
      <header className="rail">
        <span className="rail__mark">GuruAI</span>
        <span className="rail__rule" aria-hidden="true" />
        {level && <span className="rail__meta">{level}</span>}
        {connected && (
          <label className="rail__lang">
            <span className="visually-hidden">Language</span>
            <select
              value={prefs.language}
              disabled={!canSwitch}
              title={canSwitch ? 'Switch language (starts a new session)' : 'You can change language between answers'}
              onChange={(e) => changeLanguage(e.target.value as LanguageId)}
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nativeLabel}
                </option>
              ))}
            </select>
          </label>
        )}
        {connected && voices.length > 0 && (
          <label className="rail__lang">
            <span className="visually-hidden">Voice</span>
            <select
              value={prefs.voice ?? ''}
              disabled={!canSwitch}
              title={canSwitch ? 'Change the teacher\'s voice' : 'You can change voice between answers'}
              onChange={(e) => changeVoice(e.target.value)}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} · {v.gender}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="rail__toggle" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
          Sessions
        </button>
        <button className="rail__toggle" onClick={() => setLogsOpen((o) => !o)} aria-expanded={logsOpen}>
          Log
        </button>
      </header>

      {!connected && (
        <div className="setup-layer">
          <SessionSetup
            value={prefs}
            onChange={setPrefs}
            onStart={() => startNew(prefs, setupGroupId)}
            busy={ws.connection === 'connecting'}
            voices={voices}
            sessions={sessions}
            groups={groups}
            onResume={resume}
            groupId={setupGroupId}
            onGroupChange={setSetupGroupId}
          />
        </div>
      )}

      <main className="stage" aria-hidden={!connected}>
        <TranscriptSide variant="user" label="You" history={userHistory}>
          <UserCaption text={userText} final={userFinal} placeholder={placeholder} />
        </TranscriptSide>
        <div className="stage__orb">
          <Orb readLevel={readLevel} source={source} dim={!connected} />
        </div>
        <TranscriptSide variant="assistant" label="GuruAI" history={assistantHistory}>
          <AssistantCaption key={replyId} text={assistantText} sources={sources} audioStarted={audioStarted} remainingMs={remainingMs} />
        </TranscriptSide>
      </main>

      <footer className="foot">
        <Controls
          connection={ws.connection}
          muted={muted}
          status={status}
          onToggleConnection={() => (connected || ws.connection === 'connecting' ? ws.disconnect() : startNew(prefs))}
          onToggleMute={() => setMuted((m) => !m)}
        />
      </footer>

      <HistorySidebar
        turns={history}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={sessionTitle}
        lesson={lesson}
        sessions={sessions}
        groups={groups}
        currentId={connected ? currentSessionId : ''}
        onOpenSession={resume}
        onNewSession={(groupId) => startNew(prefs, groupId)}
        sessionActions={sessionActions}
        groupActions={groupActions}
        canSwitch={canSwitch}
      />
      <LogSidebar entries={logs} open={logsOpen} onClose={() => setLogsOpen(false)} />
    </div>
  );
}
