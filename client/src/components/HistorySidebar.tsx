// ============================================================
// HistorySidebar — sessions, in two views:
//   · This session — the transcript of the session you are in (saved, so a
//     resumed session shows everything said before).
//   · All sessions — every saved session, in the student's own groups; click
//     one to continue it, start new ones, organise them.
//   · About you — what GuruAI remembers about the student, and controls.
// Slides in from the left — the log lives on the right — and closes on Escape.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import type { LessonView, PersistedTurn, SessionGroup, SessionSummary } from '../protocol.ts';
import { LessonProgress } from './LessonProgress.tsx';
import { ProfilePanel } from './ProfilePanel.tsx';
import type { SessionActions } from './SessionList.tsx';
import { SessionsPanel, type GroupActions } from './SessionsPanel.tsx';

type Tab = 'transcript' | 'sessions' | 'profile';

interface Props {
  turns: PersistedTurn[];
  open: boolean;
  onClose: () => void;
  title: string | null;
  lesson: LessonView | null;
  sessions: SessionSummary[];
  groups: SessionGroup[];
  currentId: string;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession: (groupId: string | null) => void;
  sessionActions: SessionActions;
  groupActions: GroupActions;
  /** Switching sessions is only possible between answers. */
  canSwitch: boolean;
}

export function HistorySidebar({
  turns,
  open,
  onClose,
  title,
  lesson,
  sessions,
  groups,
  currentId,
  onOpenSession,
  onNewSession,
  sessionActions,
  groupActions,
  canSwitch,
}: Props) {
  const [tab, setTab] = useState<Tab>('transcript');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the tail while open — the newest turn is what you came back for.
  useEffect(() => {
    if (!open || tab !== 'transcript') return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, turns, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const focusable = open ? 0 : -1;

  return (
    <aside className={open ? 'history is-open' : 'history'} role="complementary" aria-label="Sessions" aria-hidden={!open}>
      <header className="history__head">
        <div className="history__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'transcript'}
            className={tab === 'transcript' ? 'history__tab is-active' : 'history__tab'}
            onClick={() => setTab('transcript')}
            tabIndex={focusable}
          >
            This session
          </button>
          <button
            role="tab"
            aria-selected={tab === 'sessions'}
            className={tab === 'sessions' ? 'history__tab is-active' : 'history__tab'}
            onClick={() => setTab('sessions')}
            tabIndex={focusable}
          >
            All sessions
          </button>
          <button
            role="tab"
            aria-selected={tab === 'profile'}
            className={tab === 'profile' ? 'history__tab is-active' : 'history__tab'}
            onClick={() => setTab('profile')}
            tabIndex={focusable}
          >
            About you
          </button>
        </div>
        <button className="history__close" onClick={onClose} aria-label="Close sessions" tabIndex={focusable}>
          ×
        </button>
      </header>

      {tab === 'transcript' ? (
        <div className="history__scroll" ref={scrollRef}>
          {title && <p className="history__session-title">{title}</p>}
          <LessonProgress view={lesson} />
          {turns.length === 0 ? (
            <p className="history__empty">Nothing said yet in this session. Ask your first question.</p>
          ) : (
            turns.map((turn, i) => (
              <div className={`turn turn--${turn.role}`} key={i}>
                <span className="turn__who">{turn.role === 'user' ? 'You' : 'GuruAI'}</span>
                <p className="turn__text">{turn.content}</p>
              </div>
            ))
          )}
        </div>
      ) : tab === 'profile' ? (
        <div className="history__scroll">
          <ProfilePanel open={open && tab === 'profile'} />
        </div>
      ) : (
        <div className="history__scroll">
          <SessionsPanel
            groups={groups}
            sessions={sessions}
            currentId={currentId}
            onOpen={onOpenSession}
            onNew={onNewSession}
            sessionActions={sessionActions}
            groupActions={groupActions}
            canSwitch={canSwitch}
          />
        </div>
      )}
    </aside>
  );
}
