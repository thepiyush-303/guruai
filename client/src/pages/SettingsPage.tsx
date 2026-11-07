// ============================================================
// SettingsPage — appearance, spoken replies, notes, what GuruAI remembers
// about the student, and the developer log.
// ============================================================

import { useEffect, useState, type ReactNode } from 'react';
import * as api from '../api.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { ProfilePanel } from '../components/ProfilePanel.tsx';
import { useDevLog, useTheme, useVoiceOutput, type ThemeChoice } from '../settings.ts';

const THEMES: Array<{ id: ThemeChoice; label: string; icon: IconName }> = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'monitor' },
];

export function SettingsPage() {
  const [theme, setTheme] = useTheme();
  const [voiceOutput, setVoiceOutput] = useVoiceOutput();
  const [devLog, setDevLog] = useDevLog();
  const [notesDefault, setNotesDefault] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .fetchProfile()
      .then((p) => live && setNotesDefault(p.notes_default))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const changeNotesDefault = (on: boolean) => {
    setNotesDefault(on);
    api.setNotesDefault(on).catch((err: Error) => {
      setNotesDefault(!on);
      setError(err.message);
    });
  };

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <h1>Settings</h1>
        <p className="page__lede">These apply to every session. Theme and spoken replies are remembered on this device.</p>
      </header>

      <Section title="Appearance">
        <div className="segmented segmented--labels" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'is-active' : ''} onClick={() => setTheme(t.id)}>
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Replies">
        <Toggle
          checked={voiceOutput}
          onChange={setVoiceOutput}
          label="Speak GuruAI’s replies aloud"
          hint="Off: replies come as text only, and nothing is sent to the speech service. You can also switch this in a session."
        />
      </Section>

      <Section title="Notes">
        <Toggle
          checked={notesDefault ?? true}
          disabled={notesDefault === null}
          onChange={changeNotesDefault}
          label="Make study notes in new sessions"
          hint="Notes are written beside the lesson and can be downloaded as a PDF. Each session can switch them on or off."
        />
      </Section>

      <Section title="About you">
        <ProfilePanel open />
      </Section>

      <Section title="Developer">
        <Toggle
          checked={devLog}
          onChange={setDevLog}
          label="Show the event log in sessions"
          hint="Adds a Log tab to the session panel: connection, speech and timing events."
        />
      </Section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="card settings-card">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-row__text">
        <span className="toggle-row__label">{label}</span>
        {hint && <span className="toggle-row__hint">{hint}</span>}
      </span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch__track" aria-hidden="true" />
      </span>
    </label>
  );
}
