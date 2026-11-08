// ============================================================
// StartSheet — the last step before a session: what the topic covers (or
// what to ask in an open-chat area), how GuruAI should speak, and Start.
// A drawer on wide screens, a bottom sheet on phones.
// ============================================================

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { TopicPlace } from '../../catalog.ts';
import { useLibrary } from '../../library.ts';
import { GRADE_OPTIONS, LANGUAGE_OPTIONS, type LanguageId, type OpenCategory, type Preferences } from '../../protocol.ts';
import { Icon } from '../Icon.tsx';
import { VoicePicker } from '../VoicePicker.tsx';
import { iconOf } from './shared.ts';

export interface StartChoice {
  prefs: Preferences;
  groupId: string | null;
}

interface SettingsProps {
  prefs: Preferences;
  onPrefs: (update: (p: Preferences) => Preferences) => void;
  voice: string | undefined;
  groupId: string | null;
  onGroup: (id: string | null) => void;
  /** Open chat has no syllabus to set the level, so ask for it (optional). */
  askLevel?: boolean;
}

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, without re-running the focus effect on every render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <button className="icon-btn sheet__close" onClick={onClose} aria-label="Close" type="button">
          <Icon name="close" />
        </button>
        {children}
      </div>
    </>
  );
}

/** Language, voice (collapsed until asked for), group and optional level. */
function SessionSettings({ prefs, onPrefs, voice, groupId, onGroup, askLevel }: SettingsProps) {
  const lib = useLibrary();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const ids = useId();
  const current = lib.voices.find((v) => v.id === voice);

  return (
    <fieldset className="sheet-settings">
      <legend className="sheet-settings__legend">How GuruAI talks to you</legend>
      <div className="sheet-settings__row">
        <label className="field" htmlFor={`${ids}-lang`}>
          <span className="field__label">Language</span>
          <select
            id={`${ids}-lang`}
            className="select"
            value={prefs.language}
            onChange={(e) => onPrefs((p) => ({ ...p, language: e.target.value as LanguageId }))}
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nativeLabel === l.label ? l.label : `${l.nativeLabel} — ${l.label}`}
              </option>
            ))}
          </select>
        </label>
        {askLevel && (
          <label className="field" htmlFor={`${ids}-level`}>
            <span className="field__label">
              You are in <span className="field__optional">optional</span>
            </span>
            <select
              id={`${ids}-level`}
              className="select"
              value={prefs.grade ?? ''}
              onChange={(e) => onPrefs((p) => ({ ...p, grade: e.target.value || undefined, board: undefined }))}
            >
              <option value="">Not set</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {lib.voices.length > 0 && (
        <div className="voice-summary">
          <span className="voice-summary__label">Voice</span>
          <span className="voice-summary__value">{current ? `${current.id} · ${current.gender}` : 'Default'}</span>
          <button type="button" className="btn btn--small btn--quiet" onClick={() => setVoiceOpen((o) => !o)} aria-expanded={voiceOpen}>
            {voiceOpen ? 'Done' : 'Change'}
          </button>
        </div>
      )}
      {voiceOpen && (
        <VoicePicker voices={lib.voices} value={voice} language={prefs.language} onChange={(v) => onPrefs((p) => ({ ...p, voice: v }))} />
      )}

      {lib.groups.length > 0 && (
        <label className="field" htmlFor={`${ids}-group`}>
          <span className="field__label">
            Save in group <span className="field__optional">optional</span>
          </span>
          <select id={`${ids}-group`} className="select" value={groupId ?? ''} onChange={(e) => onGroup(e.target.value || null)}>
            <option value="">No group</option>
            {lib.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}

type CommonProps = Omit<SettingsProps, 'askLevel'> & { onClose: () => void; onStart: (choice: StartChoice) => void };

export function TopicSheet({ place, prefs, voice, groupId, onClose, onStart, ...rest }: CommonProps & { place: TopicPlace }) {
  const { topic, unit, subject, program } = place;
  const start = (e: FormEvent) => {
    e.preventDefault();
    onStart({ prefs: { ...prefs, voice, study: { kind: 'topic', topicId: topic.id } }, groupId });
  };

  return (
    <Sheet label={topic.title} onClose={onClose}>
      <form className="sheet__body" onSubmit={start}>
        <p className="sheet__crumbs">
          <Icon name={iconOf(subject.icon)} size={14} />
          {program.title} · {subject.title} · {unit.title}
        </p>
        <h2 className="sheet__title">{topic.title}</h2>
        <p className="sheet__summary">{topic.summary}</p>

        <h3 className="sheet__label">What you’ll learn</h3>
        <ol className="lesson-steps">
          {topic.chunks.map((c, i) => (
            <li key={c}>
              <span className="lesson-steps__num">{i + 1}</span>
              <span>{c}</span>
            </li>
          ))}
        </ol>

        {topic.keyTerms.length > 0 && (
          <>
            <h3 className="sheet__label">Key terms</h3>
            <ul className="term-chips">
              {topic.keyTerms.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}

        <SessionSettings prefs={prefs} voice={voice} groupId={groupId} {...rest} />

        <div className="sheet__actions">
          <button className="btn btn--primary btn--large sheet__start" type="submit">
            Start lesson
            <Icon name="arrowRight" />
          </button>
          <p className="field__hint">GuruAI begins with part 1 straight away. Speak or type to ask anything along the way.</p>
        </div>
      </form>
    </Sheet>
  );
}

export function AreaSheet({ category, prefs, voice, groupId, onClose, onStart, ...rest }: CommonProps & { category: OpenCategory }) {
  const [ask, setAsk] = useState('');
  const go = (question: string) =>
    onStart({ prefs: { ...prefs, voice, study: { kind: 'open', categoryId: category.id, ...(question.trim() ? { ask: question.trim() } : {}) } }, groupId });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(ask);
  };

  return (
    <Sheet label={category.title} onClose={onClose}>
      <form className="sheet__body" onSubmit={submit}>
        <p className="sheet__crumbs">
          <Icon name={iconOf(category.icon)} size={14} />
          Open chat
        </p>
        <h2 className="sheet__title">{category.title}</h2>
        <p className="sheet__summary">{category.blurb}</p>

        <h3 className="sheet__label">Try asking</h3>
        <ul className="starter-list">
          {category.starters.map((s) => (
            <li key={s}>
              <button type="button" className="starter" onClick={() => go(s)}>
                <span>{s}</span>
                <Icon name="arrowRight" size={16} />
              </button>
            </li>
          ))}
        </ul>

        <label className="field ask-field">
          <span className="field__label">
            Or ask your own <span className="field__optional">optional</span>
          </span>
          <textarea
            className="textarea"
            rows={3}
            maxLength={500}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="What's on your mind?"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                go(ask);
              }
            }}
          />
        </label>

        <SessionSettings prefs={prefs} voice={voice} groupId={groupId} askLevel {...rest} />

        <div className="sheet__actions">
          <button className="btn btn--primary btn--large sheet__start" type="submit">
            {ask.trim() ? 'Ask GuruAI' : 'Start chatting'}
            <Icon name="arrowRight" />
          </button>
        </div>
      </form>
    </Sheet>
  );
}
