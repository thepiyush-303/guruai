// ============================================================
// SessionPage — the voice teacher. The only screen with a microphone,
// a connection and the composer.
//
// Opening /s/<id> connects to that session (a fresh one started from /new,
// or a saved one to continue); leaving the page closes the connection.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import * as api from '../api.ts';
import { Composer } from '../components/Composer.tsx';
import { Icon } from '../components/Icon.tsx';
import { Link } from '../components/Link.tsx';
import { Orb } from '../components/Orb.tsx';
import { SidePanel, type PanelTab } from '../components/SidePanel.tsx';
import { Thread } from '../components/Thread.tsx';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useVoiceSession } from '../hooks/useVoiceSession.ts';
import { useLibrary } from '../library.ts';
import { historyState, type FreshSessionState } from '../router.ts';
import { GRADE_OPTIONS, languageOption, type Preferences } from '../protocol.ts';
import { loadPrefs, useDevLog, usePanelOpen, useVoiceOutput } from '../settings.ts';

interface Start {
  prefs: Preferences;
  resume: boolean;
  groupId: string | null;
}

/** Work out how to open this session, then hand over to the live view. */
export function SessionPage({ id }: { id: string }) {
  const lib = useLibrary();
  const [start] = useState<Start | null>(() => {
    const fresh = historyState<FreshSessionState>();
    return fresh?.fresh ? { prefs: fresh.prefs, resume: false, groupId: fresh.groupId } : null;
  });

  if (start) return <SessionView key={id} id={id} start={start} />;
  if (!lib.loaded) return <div className="page-loading">Loading your session…</div>;

  // A saved session: continue it in its own language and voice.
  const saved = lib.sessions.find((s) => s.id === id);
  const prefs: Preferences = saved
    ? { language: saved.language, voice: saved.voice ?? undefined, grade: saved.grade ?? undefined, board: saved.board ?? undefined }
    : loadPrefs();
  return <SessionView key={id} id={id} start={{ prefs, resume: true, groupId: null }} />;
}

function SessionView({ id, start }: { id: string; start: Start }) {
  const lib = useLibrary();
  const [voiceOutput, setVoiceOutput] = useVoiceOutput();
  const [devLog] = useDevLog();
  const s = useVoiceSession({
    sessionId: id,
    prefs: start.prefs,
    resume: start.resume,
    groupId: start.groupId,
    voiceOutput,
    onLibraryChanged: lib.refresh,
  });

  // Once the session is open, a reload must continue it, not start it again.
  useEffect(() => {
    if (s.connected && historyState<FreshSessionState>()?.fresh) window.history.replaceState(null, '');
  }, [s.connected]);

  // The side panel: remembered on wide screens, a slide-over on narrow ones.
  const wide = useMediaQuery('(min-width: 1100px)');
  const [panelPref, setPanelPref] = usePanelOpen();
  const [narrowPanel, setNarrowPanel] = useState(false);
  const panelOpen = wide ? panelPref : narrowPanel;
  const setPanelOpen = (open: boolean) => (wide ? setPanelPref(open) : setNarrowPanel(open));
  const [tab, setTab] = useState<PanelTab>('notes');

  const lang = languageOption(s.prefs.language);
  const grade = GRADE_OPTIONS.find((g) => g.value === s.prefs.grade)?.label;
  const title = s.title || (s.turns.length ? 'Untitled session' : 'New session');
  const started = s.turns.length > 0 || s.reply.text.length > 0 || !!s.userDraft;
  const thinking = s.turn === 'thinking' && !s.reply.text;

  const hero = (
    <div className="hero-orb">
      <div className="hero-orb__canvas">
        <Orb readLevel={s.readLevel} source={s.source} dim={!s.connected} />
      </div>
      <p className="hero-orb__title">{s.connected ? 'Say hello, or type a question' : 'Connecting…'}</p>
      <p className="hero-orb__hint">
        Ask about any topic — “What is photosynthesis?”, “Explain Newton’s third law”, “Help me with fractions”.
      </p>
    </div>
  );

  return (
    <div className={panelOpen ? 'session has-panel' : 'session'}>
      <section className="session__main">
        <header className="session__head">
          <div className="session__title">
            <h1 title={title}>{title}</h1>
            <p className="session__meta">
              <span className="badge" lang={s.prefs.language === 'hinglish' ? 'hi' : s.prefs.language}>
                {lang.nativeLabel}
              </span>
              {grade && <span>{grade}</span>}
              {s.prefs.board && <span>{s.prefs.board === 'STATE' ? 'State board' : s.prefs.board}</span>}
            </p>
          </div>
          <div className="session__tools">
            <VoiceSelect
              voices={lib.voices.map((v) => ({ id: v.id, label: `${v.id} · ${v.gender}` }))}
              value={s.prefs.voice}
              language={s.prefs.language}
              disabled={!s.canChangeVoice}
              onChange={s.changeVoice}
            />
            <button
              className={panelOpen ? 'btn btn--quiet is-active' : 'btn btn--quiet'}
              onClick={() => setPanelOpen(!panelOpen)}
              aria-expanded={panelOpen}
              title="Notes and lesson plan"
            >
              <Icon name="notes" size={16} />
              <span className="hide-sm">Notes</span>
              {s.freshNotes.size > 0 && !panelOpen && <span className="dot" aria-label="new notes" />}
            </button>
            <Link href="/" className="btn btn--quiet" title="Leave this session (it is saved)">
              <span>End</span>
            </Link>
          </div>
        </header>

        {s.connection === 'disconnected' && s.loaded && (
          <div className="banner" role="alert">
            <span>Disconnected from GuruAI.</span>
            <button className="btn btn--small" onClick={s.reconnect}>
              Reconnect
            </button>
          </div>
        )}

        <Thread
          turns={s.turns}
          reply={s.reply}
          userDraft={s.userDraft}
          thinking={thinking}
          paced={voiceOutput}
          remainingMs={s.remainingMs}
          empty={hero}
          footer={
            s.notice ? (
              <div className="notice" role="status">
                <span>{s.notice}</span>
                <button className="icon-btn icon-btn--small" onClick={s.dismissNotice} aria-label="Dismiss">
                  <Icon name="close" size={14} />
                </button>
              </div>
            ) : null
          }
        />

        <Composer
          connected={s.connected}
          muted={s.muted}
          onToggleMute={() => s.setMuted(!s.muted)}
          turn={s.turn}
          status={s.status}
          canSend={s.canSend}
          onSend={s.sendText}
          speaking={s.speaking && voiceOutput}
          onStop={s.stopSpeaking}
          voiceOutput={voiceOutput}
          onToggleVoiceOutput={() => setVoiceOutput(!voiceOutput)}
          orb={started ? <Orb readLevel={s.readLevel} source={s.source} dim={!s.connected} compact /> : undefined}
        />
      </section>

      {panelOpen && (
        <>
          {!wide && <div className="scrim is-open panel-scrim" onClick={() => setPanelOpen(false)} aria-hidden="true" />}
          <SidePanel
            tab={tab}
            onTab={setTab}
            onClose={() => setPanelOpen(false)}
            showLog={devLog}
            notes={s.notes}
            freshNotes={s.freshNotes}
            onToggleNotes={s.setNotesEnabled}
            onNotesDefault={s.changeNotesDefault}
            lesson={s.lesson}
            logs={s.logs}
          />
        </>
      )}
    </div>
  );
}

/** The teacher's voice, changeable between answers, with a sample to hear. */
function VoiceSelect({
  voices,
  value,
  language,
  disabled,
  onChange,
}: {
  voices: Array<{ id: string; label: string }>;
  value: string | undefined;
  language: Preferences['language'];
  disabled: boolean;
  onChange: (voice: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audioRef.current?.pause(), []);
  if (voices.length === 0) return null;

  const preview = async () => {
    if (!value) return;
    if (playing) {
      audioRef.current?.pause();
      return;
    }
    try {
      const url = await api.fetchVoicePreview(value, language);
      audioRef.current?.pause();
      const el = new Audio(url);
      el.addEventListener('ended', () => setPlaying(false));
      el.addEventListener('pause', () => setPlaying(false));
      audioRef.current = el;
      await el.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className="voice-select" title={disabled ? 'You can change the voice between answers' : 'Teacher’s voice'}>
      <label>
        <span className="visually-hidden">Teacher’s voice</span>
        <select className="select select--small" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="icon-btn icon-btn--small"
        onClick={() => void preview()}
        disabled={!value}
        aria-label={playing ? 'Stop the voice sample' : 'Hear this voice'}
        title={playing ? 'Stop' : 'Hear this voice'}
      >
        <Icon name={playing ? 'stop' : 'play'} size={14} />
      </button>
    </div>
  );
}
