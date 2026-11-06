// ============================================================
// SidePanel — the one panel beside a session: Notes, the Lesson plan, and
// (for developers) the event Log, as tabs. Docked on wide screens, a
// slide-over on narrow ones. Only one panel ever, so nothing overlaps.
// ============================================================

import { useEffect, useRef } from 'react';
import type { LessonView, LogEntry, NotesState } from '../protocol.ts';
import { Icon, type IconName } from './Icon.tsx';
import { LessonProgress } from './LessonProgress.tsx';
import { NotesPanel } from './NotesPanel.tsx';

export type PanelTab = 'notes' | 'lesson' | 'log';

interface Props {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  showLog: boolean;
  notes: NotesState | null;
  freshNotes: ReadonlySet<string>;
  onToggleNotes: (enabled: boolean) => void;
  onNotesDefault: (enabled: boolean) => void;
  lesson: LessonView | null;
  logs: LogEntry[];
}

export function SidePanel(p: Props) {
  const tabs: Array<{ id: PanelTab; label: string; icon: IconName; badge?: boolean }> = [
    { id: 'notes', label: 'Notes', icon: 'notes', badge: p.freshNotes.size > 0 && p.tab !== 'notes' },
    { id: 'lesson', label: 'Lesson', icon: 'lesson' },
    ...(p.showLog ? [{ id: 'log' as const, label: 'Log', icon: 'log' as const }] : []),
  ];
  const tab = tabs.some((t) => t.id === p.tab) ? p.tab : 'notes';

  return (
    <aside className="panel" aria-label="Session panel">
      <header className="panel__head">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'tab is-active' : 'tab'}
              onClick={() => p.onTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
              {t.badge && <span className="tab__badge" aria-label="new" />}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={p.onClose} aria-label="Close panel" title="Close panel">
          <Icon name="close" />
        </button>
      </header>
      <div className="panel__body" role="tabpanel">
        {tab === 'notes' && (
          <NotesPanel notes={p.notes} fresh={p.freshNotes} onToggle={p.onToggleNotes} onDefaultChange={p.onNotesDefault} />
        )}
        {tab === 'lesson' && <LessonTab lesson={p.lesson} />}
        {tab === 'log' && <LogView entries={p.logs} />}
      </div>
    </aside>
  );
}

function LessonTab({ lesson }: { lesson: LessonView | null }) {
  const empty = !lesson || (!lesson.topic && lesson.chunks.length === 0 && !lesson.gist);
  return (
    <div className="panel__scroll">
      {empty ? (
        <p className="empty-note">
          Once you start on a topic, GuruAI splits it into small parts and tracks which ones you have understood. The plan
          shows up here.
        </p>
      ) : (
        <>
          <LessonProgress view={lesson} />
          {lesson!.gist && (
            <section className="gist">
              <h3>So far</h3>
              <p>{lesson!.gist}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function LogView({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);
  return (
    <div className="panel__scroll log" ref={ref}>
      {entries.length === 0 ? (
        <p className="empty-note">Nothing yet.</p>
      ) : (
        entries.map((e) => (
          <p className={`log__line is-${e.kind}`} key={e.id}>
            <span className="log__at">{e.at}</span>
            {e.text}
          </p>
        ))
      )}
    </div>
  );
}
