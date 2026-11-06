// ============================================================
// notesAgent.ts — writes the study notes, in the background, as the
// lesson goes.
//
// After every exchange (when notes are on for the session) one JSON LLM call
// turns the new turns into a NotesPatch: exam-style definitions, key points,
// formulas, examples and tips, in the student's language, never duplicating
// what is already there. applyNotesPatch (notebook.ts) validates and applies
// it. Runs are serial per session; a burst of exchanges is folded together.
//
// Notes are on by default for new sessions (meta.notes_default) and can be
// switched per session from the panel or by voice (see memoryUpdater's
// notes_request).
// ============================================================

import { getMeta, getNotebookRow, getSession, getSessionTurnsAfter, saveNotebookRow, setMeta } from '../contextStore';
import { getLanguage } from '../languages';
import { completeJson, hasBackgroundLlm } from '../llmText';
import { loadSessionMemory } from '../memory/sessionMemory';
import { SerialJobs } from '../util/serialJobs';
import { applyNotesPatch, blockCount, emptyNotebook, outlineOf, parseNotebook, type Notebook } from './notebook';

/** Turns folded in per run; catching up after notes are switched on reads a bit further back. */
const MAX_NEW_TURNS = 10;

export interface NotesState {
  enabled: boolean;
  notebook: Notebook;
  uptoTurnId: number;
}

type JsonCompleter = (prompt: string, maxTokens: number) => Promise<Record<string, unknown>>;
type NotesListener = (sessionId: string, state: NotesState) => void;

let completer: JsonCompleter = completeJson;
let hasLlm: () => boolean = hasBackgroundLlm;
const listeners: NotesListener[] = [];
const jobs = new SerialJobs((sessionId) => runOnce(sessionId));

/** Tests: replace the LLM. */
export function setNotesCompleter(fn: JsonCompleter, available: () => boolean = () => true): void {
  completer = fn;
  hasLlm = available;
}

/** Notified whenever a session's notes or their on/off state change. */
export function onNotesChanged(cb: NotesListener): void {
  listeners.push(cb);
}

function notify(sessionId: string, state: NotesState): void {
  for (const cb of listeners) cb(sessionId, state);
}

// ── Defaults and per-session state ────────────────────────────

export function notesDefault(): boolean {
  return getMeta('notes_default') !== 'false';
}

export function setNotesDefault(on: boolean): void {
  setMeta('notes_default', on ? 'true' : 'false');
}

/** The session's notes; a session without a notebook yet gets the default on/off. */
export function loadNotes(sessionId: string): NotesState {
  const row = getNotebookRow(sessionId);
  if (!row) return { enabled: notesDefault(), notebook: emptyNotebook(), uptoTurnId: 0 };
  return { enabled: row.enabled === 1, notebook: parseNotebook(row.doc), uptoTurnId: row.upto_turn_id };
}

function save(sessionId: string, state: NotesState): void {
  saveNotebookRow(sessionId, state.enabled, JSON.stringify(state.notebook), state.uptoTurnId);
}

/** Switch notes on/off for a session. Switching on catches up on the turns since the last notes. */
export function setNotesEnabled(sessionId: string, enabled: boolean): NotesState {
  const state = { ...loadNotes(sessionId), enabled };
  save(sessionId, state);
  console.log(`[notes] ${sessionId.slice(0, 8)}: notes ${enabled ? 'on' : 'off'}`);
  notify(sessionId, state);
  if (enabled) updateNotesBackground(sessionId);
  return state;
}

// ── The agent ─────────────────────────────────────────────────

export function updateNotesBackground(sessionId: string): void {
  void updateNotes(sessionId);
}

export async function updateNotes(sessionId: string): Promise<void> {
  if (!hasLlm() || !loadNotes(sessionId).enabled) return;
  await jobs.trigger(sessionId);
}

async function runOnce(sessionId: string): Promise<void> {
  const state = loadNotes(sessionId);
  if (!state.enabled) return;
  const session = getSession(sessionId);
  if (!session) return;

  const all = getSessionTurnsAfter(sessionId, state.uptoTurnId, 50);
  if (all.length === 0) return;
  const turns = all.slice(-MAX_NEW_TURNS);
  const lastId = all[all.length - 1].id ?? state.uptoTurnId;

  const memory = loadSessionMemory(sessionId).memory;
  const lang = getLanguage(session.language);
  const prompt = buildNotesPrompt({
    outline: outlineOf(state.notebook),
    languageLabel: lang.id === 'en' ? 'English' : `${lang.label} (${lang.nativeLabel})`,
    hinglish: lang.id === 'hinglish',
    level: [session.grade ? (session.grade === 'college' ? 'college' : `Class ${session.grade}`) : '', session.board ?? '']
      .filter(Boolean)
      .join(', '),
    topic: memory.topic,
    chunks: memory.lesson?.chunks.map((c) => c.title) ?? [],
    turns,
  });

  let patch: Record<string, unknown>;
  try {
    patch = await completer(prompt, 1500);
  } catch (err) {
    console.error(`[notes] update failed for ${sessionId.slice(0, 8)}: ${(err as Error).message}`);
    return; // unchanged; the same turns are retried next time
  }

  // The student may have switched notes off while the call was out.
  const latest = loadNotes(sessionId);
  if (!latest.enabled) return;

  const { notebook, changed } = applyNotesPatch(latest.notebook, patch);
  const next: NotesState = { enabled: true, notebook, uptoTurnId: Math.max(lastId, latest.uptoTurnId) };
  save(sessionId, next);
  if (changed) {
    console.log(`[notes] ${sessionId.slice(0, 8)}: v${notebook.version}, ${notebook.sections.length} section(s), ${blockCount(notebook)} block(s)`);
    notify(sessionId, next);
  }
}

export interface NotesPromptInput {
  outline: string;
  languageLabel: string;
  hinglish: boolean;
  level: string;
  topic: string | null;
  chunks: string[];
  turns: Array<{ role: string; content: string }>;
}

export function buildNotesPrompt(i: NotesPromptInput): string {
  const transcript = i.turns
    .map((t) => `${t.role === 'user' ? 'STUDENT' : 'TEACHER'}: ${t.content.slice(0, 1800)}`)
    .join('\n');
  const script = i.hinglish
    ? 'Write in Hinglish: Hindi in Devanagari script, English words in Latin script.'
    : `Write in ${i.languageLabel}. Keep standard technical terms in English in brackets after the native term the first time.`;

  return `You write a student's study notes from a voice lesson, like a good topper's notebook${i.level ? ` (${i.level})` : ''}.

CURRENT NOTES (do not repeat anything already here; refer to sections by their [id]):
${i.outline}
${i.topic ? `\nLESSON TOPIC: ${i.topic}` : ''}${i.chunks.length ? `\nLESSON PLAN: ${i.chunks.join(' → ')}` : ''}

NEW PART OF THE LESSON:
${transcript}

Return ONE JSON object:
{"should_record": true|false,
 "subject": "the school subject as the notebook headline, e.g. Physics / Biology / Mathematics / History (in the notes language, English in brackets)",
 "topic": "the current topic, 2–6 words",
 "ops": [
   {"op": "add_section", "heading": "...", "blocks": [BLOCK, ...]},
   {"op": "append", "section_id": "s1", "blocks": [BLOCK, ...]},
   {"op": "update_block", "block_id": "b3", "text": "corrected text"}
 ]}
BLOCK = {"kind": "definition" | "point" | "formula" | "example" | "tip" | "question", "text": "...", "latex": "only for formulas, e.g. v = u + at"}

Rules:
- ${script}
- Record only what the TEACHER actually taught (and the student's correct insights). Greetings, small talk, and the student asking for an example: "should_record": false and no ops.
- Concise and exam-oriented: one idea per block, at most two short sentences. Definitions as "Term: meaning". Formulas with "latex" plus a "text" saying what each symbol means. One "example" per idea when the teacher gave one. "tip" for memory aids or common mistakes. "question" for a practice question the teacher asked.
- One section per idea or lesson chunk${i.chunks.length ? ' — follow the LESSON PLAN order and names' : ''}. Use "append" to add to an existing section; "add_section" only for a new idea or topic.
- Use "update_block" only to correct something the teacher corrected.
- Never repeat a point that is already in CURRENT NOTES.`;
}
