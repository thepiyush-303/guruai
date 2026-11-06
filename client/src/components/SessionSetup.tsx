// ============================================================
// SessionSetup — what the student sees before a session starts:
// the language to learn in (labelled in its own script), and their
// class and board so the teacher can pitch explanations right.
//
// Everything here travels to the server in session_init. Starting always
// begins a NEW session; saved ones are listed at the top to continue instead.
// ============================================================

import {
  BOARD_OPTIONS,
  GRADE_OPTIONS,
  LANGUAGE_OPTIONS,
  type Board,
  type Preferences,
  type SessionGroup,
  type SessionSummary,
  type VoiceOption,
} from '../protocol.ts';
import { SessionList } from './SessionList.tsx';
import { VoicePicker } from './VoicePicker.tsx';

interface Props {
  value: Preferences;
  onChange: (next: Preferences) => void;
  onStart: () => void;
  busy: boolean;
  voices: VoiceOption[];
  sessions: SessionSummary[];
  groups: SessionGroup[];
  onResume: (session: SessionSummary) => void;
  /** The group a new session will be saved in (null = none). */
  groupId: string | null;
  onGroupChange: (groupId: string | null) => void;
}

/** Recent sessions shown on the start screen; the rest are in the Sessions panel. */
const RECENT = 5;

export function SessionSetup({
  value,
  onChange,
  onStart,
  busy,
  voices,
  sessions,
  groups,
  onResume,
  groupId,
  onGroupChange,
}: Props) {
  const recent = [...sessions].sort((a, b) => b.updated_ts - a.updated_ts).slice(0, RECENT);
  return (
    <section className="setup" aria-labelledby="setup-title">
      {recent.length > 0 && (
        <div className="setup__group">
          <h2 className="setup__legend">Continue where you left off</h2>
          <SessionList sessions={recent} groups={groups} onOpen={onResume} disabled={busy} />
          {sessions.length > RECENT && (
            <p className="setup__hint">All {sessions.length} sessions and your groups are in the Sessions panel.</p>
          )}
        </div>
      )}

      <h1 className="setup__title" id="setup-title">
        {sessions.length > 0 ? 'Or start a new session' : 'What would you like to learn today?'}
      </h1>
      <p className="setup__lede">Pick the language you want to talk in. GuruAI will listen and explain in it.</p>

      <fieldset className="setup__group">
        <legend className="setup__legend">Language</legend>
        <div className="setup__langs" role="radiogroup">
          {LANGUAGE_OPTIONS.map((lang) => {
            const selected = value.language === lang.id;
            return (
              <button
                key={lang.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? 'lang is-selected' : 'lang'}
                onClick={() => onChange({ ...value, language: lang.id })}
              >
                <span className="lang__native" lang={lang.id === 'hinglish' ? 'hi' : lang.id}>
                  {lang.nativeLabel}
                </span>
                {lang.nativeLabel !== lang.label && <span className="lang__label">{lang.label}</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="setup__group">
        <span className="setup__legend">Teacher's voice — click to hear it</span>
        <VoicePicker
          voices={voices}
          value={value.voice}
          language={value.language}
          onChange={(voice) => onChange({ ...value, voice })}
        />
      </div>

      <div className="setup__row">
        <label className="setup__field">
          <span className="setup__legend">Class</span>
          <select
            value={value.grade ?? ''}
            onChange={(e) => onChange({ ...value, grade: e.target.value || undefined })}
          >
            <option value="">Not set</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="setup__field">
          <span className="setup__legend">Board</span>
          <select
            value={value.board ?? ''}
            onChange={(e) => onChange({ ...value, board: (e.target.value || undefined) as Board | undefined })}
          >
            <option value="">Not set</option>
            {BOARD_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {groups.length > 0 && (
        <label className="setup__field">
          <span className="setup__legend">Save in group</span>
          <select value={groupId ?? ''} onChange={(e) => onGroupChange(e.target.value || null)}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <button className="btn btn--primary setup__start" onClick={onStart} disabled={busy}>
        {busy ? 'Connecting…' : 'Start learning'}
      </button>
    </section>
  );
}
