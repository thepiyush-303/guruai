// ============================================================
// NewSessionPage — one compact form: language, the teacher's voice (hear
// it first), class and board, and optionally a group. Start opens the
// session. The last choices are remembered on this device.
// ============================================================

import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon.tsx';
import { VoicePicker } from '../components/VoicePicker.tsx';
import { useLibrary } from '../library.ts';
import { navigate, type FreshSessionState } from '../router.ts';
import { BOARD_OPTIONS, GRADE_OPTIONS, LANGUAGE_OPTIONS, type Board, type LanguageId, type Preferences } from '../protocol.ts';
import { loadPrefs, savePrefs } from '../settings.ts';

export function NewSessionPage({ groupId: initialGroup }: { groupId: string | null }) {
  const lib = useLibrary();
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [groupId, setGroupId] = useState<string | null>(initialGroup);

  // A remembered voice only counts if the server still offers it.
  const voice = prefs.voice && lib.voices.some((v) => v.id === prefs.voice) ? prefs.voice : lib.defaultVoice ?? undefined;
  const group = groupId && lib.groups.some((g) => g.id === groupId) ? groupId : null;

  const start = (e: FormEvent) => {
    e.preventDefault();
    const chosen: Preferences = { ...prefs, voice };
    savePrefs(chosen);
    const state: FreshSessionState = { fresh: true, prefs: chosen, groupId: group };
    navigate(`/s/${crypto.randomUUID()}`, state);
  };

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <h1>New session</h1>
        <p className="page__lede">Choose how GuruAI should talk to you. You can change the voice later; the language stays with the session.</p>
      </header>

      <form className="form" onSubmit={start}>
        <div className="field">
          <label className="field__label" htmlFor="language">
            Language
          </label>
          <select
            id="language"
            className="select"
            value={prefs.language}
            onChange={(e) => setPrefs((p) => ({ ...p, language: e.target.value as LanguageId }))}
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nativeLabel === l.label ? l.label : `${l.nativeLabel} — ${l.label}`}
              </option>
            ))}
          </select>
          <p className="field__hint">GuruAI listens and explains in this language. Hinglish mixes Hindi and English freely.</p>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="grade">
              Class <span className="field__optional">optional</span>
            </label>
            <select
              id="grade"
              className="select"
              value={prefs.grade ?? ''}
              onChange={(e) => setPrefs((p) => ({ ...p, grade: e.target.value || undefined }))}
            >
              <option value="">Not set</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="board">
              Board <span className="field__optional">optional</span>
            </label>
            <select
              id="board"
              className="select"
              value={prefs.board ?? ''}
              onChange={(e) => setPrefs((p) => ({ ...p, board: (e.target.value || undefined) as Board | undefined }))}
            >
              <option value="">Not set</option>
              {BOARD_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <span className="field__label" id="voice-label">
            Teacher&rsquo;s voice
          </span>
          <p className="field__hint">Click a voice to hear it speak in the language you chose.</p>
          <VoicePicker
            voices={lib.voices}
            value={voice}
            language={prefs.language}
            onChange={(v) => setPrefs((p) => ({ ...p, voice: v }))}
          />
        </div>

        {lib.groups.length > 0 && (
          <div className="field">
            <label className="field__label" htmlFor="group">
              Save in group <span className="field__optional">optional</span>
            </label>
            <select id="group" className="select" value={group ?? ''} onChange={(e) => setGroupId(e.target.value || null)}>
              <option value="">No group</option>
              {lib.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form__actions">
          <button className="btn btn--primary btn--large" type="submit">
            Start session
            <Icon name="arrowRight" />
          </button>
          <p className="field__hint">Your browser will ask to use the microphone. You can also just type.</p>
        </div>
      </form>
    </div>
  );
}
