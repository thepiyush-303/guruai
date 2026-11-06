// ============================================================
// NotesPanel — the study notes, written while the lesson happens.
//
// The Notes tab of the session's side panel. The headline is the subject;
// sections fill in as GuruAI teaches, and new blocks glow briefly so the
// student sees them appear while listening. It also holds the notes switch
// (this session), the default for new sessions, and the PDF download.
// ============================================================

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { memo, useEffect, useRef, useState } from 'react';
import { downloadNotesPdf } from '../api.ts';
import { Icon } from './Icon.tsx';
import type { NoteBlock, NotesState } from '../protocol.ts';

interface Props {
  notes: NotesState | null;
  /** Block ids added in the latest update (highlighted briefly). */
  fresh: ReadonlySet<string>;
  onToggle: (enabled: boolean) => void;
  onDefaultChange: (enabled: boolean) => void;
}

const KIND_LABEL: Record<string, string> = {
  definition: 'Definition',
  formula: 'Formula',
  example: 'Example',
  tip: 'Remember',
  question: 'Practice',
};

const Formula = memo(function Formula({ latex }: { latex: string }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: true, strict: 'ignore' });
  } catch {
    return <code>{latex}</code>;
  }
  return <div className="note__formula" dangerouslySetInnerHTML={{ __html: html }} />;
});

function Block({ block, fresh }: { block: NoteBlock; fresh: boolean }) {
  const label = KIND_LABEL[block.kind];
  return (
    <div className={`note note--${block.kind}${fresh ? ' is-fresh' : ''}`}>
      {label && <span className="note__tag">{label}</span>}
      {block.latex && <Formula latex={block.latex} />}
      {block.text && <p className="note__text">{block.text}</p>}
    </div>
  );
}

export function NotesPanel({ notes, fresh, onToggle, onDefaultChange }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow new notes while the reader is at the bottom; leave them be if they
  // scrolled up to re-read (same rule as the captions).
  useEffect(() => {
    const el = scrollRef.current;
    const list = listRef.current;
    if (!el || !list) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(list);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  const nb = notes?.notebook;
  const count = nb ? nb.sections.reduce((n, s) => n + s.blocks.length, 0) : 0;

  const download = async () => {
    if (!notes) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadNotesPdf(notes.sessionId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const pdfBlocked = !notes?.pdfAvailable ? notes?.pdfReason ?? 'PDF is unavailable on this server.' : count === 0 ? 'No notes yet.' : null;

  return (
    <div className="notes">
      <header className="notes__head">
        <label className="switch" title="Make notes in this session">
          <input
            type="checkbox"
            role="switch"
            checked={notes?.enabled ?? false}
            disabled={!notes}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="switch__track" aria-hidden="true" />
          <span>Make notes in this session</span>
        </label>
      </header>

      <div className="notes__scroll" ref={scrollRef}>
        <div ref={listRef}>
          {nb?.subject && <h2 className="notes__subject">{nb.subject}</h2>}
          {nb?.topic && <p className="notes__topic">{nb.topic}</p>}

          {count === 0 ? (
            <p className="notes__empty">
              {!notes
                ? 'Start a session to make notes.'
                : notes.enabled
                  ? 'Notes appear here as GuruAI explains — definitions, key points, formulas and examples, in your language.'
                  : 'Notes are off for this session. Switch them on, or just say "make notes".'}
            </p>
          ) : (
            nb!.sections.map((s) => (
              <section className="notes__section" key={s.id}>
                <h3>{s.heading}</h3>
                {s.blocks.map((b) => (
                  <Block key={b.id} block={b} fresh={fresh.has(b.id)} />
                ))}
              </section>
            ))
          )}
          {notes && !notes.enabled && count > 0 && (
            <p className="notes__paused">Notes are paused — say "make notes" or use the switch to continue.</p>
          )}
        </div>
      </div>

      <footer className="notes__foot">
        <button
          className="btn btn--primary"
          onClick={() => void download()}
          disabled={!!pdfBlocked || downloading}
          title={pdfBlocked ?? 'Download these notes as a PDF'}
        >
          <Icon name="download" size={16} />
          {downloading ? 'Preparing PDF…' : 'Download PDF'}
        </button>
        {notes && (
          <label className="check">
            <input type="checkbox" checked={notes.defaultEnabled} onChange={(e) => onDefaultChange(e.target.checked)} />
            Make notes in new sessions too
          </label>
        )}
        {(error || (notes && !notes.pdfAvailable)) && (
          <p className="form-error" role="alert">
            {error ?? notes?.pdfReason}
          </p>
        )}
      </footer>
    </div>
  );
}
