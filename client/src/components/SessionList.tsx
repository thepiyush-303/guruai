// ============================================================
// SessionList — saved study sessions, one row each.
//
// Each row shows the session's title (generated from what was studied, or
// the student's own name for it), its language and when it was last used.
// Clicking a row continues that session. The ⋯ button opens the row's
// actions: rename, move to a group, delete.
// ============================================================

import { useState } from 'react';
import { GRADE_OPTIONS, languageOption, type SessionGroup, type SessionSummary } from '../protocol.ts';

export interface SessionActions {
  onRename: (id: string, title: string) => Promise<void>;
  onMove: (id: string, groupId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface Props {
  sessions: SessionSummary[];
  groups: SessionGroup[];
  currentId?: string;
  onOpen: (session: SessionSummary) => void;
  /** Without actions the list is read-only (e.g. on the start screen). */
  actions?: SessionActions;
  /** Resuming is only possible between answers. */
  disabled?: boolean;
  emptyText?: string;
}

function relativeDay(ts: number): string {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (ts >= startOfToday - day) return 'Yesterday';
  if (ts >= startOfToday - 6 * day) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function SessionList({ sessions, groups, currentId, onOpen, actions, disabled = false, emptyText }: Props) {
  if (sessions.length === 0) {
    return <p className="sessions__empty">{emptyText ?? 'No sessions here yet.'}</p>;
  }
  return (
    <ul className="sessions__items">
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          groups={groups}
          current={s.id === currentId}
          onOpen={onOpen}
          actions={actions}
          disabled={disabled}
        />
      ))}
    </ul>
  );
}

interface RowProps {
  session: SessionSummary;
  groups: SessionGroup[];
  current: boolean;
  onOpen: (session: SessionSummary) => void;
  actions?: SessionActions;
  disabled: boolean;
}

function SessionRow({ session: s, groups, current, onOpen, actions, disabled }: RowProps) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lang = languageOption(s.language);
  const exchanges = Math.ceil(s.turn_count / 2);
  const grade = GRADE_OPTIONS.find((g) => g.value === s.grade)?.label;
  const title = s.title || 'New session';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMenu(false);
      setRenaming(false);
      setConfirmDelete(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={menu ? 'session-row is-open' : 'session-row'}>
      <div className="session-row__main">
        <button
          type="button"
          className={current ? 'session is-current' : 'session'}
          onClick={() => onOpen(s)}
          disabled={disabled || current}
          title={current ? 'This is the session you are in' : 'Continue this session'}
        >
          <span className={s.title ? 'session__title' : 'session__title is-pending'}>{title}</span>
          <span className="session__meta">
            {current ? 'Current · ' : ''}
            <span lang={s.language === 'hinglish' ? 'hi' : s.language}>{lang.nativeLabel}</span>
            {' · '}
            {relativeDay(s.updated_ts)} · {exchanges} {exchanges === 1 ? 'exchange' : 'exchanges'}
            {grade ? ` · ${grade}` : ''}
          </span>
        </button>
        {actions && (
          <button
            type="button"
            className="session-row__more"
            aria-expanded={menu}
            aria-label={`Actions for ${title}`}
            onClick={() => {
              setMenu((m) => !m);
              setRenaming(false);
              setConfirmDelete(false);
              setError(null);
            }}
          >
            ⋯
          </button>
        )}
      </div>

      {actions && menu && (
        <div className="session-row__menu">
          {renaming ? (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) void run(() => actions.onRename(s.id, draft.trim()));
              }}
            >
              <input
                autoFocus
                value={draft}
                maxLength={80}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Session name"
              />
              <button className="btn btn--small" type="submit" disabled={busy || !draft.trim()}>
                Save
              </button>
              <button className="btn btn--small btn--quiet" type="button" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="session-row__actions">
              <button
                className="btn btn--small"
                type="button"
                onClick={() => {
                  setDraft(s.title ?? '');
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <label className="session-row__move">
                <span className="visually-hidden">Move to group</span>
                <select
                  value={s.group_id ?? ''}
                  disabled={busy}
                  onChange={(e) => void run(() => actions.onMove(s.id, e.target.value || null))}
                >
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              {confirmDelete ? (
                <button
                  className="btn btn--small btn--danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => actions.onDelete(s.id))}
                >
                  Delete for good?
                </button>
              ) : (
                <button
                  className="btn btn--small btn--quiet"
                  type="button"
                  disabled={current}
                  title={current ? 'Switch to another session first' : 'Delete this session'}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              )}
            </div>
          )}
          {error && (
            <p className="setup__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
