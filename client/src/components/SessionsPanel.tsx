// ============================================================
// SessionsPanel — every saved session, organised by the student.
//
// Sessions are individual; the student can make groups (e.g. "Physics",
// "Board exam revision"), start a new session inside a group, move sessions
// between groups, and rename or delete groups (deleting a group keeps its
// sessions). Sessions not in any group are listed last.
// ============================================================

import { useState } from 'react';
import type { SessionGroup, SessionSummary } from '../protocol.ts';
import { SessionList, type SessionActions } from './SessionList.tsx';

export interface GroupActions {
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}

interface Props {
  groups: SessionGroup[];
  sessions: SessionSummary[];
  currentId: string;
  onOpen: (session: SessionSummary) => void;
  /** Start a new session, optionally inside a group. */
  onNew: (groupId: string | null) => void;
  sessionActions: SessionActions;
  groupActions: GroupActions;
  canSwitch: boolean;
}

export function SessionsPanel({
  groups,
  sessions,
  currentId,
  onOpen,
  onNew,
  sessionActions,
  groupActions,
  canSwitch,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const byRecent = [...sessions].sort((a, b) => b.updated_ts - a.updated_ts);
  const ungrouped = byRecent.filter((s) => !s.group_id || !groups.some((g) => g.id === s.group_id));

  const create = async () => {
    if (!name.trim()) return;
    try {
      await groupActions.onCreateGroup(name.trim());
      setName('');
      setCreating(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="sessions">
      <div className="sessions__toolbar">
        <button className="btn btn--small" onClick={() => onNew(null)} disabled={!canSwitch}>
          New session
        </button>
        <button className="btn btn--small btn--quiet" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
          New group
        </button>
      </div>
      {!canSwitch && <p className="history__hint">You can switch sessions between answers.</p>}

      {creating && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            autoFocus
            placeholder="Group name, e.g. Physics"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            aria-label="New group name"
          />
          <button className="btn btn--small" type="submit" disabled={!name.trim()}>
            Create
          </button>
        </form>
      )}
      {error && (
        <p className="setup__error" role="alert">
          {error}
        </p>
      )}

      {groups.map((g) => {
        const list = byRecent.filter((s) => s.group_id === g.id);
        return (
          <GroupSection
            key={g.id}
            group={g}
            sessions={list}
            groups={groups}
            collapsed={collapsed.has(g.id)}
            onToggle={() => toggle(g.id)}
            currentId={currentId}
            onOpen={onOpen}
            onNew={() => onNew(g.id)}
            sessionActions={sessionActions}
            groupActions={groupActions}
            canSwitch={canSwitch}
          />
        );
      })}

      <section className="sessions__group">
        {groups.length > 0 && <h3 className="sessions__heading">Not in a group</h3>}
        <SessionList
          sessions={ungrouped}
          groups={groups}
          currentId={currentId}
          onOpen={onOpen}
          actions={sessionActions}
          disabled={!canSwitch}
          emptyText={
            sessions.length === 0
              ? 'No saved sessions yet. Every conversation is saved here so you can continue it later.'
              : 'Every session is in a group.'
          }
        />
      </section>
    </div>
  );
}

interface GroupProps {
  group: SessionGroup;
  sessions: SessionSummary[];
  groups: SessionGroup[];
  collapsed: boolean;
  onToggle: () => void;
  currentId: string;
  onOpen: (session: SessionSummary) => void;
  onNew: () => void;
  sessionActions: SessionActions;
  groupActions: GroupActions;
  canSwitch: boolean;
}

function GroupSection({
  group,
  sessions,
  groups,
  collapsed,
  onToggle,
  currentId,
  onOpen,
  onNew,
  sessionActions,
  groupActions,
  canSwitch,
}: GroupProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setEditing(false);
      setConfirmDelete(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="sessions__group sessions__group--folder">
      <div className="group-head">
        {editing ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void run(() => groupActions.onRenameGroup(group.id, draft.trim()));
            }}
          >
            <input autoFocus value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} aria-label="Group name" />
            <button className="btn btn--small" type="submit" disabled={!draft.trim()}>
              Save
            </button>
            <button className="btn btn--small btn--quiet" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button className="group-head__toggle" onClick={onToggle} aria-expanded={!collapsed}>
              <span className="group-head__caret" aria-hidden="true">
                {collapsed ? '▸' : '▾'}
              </span>
              <span className="group-head__name">{group.name}</span>
              <span className="sessions__count">{sessions.length}</span>
            </button>
            <div className="group-head__actions">
              <button className="btn btn--small" onClick={onNew} disabled={!canSwitch} title="Start a new session in this group">
                + Session
              </button>
              <button
                className="btn btn--small btn--quiet"
                onClick={() => {
                  setDraft(group.name);
                  setEditing(true);
                }}
              >
                Rename
              </button>
              {confirmDelete ? (
                <button className="btn btn--small btn--danger" onClick={() => void run(() => groupActions.onDeleteGroup(group.id))}>
                  Delete group?
                </button>
              ) : (
                <button
                  className="btn btn--small btn--quiet"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete the group. Its sessions are kept."
                >
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="setup__error" role="alert">
          {error}
        </p>
      )}
      {!collapsed && (
        <SessionList
          sessions={sessions}
          groups={groups}
          currentId={currentId}
          onOpen={onOpen}
          actions={sessionActions}
          disabled={!canSwitch}
          emptyText="No sessions in this group yet. Use “+ Session” to start one here."
        />
      )}
    </section>
  );
}
