// ============================================================
// LessonProgress — where the lesson stands: its topic, the chunks it is
// split into (each with a status) and what comes next. Fed by the server's
// session memory, updated after every exchange.
// ============================================================

import type { LessonView } from '../protocol.ts';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not yet',
  explained: 'Explained',
  understood: 'Understood',
  struggling: 'Needs another look',
};

export function LessonProgress({ view }: { view: LessonView | null }) {
  if (!view || (!view.topic && view.chunks.length === 0)) return null;
  const done = view.chunks.filter((c) => c.status === 'understood').length;

  return (
    <section className="lesson" aria-label="Lesson progress">
      <p className="lesson__label">Lesson</p>
      {view.topic && <p className="lesson__topic">{view.topic}</p>}
      {view.chunks.length > 0 && (
        <>
          <p className="lesson__count">
            {done} of {view.chunks.length} understood
          </p>
          <ol className="lesson__chunks">
            {view.chunks.map((c, i) => (
              <li key={i} className={`lesson__chunk is-${c.status}${i === view.next ? ' is-next' : ''}`}>
                <span className="lesson__dot" aria-hidden="true" />
                <span className="lesson__title">{c.title}</span>
                <span className="lesson__status">{i === view.next ? 'Up next' : STATUS_LABEL[c.status]}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
