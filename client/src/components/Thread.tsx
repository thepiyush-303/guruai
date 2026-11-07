// ============================================================
// Thread — the session's conversation as one readable column.
//
// The student's turns sit on the right, GuruAI's on the left. The reply in
// progress reveals word by word in step with the voice (paced to the audio
// still buffered), or at once when spoken replies are off. While the student
// talks, their live words (Vosk) show as a faint pending bubble.
//
// The view follows new text only while the reader is at the bottom; once they
// scroll up to re-read, nothing pulls them back down.
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LiveReply, ThreadTurn } from '../hooks/useVoiceSession.ts';

/** Reveal pacing: each word waits clamp(bufferedAudioMs / wordsLeft). If no
 *  audio arrives within STALL_MS (TTS slow or failed), the reveal proceeds at
 *  a steady readable pace rather than sitting frozen. */
const MIN_WORD_MS = 55;
const MAX_WORD_MS = 420;
const STALL_MS = 1800;
const STALL_WORD_MS = 120;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Props {
  turns: ThreadTurn[];
  reply: LiveReply;
  /** Live words while the student is speaking. */
  userDraft: string;
  thinking: boolean;
  /** Spoken replies on: pace the reveal to the audio. */
  paced: boolean;
  remainingMs: () => number;
  /** Shown when the thread is empty (the hero). */
  empty: ReactNode;
  /** Shown under the last message (e.g. an error notice). */
  footer?: ReactNode;
}

export function Thread({ turns, reply, userDraft, thinking, paced, remainingMs, empty, footer }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    const list = listRef.current;
    if (!el || !list) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    };
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(list);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  const hasReply = reply.text.trim().length > 0;
  const isEmpty = turns.length === 0 && !hasReply && !userDraft && !thinking;

  return (
    <div className="thread" ref={scrollRef}>
      <div className="thread__list" ref={listRef}>
        {isEmpty && <div className="thread__empty">{empty}</div>}
        {turns.map((t) => (
          <Message key={t.key} role={t.role}>
            {t.text}
          </Message>
        ))}
        {userDraft && (
          <Message role="user" pending>
            {userDraft}
          </Message>
        )}
        {hasReply ? (
          <Message role="assistant" live>
            <Reveal key={reply.id} text={reply.text} audioStarted={reply.audioStarted} paced={paced} remainingMs={remainingMs} />
          </Message>
        ) : (
          thinking && (
            <Message role="assistant" live>
              <span className="typing" aria-label="GuruAI is thinking">
                <span />
                <span />
                <span />
              </span>
            </Message>
          )
        )}
        {hasReply && reply.sources.length > 0 && (
          <ul className="sources">
            {reply.sources.slice(0, 5).map((s) => (
              <li key={s.uri}>
                <a href={s.uri} target="_blank" rel="noopener noreferrer">
                  {s.title || s.uri}
                </a>
              </li>
            ))}
          </ul>
        )}
        {footer}
      </div>
    </div>
  );
}

function Message({ role, pending, live, children }: { role: 'user' | 'assistant'; pending?: boolean; live?: boolean; children: ReactNode }) {
  return (
    <div className={`msg msg--${role}${pending ? ' is-pending' : ''}${live ? ' is-live' : ''}`}>
      {role === 'assistant' && (
        <span className="msg__avatar" aria-hidden="true">
          G
        </span>
      )}
      <div className="msg__body">
        <span className="visually-hidden">{role === 'user' ? 'You:' : 'GuruAI:'}</span>
        {children}
      </div>
    </div>
  );
}

/** One reply's word-by-word reveal; remounted (keyed) per reply. */
function Reveal({
  text,
  audioStarted,
  paced,
  remainingMs,
}: {
  text: string;
  audioStarted: boolean;
  paced: boolean;
  remainingMs: () => number;
}) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [shown, setShown] = useState(0);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (audioStarted || !paced) return;
    const timer = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => window.clearTimeout(timer);
  }, [audioStarted, paced]);

  useEffect(() => {
    if (!paced) return;
    if (shown >= words.length) return;
    if (!audioStarted && !stalled) return;
    const remainingWords = words.length - shown;
    const perWord = audioStarted ? clamp(remainingMs() / remainingWords, MIN_WORD_MS, MAX_WORD_MS) : STALL_WORD_MS;
    const timer = window.setTimeout(() => setShown((n) => n + 1), perWord);
    return () => window.clearTimeout(timer);
  }, [shown, words.length, audioStarted, stalled, remainingMs, paced]);

  // Text-only: show everything as it streams in.
  if (!paced) return <p aria-live="polite">{text.trim()}</p>;

  const revealed = words.slice(0, shown).join(' ');
  if (!revealed) {
    return (
      <span className="typing" aria-label="GuruAI is about to speak">
        <span />
        <span />
        <span />
      </span>
    );
  }
  return (
    <p aria-live="polite">
      {revealed}
      {shown < words.length && <span className="caret" aria-hidden="true" />}
    </p>
  );
}
