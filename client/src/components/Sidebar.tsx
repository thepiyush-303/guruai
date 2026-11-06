// ============================================================
// Sidebar — the app's navigation: start a session, find and reopen any
// saved one, organise them into groups, reach Settings, switch theme.
//
// Every session row is a real link (/s/<id>), so it opens with one click,
// works with Back/Forward and can be opened in a new tab. Each row and group
// has a ⋯ menu for rename / move / delete. On narrow screens the sidebar is
// a drawer.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { relativeDay, useLibrary } from '../library.ts';
import { navigate, type Route } from '../router.ts';
import { languageOption, type SessionGroup, type SessionSummary } from '../protocol.ts';
import { useTheme, type ThemeChoice } from '../settings.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Link } from './Link.tsx';

interface Props {
  route: Route;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawer state. */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ route, collapsed, onToggleCollapsed, open, onClose }: Props) {
  const lib = useLibrary();
  const [query, setQuery] = useState('');
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const currentId = route.name === 'session' ? route.id : null;

  const q = query.trim().toLowerCase();
  const matches = (s: SessionSummary) =>
    !q || (s.title ?? '').toLowerCase().includes(q) || (s.last_text ?? '').toLowerCase().includes(q);
  const visible = lib.sessions.filter(matches);
  const ungrouped = visible.filter((s) => !s.group_id || !lib.groups.some((g) => g.id === s.group_id));

  const createGroup = async () => {
    const name = (newGroup ?? '').trim();
    if (!name) return;
    try {
      await lib.groupActions.create(name);
      setNewGroup(null);
    } catch {
      /* the name stays in the box; the server rejected it */
    }
  };

  return (
    <>
      <div className={open ? 'scrim is-open' : 'scrim'} onClick={onClose} aria-hidden="true" />
      <nav className={`sidebar${collapsed ? ' is-collapsed' : ''}${open ? ' is-open' : ''}`} aria-label="Sessions">
        <div className="sidebar__top">
          <Link href="/" className="brand" onNavigate={onClose} aria-label="GuruAI home">
            <span className="brand__mark" aria-hidden="true">
              G
            </span>
            <span className="brand__name">GuruAI</span>
          </Link>
          <button
            className="icon-btn sidebar__collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="sidebar" />
          </button>
          <button className="icon-btn sidebar__close" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <Link href="/new" className="btn btn--primary sidebar__new" onNavigate={onClose} title="New session">
          <Icon name="plus" />
          <span className="sidebar__label">New session</span>
        </Link>

        <div className="sidebar__body">
          {lib.sessions.length > 3 && (
            <label className="search">
              <Icon name="search" size={16} />
              <span className="visually-hidden">Search sessions</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions" />
            </label>
          )}

          <div className="sidebar__heading">
            <span>Groups</span>
            <button
              className="icon-btn icon-btn--small"
              onClick={() => setNewGroup((g) => (g === null ? '' : null))}
              aria-label="New group"
              title="New group"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          {newGroup !== null && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void createGroup();
              }}
            >
              <input
                autoFocus
                value={newGroup}
                maxLength={60}
                placeholder="e.g. Physics — Class 10"
                aria-label="Group name"
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setNewGroup(null)}
              />
              <button className="btn btn--small" type="submit" disabled={!newGroup.trim()}>
                Add
              </button>
            </form>
          )}
          {lib.groups.length === 0 && newGroup === null && (
            <p className="sidebar__hint">Make groups for subjects or exams, and keep sessions inside them.</p>
          )}
          {lib.groups.map((g) => (
            <GroupBlock
              key={g.id}
              group={g}
              sessions={visible.filter((s) => s.group_id === g.id)}
              currentId={currentId}
              onNavigate={onClose}
              forceOpen={!!q}
            />
          ))}

          <div className="sidebar__heading">
            <span>Recent</span>
          </div>
          {!lib.loaded ? (
            <p className="sidebar__hint">Loading…</p>
          ) : lib.error ? (
            <p className="sidebar__hint is-error">{lib.error}</p>
          ) : ungrouped.length === 0 ? (
            <p className="sidebar__hint">{q ? 'No sessions match.' : 'Your sessions will appear here.'}</p>
          ) : (
            <ul className="session-list">
              {ungrouped.map((s) => (
                <SessionRow key={s.id} session={s} current={s.id === currentId} onNavigate={onClose} />
              ))}
            </ul>
          )}
        </div>

        <div className="sidebar__foot">
          <Link
            href="/settings"
            className={route.name === 'settings' ? 'nav-item is-active' : 'nav-item'}
            onNavigate={onClose}
            title="Settings"
          >
            <Icon name="settings" />
            <span className="sidebar__label">Settings</span>
          </Link>
          <ThemeSwitch />
        </div>
      </nav>
    </>
  );
}

// ── Theme switch ─────────────────────────────────────────────

const THEMES: Array<{ id: ThemeChoice; icon: IconName; label: string }> = [
  { id: 'light', icon: 'sun', label: 'Light' },
  { id: 'dark', icon: 'moon', label: 'Dark' },
  { id: 'system', icon: 'monitor', label: 'System' },
];

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="segmented theme-switch" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          className={theme === t.id ? 'is-active' : ''}
          onClick={() => setTheme(t.id)}
          title={`${t.label} theme`}
        >
          <Icon name={t.icon} size={16} />
          <span className="visually-hidden">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── A group and its sessions ─────────────────────────────────

function GroupBlock({
  group,
  sessions,
  currentId,
  onNavigate,
  forceOpen,
}: {
  group: SessionGroup;
  sessions: SessionSummary[];
  currentId: string | null;
  onNavigate: () => void;
  forceOpen: boolean;
}) {
  const lib = useLibrary();
  const hasCurrent = sessions.some((s) => s.id === currentId);
  const [expanded, setExpanded] = useState(hasCurrent);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const [confirm, setConfirm] = useState(false);
  const show = expanded || forceOpen || hasCurrent;

  return (
    <div className="group">
      <div className="group__head">
        {renaming ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void lib.groupActions.rename(group.id, draft.trim()).then(() => setRenaming(false));
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={60}
              aria-label="Group name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
            />
            <button className="btn btn--small" type="submit" disabled={!draft.trim()}>
              Save
            </button>
          </form>
        ) : (
          <>
            <button className="group__toggle" aria-expanded={show} onClick={() => setExpanded((x) => !x)} title={group.name}>
              <Icon name="chevron" size={14} className={show ? 'is-rotated' : ''} />
              <Icon name="folder" size={16} />
              <span className="group__name">{group.name}</span>
              <span className="group__count">{sessions.length}</span>
            </button>
            <Menu label={`Actions for group ${group.name}`} onClose={() => setConfirm(false)}>
              {(close) => (
                <>
                  <button
                    className="menu__item"
                    onClick={() => {
                      close();
                      navigate(`/new?group=${encodeURIComponent(group.id)}`);
                      onNavigate();
                    }}
                  >
                    <Icon name="plus" size={16} /> New session here
                  </button>
                  <button
                    className="menu__item"
                    onClick={() => {
                      close();
                      setDraft(group.name);
                      setRenaming(true);
                    }}
                  >
                    <Icon name="edit" size={16} /> Rename
                  </button>
                  {confirm ? (
                    <button
                      className="menu__item is-danger"
                      onClick={() => {
                        close();
                        void lib.groupActions.remove(group.id);
                      }}
                    >
                      <Icon name="trash" size={16} /> Delete group (sessions are kept)
                    </button>
                  ) : (
                    <button className="menu__item" onClick={() => setConfirm(true)}>
                      <Icon name="trash" size={16} /> Delete group…
                    </button>
                  )}
                </>
              )}
            </Menu>
          </>
        )}
      </div>
      {show &&
        (sessions.length === 0 ? (
          <p className="sidebar__hint group__empty">No sessions yet — use ⋯ › New session here.</p>
        ) : (
          <ul className="session-list group__list">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} current={s.id === currentId} onNavigate={onNavigate} />
            ))}
          </ul>
        ))}
    </div>
  );
}

// ── One session ──────────────────────────────────────────────

function SessionRow({ session: s, current, onNavigate }: { session: SessionSummary; current: boolean; onNavigate: () => void }) {
  const lib = useLibrary();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(false);
  const title = s.title || 'New session';
  const lang = languageOption(s.language);

  if (renaming) {
    return (
      <li className="session-row">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void lib.sessionActions.rename(s.id, draft.trim()).then(() => setRenaming(false));
          }}
        >
          <input
            autoFocus
            value={draft}
            maxLength={80}
            aria-label="Session name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
          />
          <button className="btn btn--small" type="submit" disabled={!draft.trim()}>
            Save
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className={current ? 'session-row is-current' : 'session-row'}>
      <Link
        href={`/s/${s.id}`}
        className="session-link"
        aria-current={current ? 'page' : undefined}
        onNavigate={onNavigate}
        title={title}
      >
        <span className={s.title ? 'session-link__title' : 'session-link__title is-pending'}>{title}</span>
        <span className="session-link__meta">
          <span lang={s.language === 'hinglish' ? 'hi' : s.language}>{lang.nativeLabel}</span> · {relativeDay(s.updated_ts)}
        </span>
      </Link>
      <Menu label={`Actions for ${title}`} onClose={() => setConfirm(false)}>
        {(close) => (
          <>
            <button
              className="menu__item"
              onClick={() => {
                close();
                setDraft(s.title ?? '');
                setRenaming(true);
              }}
            >
              <Icon name="edit" size={16} /> Rename
            </button>
            <label className="menu__item menu__select">
              <Icon name="folder" size={16} />
              <span className="visually-hidden">Move to group</span>
              <select
                value={s.group_id ?? ''}
                onChange={(e) => {
                  close();
                  void lib.sessionActions.move(s.id, e.target.value || null);
                }}
              >
                <option value="">No group</option>
                {lib.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            {confirm ? (
              <button
                className="menu__item is-danger"
                onClick={() => {
                  close();
                  void lib.sessionActions.remove(s.id).then(() => {
                    if (current) navigate('/', null, { replace: true });
                  });
                }}
              >
                <Icon name="trash" size={16} /> Delete for good
              </button>
            ) : (
              <button className="menu__item" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={16} /> Delete…
              </button>
            )}
          </>
        )}
      </Menu>
    </li>
  );
}

// ── ⋯ menu ───────────────────────────────────────────────────

function Menu({ label, children, onClose }: { label: string; children: (close: () => void) => ReactNode; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className={open ? 'menu is-open' : 'menu'} ref={ref}>
      <button
        className="icon-btn icon-btn--small menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className="menu__pop" role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}
