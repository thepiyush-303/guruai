// ============================================================
// notebook.ts — the study notes of one session, and how they change.
//
// A notebook has a headline (the subject), a topic, and sections of blocks
// (definitions, key points, formulas, examples, tips, practice questions).
// The notes agent proposes a NotesPatch; applyNotesPatch is the only way the
// notebook changes, and it is pure: ids are assigned here (the LLM can only
// refer to ids it was shown), unknown or malformed operations are ignored,
// duplicates are skipped, sizes are capped, and the version only moves when
// something actually changed.
// ============================================================

export type BlockKind = 'point' | 'definition' | 'formula' | 'example' | 'tip' | 'question';
const KINDS: BlockKind[] = ['point', 'definition', 'formula', 'example', 'tip', 'question'];

export interface NoteBlock {
  id: string;
  kind: BlockKind;
  text: string;
  /** Formula blocks: the formula in LaTeX, rendered with KaTeX. */
  latex?: string;
}

export interface NoteSection {
  id: string;
  heading: string;
  blocks: NoteBlock[];
}

export interface Notebook {
  /** The headline: the subject being studied, e.g. "भौतिकी (Physics)". */
  subject: string | null;
  /** Subtitle: the current topic. */
  topic: string | null;
  sections: NoteSection[];
  version: number;
  /** Counters for server-assigned ids. */
  next_section: number;
  next_block: number;
}

export const MAX_SECTIONS = 40;
export const MAX_BLOCKS_PER_SECTION = 30;
const MAX_TEXT = 400;
const MAX_LATEX = 300;
const MAX_HEADING = 100;

export function emptyNotebook(): Notebook {
  return { subject: null, topic: null, sections: [], version: 0, next_section: 1, next_block: 1 };
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

/** A key for duplicate detection: case/space/punctuation-insensitive. */
function fingerprint(text: string): string {
  return text.toLowerCase().replace(/[\s.,;:!?।'"“”‘’()-]+/g, '');
}

interface NewBlock {
  kind: BlockKind;
  text: string;
  latex?: string;
}

function newBlocks(raw: unknown): NewBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: NewBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    const text = clean(o.text, MAX_TEXT);
    const latex = clean(o.latex, MAX_LATEX) ?? undefined;
    if (!text && !latex) continue;
    const kind = KINDS.includes(o.kind as BlockKind) ? (o.kind as BlockKind) : latex ? 'formula' : 'point';
    out.push({ kind, text: text ?? '', ...(latex ? { latex } : {}) });
  }
  return out;
}

/** Deep-ish copy, so the input notebook is never mutated. */
function clone(nb: Notebook): Notebook {
  return { ...nb, sections: nb.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b })) })) };
}

/**
 * Apply an LLM-proposed patch. Returns the new notebook and whether anything
 * changed (the input is never modified).
 */
export function applyNotesPatch(input: Notebook, patch: unknown): { notebook: Notebook; changed: boolean } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { notebook: input, changed: false };
  const p = patch as Record<string, unknown>;
  if (p.should_record === false) return { notebook: input, changed: false };

  const nb = clone(input);
  let changed = false;

  const seen = new Set<string>();
  for (const s of nb.sections) for (const b of s.blocks) seen.add(fingerprint(b.text + (b.latex ?? '')));

  const addBlocks = (section: NoteSection, blocks: NewBlock[]) => {
    for (const b of blocks) {
      if (section.blocks.length >= MAX_BLOCKS_PER_SECTION) break;
      const fp = fingerprint(b.text + (b.latex ?? ''));
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      section.blocks.push({ id: `b${nb.next_block++}`, ...b });
      changed = true;
    }
  };

  const subject = clean(p.subject, MAX_HEADING);
  if (subject && subject !== nb.subject) {
    nb.subject = subject;
    changed = true;
  }
  const topic = clean(p.topic, MAX_HEADING);
  if (topic && topic !== nb.topic) {
    nb.topic = topic;
    changed = true;
  }

  for (const raw of Array.isArray(p.ops) ? p.ops : []) {
    if (!raw || typeof raw !== 'object') continue;
    const op = raw as Record<string, unknown>;

    if (op.op === 'add_section') {
      const heading = clean(op.heading, MAX_HEADING);
      const blocks = newBlocks(op.blocks);
      if (!heading) continue;
      // A section with this heading already exists: append to it instead.
      const existing = nb.sections.find((s) => fingerprint(s.heading) === fingerprint(heading));
      if (existing) {
        addBlocks(existing, blocks);
        continue;
      }
      if (nb.sections.length >= MAX_SECTIONS) continue;
      // Only keep the new section if at least one of its blocks is new.
      const section: NoteSection = { id: `s${nb.next_section}`, heading, blocks: [] };
      addBlocks(section, blocks);
      if (section.blocks.length > 0) {
        nb.next_section++;
        nb.sections.push(section);
      }
    } else if (op.op === 'append') {
      const section = nb.sections.find((s) => s.id === op.section_id);
      if (section) addBlocks(section, newBlocks(op.blocks));
    } else if (op.op === 'update_block') {
      for (const s of nb.sections) {
        const block = s.blocks.find((b) => b.id === op.block_id);
        if (!block) continue;
        const text = clean(op.text, MAX_TEXT);
        const latex = clean(op.latex, MAX_LATEX);
        if (text && text !== block.text) {
          block.text = text;
          changed = true;
        }
        if (latex && latex !== block.latex) {
          block.latex = latex;
          changed = true;
        }
      }
    }
    // anything else: ignored
  }

  if (changed) nb.version = input.version + 1;
  return { notebook: changed ? nb : input, changed };
}

/** A compact outline for the notes agent's prompt: ids and the start of each block. */
export function outlineOf(nb: Notebook): string {
  if (nb.sections.length === 0) return '(empty — no notes yet)';
  const lines: string[] = [];
  if (nb.subject) lines.push(`Subject: ${nb.subject}`);
  if (nb.topic) lines.push(`Topic: ${nb.topic}`);
  for (const s of nb.sections) {
    lines.push(`[${s.id}] ${s.heading}`);
    for (const b of s.blocks) {
      const t = b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text;
      lines.push(`  (${b.id}, ${b.kind}) ${t}${b.latex ? ` [${b.latex.slice(0, 40)}]` : ''}`);
    }
  }
  return lines.join('\n');
}

export function blockCount(nb: Notebook): number {
  return nb.sections.reduce((n, s) => n + s.blocks.length, 0);
}

/** Parse a stored notebook; anything unreadable becomes an empty notebook. */
export function parseNotebook(json: string | null | undefined): Notebook {
  if (!json) return emptyNotebook();
  try {
    const o = JSON.parse(json) as Partial<Notebook>;
    if (!o || !Array.isArray(o.sections)) return emptyNotebook();
    return {
      subject: typeof o.subject === 'string' ? o.subject : null,
      topic: typeof o.topic === 'string' ? o.topic : null,
      sections: o.sections,
      version: typeof o.version === 'number' ? o.version : 0,
      next_section: typeof o.next_section === 'number' ? o.next_section : o.sections.length + 1,
      next_block: typeof o.next_block === 'number' ? o.next_block : 1 + o.sections.reduce((n, s) => n + (s.blocks?.length ?? 0), 0),
    };
  } catch {
    return emptyNotebook();
  }
}
