// ============================================================
// sentenceBuffer.ts — Sentence-boundary buffering for TTS
// Accumulates LLM token deltas and emits speakable fragments.
//
// Tuned for a NETWORK TTS (Gnani Timbre): each fragment is one request and one
// round trip, and very short fragments sound choppy, so we prefer whole
// sentences. Piper (local) could afford comma-level fragments; Timbre cannot.
// ============================================================

/** Hard boundaries: sentence-ending punctuation (incl. the Indic danda । ॥) or a newline. */
const HARD_END_RE = /[.?!।॥]+["')\]]*(?=\s)|[.?!।॥]+["')\]]*$|\n+/;

/** Soft boundaries: clause punctuation — only honoured once the buffer is long. */
const SOFT_END_RE = /[,;:]+(?=\s)/;

/** Below this a fragment waits to merge with the next one. */
const MIN_CHUNK_CHARS = 24;

/** A clause boundary counts only if the fragment before it is at least this long. */
const SOFT_SPLIT_CHARS = 120;

/** Never send a fragment longer than this — split at the last space instead. */
const MAX_CHUNK_CHARS = 220;

/** The first fragment is the user's perceived latency: flush it sooner. */
const FIRST_FLUSH_TIMEOUT_MS = 250;

/** Later fragments: wait longer for a real boundary to keep prosody natural. */
const FLUSH_TIMEOUT_MS = 600;

export type SentenceCallback = (sentence: string) => void;

export interface SentenceBufferOptions {
  firstFlushMs?: number;
  flushMs?: number;
}

export class SentenceBuffer {
  private buffer = '';
  private onSentence: SentenceCallback;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private firstChunkPending = true;
  private firstFlushMs: number;
  private flushMs: number;

  constructor(onSentence: SentenceCallback, opts: SentenceBufferOptions = {}) {
    this.onSentence = onSentence;
    this.firstFlushMs = opts.firstFlushMs ?? FIRST_FLUSH_TIMEOUT_MS;
    this.flushMs = opts.flushMs ?? FLUSH_TIMEOUT_MS;
  }

  /** Append a new token delta from the LLM stream. */
  append(delta: string): void {
    this.buffer += delta;
    this.tryFlush();
  }

  /** Force-flush any remaining content immediately (LLM stream complete). */
  flush(): void {
    this.clearTimer();
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (remaining.length > 0) this.emit(remaining);
  }

  /** Discard all buffered content without emitting. */
  reset(): void {
    this.clearTimer();
    this.buffer = '';
    this.firstChunkPending = true;
  }

  // ── Internal ────────────────────────────────────────────────

  private emit(sentence: string): void {
    this.firstChunkPending = false;
    this.onSentence(sentence);
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Index just past the next usable boundary at or after `from`, or -1. */
  private findBoundary(from: number): number {
    const rest = this.buffer.slice(from);
    const hard = HARD_END_RE.exec(rest);
    let best = hard ? from + hard.index + hard[0].length : -1;

    // A clause boundary only counts once the fragment it would END is long —
    // a fast LLM delivers whole paragraphs at once, and splitting at every
    // comma there makes the voice choppy ("They take carbon dioxide from the air,").
    const soft = new RegExp(SOFT_END_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = soft.exec(rest)) !== null) {
      const end = from + m.index + m[0].length;
      if (best >= 0 && end >= best) break;
      if (this.buffer.slice(0, end).trim().length >= SOFT_SPLIT_CHARS) {
        best = end;
        break;
      }
    }
    return best;
  }

  private tryFlush(): void {
    // Emit every complete fragment that is long enough; short ones wait to
    // merge with what follows (scan past their boundary).
    let scanFrom = 0;
    for (;;) {
      const end = this.findBoundary(scanFrom);
      if (end < 0) break;
      const piece = this.buffer.slice(0, end).trim();
      if (piece.length >= MIN_CHUNK_CHARS) {
        this.buffer = this.buffer.slice(end);
        scanFrom = 0;
        this.clearTimer();
        this.emit(piece);
      } else {
        scanFrom = end;
      }
    }

    // A run-on with no boundary: cut at the last space before the cap.
    while (this.buffer.length > MAX_CHUNK_CHARS) {
      const head = this.buffer.slice(0, MAX_CHUNK_CHARS);
      const cut = head.lastIndexOf(' ');
      const at = cut > MIN_CHUNK_CHARS ? cut : MAX_CHUNK_CHARS;
      const piece = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at);
      this.clearTimer();
      if (piece) this.emit(piece);
    }

    // Time-based safety net, so a slow LLM never leaves speech waiting.
    // The timer is NOT reset per token: a steady token flood without
    // punctuation would otherwise wait for the stream to end.
    if (this.buffer.trim().length > 0 && !this.flushTimer) this.armTimer();
  }

  private armTimer(): void {
    const timeout = this.firstChunkPending ? this.firstFlushMs : this.flushMs;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const remaining = this.buffer.trim();
      if (remaining.length === 0) return;
      // A couple of words alone sound choppy — keep waiting; flush() at the
      // end of the stream sends whatever is left.
      if (remaining.length < MIN_CHUNK_CHARS) {
        this.armTimer();
        return;
      }
      this.buffer = '';
      this.emit(remaining);
    }, timeout);
  }
}
